# Signaldesk

CSV catalog in → score each SKU → open/close health cases → signed webhooks out.

**Live**: [https://signaldesk.aetherhost.com.ng/](https://signaldesk.aetherhost.com.ng/) 
**Architecture Diagram**: [https://signaldesk.aetherhost.com.ng/architecture](https://signaldesk.aetherhost.com.ng/architecture)  
**Prometheus Metrics**: [https://signaldesk.aetherhost.com.ng/metrics](https://signaldesk.aetherhost.com.ng/metrics)

---

## Executive Summary

**Signaldesk** scores a product catalog and opens a case when a SKU is missing a name, missing a price, or out of stock. A background worker does the scoring so uploads stay fast. Webhooks are written in the same database transaction as the case, then delivered with HMAC signatures and retries.

Designed as a production-shaped TypeScript catalog-health control plane:

- **Bounded Memory Streaming (`AsyncGenerator`)**: Streams CSV uploads in bounded chunks (`250 rows/batch`) through `csv-parse`, keeping worker V8 heap usage $O(\text{chunk size})$ instead of $O(N)$ and batch-prefetching open cases to eliminate $N+1$ database round-trips.
- **Optimistic Job Leases & Stale-Lock Recovery**: Workers claim jobs with `UPDATE … WHERE status = 'pending'` (`lockedAt`, `lockedBy`, `attempts`) and automatically reclaim orphaned `processing` jobs if a worker container crashes or is OOM-killed.
- **Transactional Webhook Outbox & Replay Engine**: Case open/close and the `WebhookDelivery` outbox row are written in the same Postgres transaction. The worker then POSTs with `AbortSignal.timeout(5000)`, retries transient failures using **exponential backoff with jitter**, and supports on-demand manual replay (`POST /v1/webhooks/deliveries/:id/replay`).
- **Defense-in-Depth Security**: SHA-256 hashed API keys (`sd_live_...`), zero-downtime API key rotation and revocation, constant-time (`crypto.timingSafeEqual`) admin & HMAC-SHA256 webhook verification with a 5-minute replay window, SSRF cloud-metadata blocking (`169.254.169.254`, `metadata.google.internal`, RFC1918), and per-tenant sliding-window rate limiting (`X-RateLimit-*`).
- **Hexagonal Storage Port**: Abstracts catalog blobs behind `CatalogBlobStoragePort` (`put` / `load` / `buildObjectUri`). Default adapter is `postgres-bytea` (bytes stored on `Ingest.csvBytes`). `STORAGE_PROVIDER` (`aws-s3`, `gcp-gcs`, `azure-blob`, `minio-s3`) switches the object URI scheme so a later object-store adapter can drop in without changing ingest/worker call sites.
- **SLO Error Budgets & Observability**: `AsyncLocalStorage` request correlation (`x-correlation-id`), structured JSON logging, Node.js event-loop p99 lag monitoring (`perf_hooks`), and Prometheus `/metrics` + `/v1/telemetry` tracking live compliance against `p95 < 200ms` (Ingest) and `p95 < 50ms` (Health) SLOs. Worker job percentiles are read from completed ingest rows so they survive the API/worker process split.

---

## System Architecture & Bounded Contexts

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        Signaldesk Control Plane (NestJS 10)                         │
│                                                                                     │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌─────────────────────────┐  │
│  │  Identity & Tenancy  │   │  Catalog & Ingests   │   │   Health & Case Engine  │  │
│  │  • Workspaces        │   │  • Idempotent Ingest │   │   • Deterministic Score │  │
│  │  • SHA-256 API Keys  │   │  • Multi-Cloud Port  │   │   • Auto Open / Close   │  │
│  │  • Key Rotation      │   │  • Chunked Streamer  │   │   • Operator Override   │  │
│  └──────────┬───────────┘   └──────────┬───────────┘   └────────────┬────────────┘  │
│             │                          │                            │               │
│  ┌──────────┴──────────────────────────┴────────────────────────────┴────────────┐  │
│  │                 Observability, Rate Limiting & Security Gateway               │  │
│  │     AsyncLocalStorage (x-correlation-id) • Prometheus /metrics • SLO Tracker  │  │
│  └─────────────────────────────────────┬─────────────────────────────────────────┘  │
└────────────────────────────────────────┼────────────────────────────────────────────┘
                                         │
                         ┌───────────────▼───────────────┐
                         │     PostgreSQL 16 (Prisma)    │
                         │  Workspaces • Products • Cases│
                         │  Ingest Leases • Outbox Log   │
                         └───────────────▲───────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         │   Async Node Worker Process   │
                         │  • Stale Lease Lock Recovery  │
                         │  • AsyncGenerator CSV Chunks  │
                         │  • Outbox Exponential Backoff │
                         │  • HMAC-SHA256 Webhook Signer │
                         └───────────────────────────────┘
```

### Architecture Decision Records (ADRs)

- [ADR 001 — Hybrid Extract Path, Bounded Stream Chunking & Lease Recovery](docs/adr/001-hybrid-extract-path.md)
- [ADR 002 — Modular Monolith, Tactical DDD Boundaries & Transitional Decomposition Path](docs/adr/002-modular-monolith-and-ddd-boundaries.md)
- [ADR 003 — Transactional Webhook Outbox, HMAC Replay Protection & SSRF Defense](docs/adr/003-transactional-outbox-and-webhook-resilience.md)
- [ADR 004 — Multi-Cloud Portability, SLO Error Budgets & Observability](docs/adr/004-multi-cloud-portability-and-slo-observability.md)

---

## API Reference

| Method & Path | Auth | Description |
| :--- | :--- | :--- |
| `POST /v1/workspaces` | `x-admin-token` | Provision a tenant workspace; returns `sd_live_...` API key **once**. |
| `GET /v1/me` | `x-api-key` | Identify the authenticated workspace. |
| `GET /v1/api-keys` | `x-api-key` | List active and revoked API keys for the workspace. |
| `POST /v1/api-keys` | `x-api-key` | Mint a new named API key for zero-downtime key rotation. |
| `DELETE /v1/api-keys/:id` | `x-api-key` | Immediately revoke an API key. |
| `POST /v1/ingests` | `x-api-key` | Upload CSV (`file` + `x-ingest-id`); idempotent, returns `202 Accepted`. |
| `GET /v1/ingests` | `x-api-key` | List recent ingest jobs, row counts, durations, and storage URIs. |
| `GET /v1/ingests/:id` | `x-api-key` | Inspect a specific ingest job's status (`pending`, `processing`, `complete`, `failed`). |
| `POST /v1/ingests/:id/process` | `x-api-key` | Trigger immediate synchronous processing of a pending ingest job. |
| `GET /v1/products` | `x-api-key` | List scored workspace products (optional `?healthy=true\|false&q=search`). |
| `GET /v1/catalog/summary` | `x-api-key` | Aggregate catalog health score, SKU counts, and defect breakdown. |
| `GET /v1/cases` | `x-api-key` | List health cases (optional `?status=open\|closed`). |
| `POST /v1/cases/:id/resolve` | `x-api-key` | Manually resolve an open health case with an operator resolution audit note. |
| `POST /v1/webhooks` | `x-api-key` | Register an SSRF-validated webhook URL; returns `whsec_...` signing secret. |
| `GET /v1/webhooks/deliveries` | `x-api-key` | Inspect the transactional webhook outbox (status codes, attempts, latency). |
| `POST /v1/webhooks/deliveries/:id/replay` | `x-api-key` | Re-sign and replay a webhook delivery from the outbox. |
| `POST /v1/sandbox/provision` | Public | 1-click live sandbox provisioner with 10 seeded SKUs and loopback webhook sink. |
| `GET /v1/telemetry` | Public | Live SLO compliance (`p50`/`p95`/`p99`), queue depths, and V8 runtime telemetry. |
| `GET /metrics` | Public | Prometheus text exposition format (`0.0.4`). |
| `GET /health` · `GET /readyz` | Public | Liveness and PostgreSQL readiness probes. |

---

## Local Development (macOS / Linux)

Signaldesk uses port **3010** for the API and **5434** for local PostgreSQL (avoiding conflicts with local ports 80 and 5432/5433).

```bash
cp .env.example .env          # Local defaults (PORT=3010, Postgres on 5434)
npm install
npm run db:up                 # Starts Postgres 16 in Docker on localhost:5434
npx prisma migrate dev        # Applies schema migrations & generates Prisma Client
npm test                      # Runs unit & E2E suites (48 tests)
npm run start:dev             # Starts API & Control Plane UI at http://localhost:3010
npm run start:worker:dev      # Second terminal: starts background CSV & outbox worker
```

---

## Production Deployment (AetherHost / Docker Compose)

In production on AetherHost (`signaldesk.aetherhost.com.ng`), `docker-compose.yml` builds the multi-stage `Dockerfile` (`deps` → `build` → `runner`), applies migrations (`npx prisma migrate deploy`), and starts both the `app` container behind Traefik TLS and the `worker` container on `aetherhost-net`.

```bash
docker compose up -d --build
```
