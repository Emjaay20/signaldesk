# ADR 002 — Modular Monolith, Tactical DDD Boundaries & Transitional Decomposition Path

- **Status**: Accepted
- **Date**: 2026-10-16
- **Deciders**: Principal Platform Architecture

## Context

Early distributed microservices introduce premature operational overhead (distributed tracing complexity, schema coordination, network serialization cost), whereas an unstructured monolith leads to tight coupling across identity, ingestion, health scoring, and webhook notifications. As an engineering organization delivering cloud-native systems, we need an architecture that deploys simply today while preserving clean seams for horizontal service extraction as tenant throughput scales.

## Decision

We structure Signaldesk as a **Modular Monolith with Explicit Bounded Contexts** and **Hexagonal Ports & Adapters**:

| Bounded Context | Directory | Core Responsibility & Domain Invariants |
| :--- | :--- | :--- |
| **Identity & Access** | `src/auth/`, `src/workspaces/`, `src/me/` | Tenant provisioning, SHA-256 hashed API keys, timing-safe admin verification, 60s debounced `lastUsedAt` tracking, and zero-downtime key rotation/revocation. |
| **Catalog & Ingestion** | `src/ingests/`, `src/common/ports/` | Idempotent CSV ingestion (`workspaceId + ingestKey`), multi-cloud blob storage port (`CatalogBlobStoragePort`), and chunked stream processing. |
| **Health Scoring & Cases** | `src/health/`, `src/ingests/` | Pure, deterministic domain scoring function (`scoreProduct`) and the `HealthCase` state machine (`open` $\leftrightarrow$ `closed` via catalog recovery or manual operator resolution). |
| **Webhooks & Outbox** | `src/webhooks/` | HMAC-SHA256 payload signing (`t=<ts>,v1=<sig>`), 5-minute replay window verification, SSRF guard, and transactional outbox delivery with exponential backoff. |
| **Observability & Platform** | `src/observability/` | `AsyncLocalStorage` correlation context (`x-correlation-id`), sliding-window rate limiting, Prometheus `/metrics`, and live SLO compliance telemetry. |

## Transitional Microservices Extraction Strategy

Because domain logic (`scoreProduct`, `signWebhook`, `verifyWebhook`, `isWebhookUrlSafe`, `streamCsvChunks`) is written as pure, framework-agnostic TypeScript functions and decoupled from NestJS HTTP transport:

1. **Phase 1 (Current — Dual-Process Modular Monolith)**: API (`src/main.ts`) and Worker (`src/worker.ts`) share the compiled artifact and PostgreSQL state, deployed as independent containers (`app` and `worker`) with separate memory limits (`512m` vs `256m`).
2. **Phase 2 (Independent Webhook Dispatcher Service)**: Extract `processRetryableWebhooks` into a dedicated notification microservice consuming `WebhookDelivery` outbox events via CDC/Kafka or BullMQ without modifying catalog ingestion logic.
3. **Phase 3 (Cloud-Native Storage Offload)**: Switch `STORAGE_PROVIDER` from `postgres-bytea` to `aws-s3`, `gcp-gcs`, or `azure-blob` via `MultiCloudBlobStorageAdapter` when catalog uploads exceed 5 MB.
