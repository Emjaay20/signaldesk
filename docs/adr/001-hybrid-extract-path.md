# ADR 001 — Hybrid Extract Path, Bounded Stream Chunking & Lease Recovery

- **Status**: Accepted
- **Date**: 2026-10-15 (Updated 2026-10-16)
- **Deciders**: Principal Platform Architecture

## Context

Multi-tenant SaaS catalog ingestion must satisfy two competing requirements:
1. **Strict Ingestion Latency SLO (`p95 < 200ms`)**: Tenants uploading up to 5 MB CSV catalogs cannot block on synchronous row-by-row database upserts and outbound webhook calls.
2. **Memory & Crash Resilience in Constrained Containers (`256 MB` Worker RAM)**: Buffering an entire CSV file into an in-memory object array and executing $O(N)$ sequential queries inside a single long-lived interactive database transaction causes V8 heap spikes, event-loop starvation, and PostgreSQL lock contention. Furthermore, if a worker container is terminated (`SIGKILL` / OOM) mid-flight, naive status flags leave jobs permanently stuck in `processing`.

## Decision

We adopt a **Three-Stage Hybrid Extract Pipeline**:

1. **Synchronous Gatekeeper (`POST /v1/ingests`)**:
   - Validates tenant authentication (`x-api-key`), idempotency key (`x-ingest-id`), payload size ($\le 5\text{ MB}$), and header schema (`sku`, `name`).
   - Enforces idempotency via a composite unique constraint `@@unique([workspaceId, ingestKey])`.
   - Persists raw payload bytes and returns `202 Accepted` with `status: "pending"` well within the `200ms` p95 SLO.

2. **Bounded `AsyncGenerator` Chunk Streaming (`streamCsvChunks`)**:
   - The background worker streams CSV bytes through `csv-parse` using Node.js async iteration (`for await ... of`), yielding bounded batches (`DEFAULT_CHUNK_SIZE = 250`).
   - Within each chunk, existing open `HealthCase` records are batch-prefetched (`WHERE workspaceId = $1 AND sku IN (...)`) to eliminate $N+1$ query round-trips.
   - Rows with missing `name` but valid `sku` are retained and scored via `scoreProduct` (`missing_name` penalty `-40`), ensuring catalog quality defects are surfaced rather than silently dropped.

3. **Distributed Lease Locking & Automatic Stale-Lock Recovery (`reclaimStaleLocks`)**:
   - Workers claim jobs atomically via optimistic concurrency (`UPDATE ingests SET status = 'processing', lockedAt = NOW(), lockedBy = $workerId, attempts = attempts + 1 WHERE id = $id AND status = 'pending'`).
   - Before each poll cycle, any job stuck in `processing` with `lockedAt < NOW() - STALE_LEASE_MS` (`120s`) is automatically reclaimed to `pending` if `attempts < 3`, or moved to dead-letter (`status = 'failed'`) once retries are exhausted.

## Consequences

- **Positive**: Heap allocation remains $O(\text{chunk size})$ regardless of catalog size; zero orphaned `processing` jobs after container restarts; sub-50ms API ingestion latency.
- **Trade-off**: Eventual consistency between `202 Accepted` and catalog visibility (typically `< 1s`), mitigated by exposing `GET /v1/ingests/:id` and `POST /v1/ingests/:id/process` for synchronous/interactive workflows.
