# Signaldesk

**Problem**: Organizations need a multi‑tenant control plane to ingest product data, enrich it, score health, and expose concise briefs via webhooks.

**Who pays**: SaaS providers or internal teams that require automated product health monitoring.

**Architecture**: NestJS monolith (`api`) handling identity, catalog, ingest, enrichment, scoring, cases, and notifications. A separate Node worker processes enrichment jobs via BullMQ. PostgreSQL stores the source of truth, Redis caches and backs BullMQ, MinIO holds raw CSV uploads.

**SLOs**: Ingest latency p95 < 200 ms; health endpoints respond within 50 ms.

**How to run**:
bash
docker compose up -d
# API reachable at http://signaldesk.localhost (via Traefik)


**Key concepts**: workspace isolation, hashed API keys, HMAC‑signed webhooks, 12‑factor config.
