# ADR 004 — Multi-Cloud Portability, SLO Error Budgets & Observability

- **Status**: Accepted
- **Date**: 2026-10-16
- **Deciders**: Principal Platform Architecture

## Context

In multi-cloud enterprise engagements (AWS, Google Cloud, Azure, Huawei Cloud, and self-hosted Docker/Kubernetes platforms), services must be portable across cloud providers without vendor lock-in and must expose standardized operational telemetry to verify Service Level Objectives (SLOs).

## Decision

1. **Multi-Cloud Storage Port (`CatalogBlobStoragePort`)**:
   - Raw catalog storage is abstracted behind `CatalogBlobStoragePort` (`src/common/ports/blob-storage.port.ts`), supporting `postgres-bytea` (default zero-dependency adapter), `aws-s3` (`s3://`), `gcp-gcs` (`gs://`), `azure-blob` (`az://`), and `minio-s3` (`minio://`) via 12-factor environment configuration (`STORAGE_PROVIDER`, `STORAGE_BUCKET`).

2. **Distributed Request Correlation (`AsyncLocalStorage`)**:
   - `PlatformMiddleware` extracts or mints `x-correlation-id` and `x-request-id` headers on every request, stores them in Node's `AsyncLocalStorage`, attaches `workspaceId` upon authentication in `ApiKeyGuard`, and propagates `x-correlation-id` to structured JSON logs and outbound webhook requests.

3. **Explicit SLO Tracking & Prometheus Exposition (`/metrics`, `/v1/telemetry`)**:
   - `MetricsService` tracks sliding-window latency percentiles (`p50`, `p95`, `p99`) and evaluates real-time compliance against two primary SLOs:
     - **Ingest API Latency SLO**: `p95 <= 200 ms`
     - **Health Probe Latency SLO**: `p95 <= 50 ms`
   - Node.js runtime health is monitored continuously using `perf_hooks.monitorEventLoopDelay` (`nodejs_eventloop_lag_p99_ms`) and `process.memoryUsage()` (`process_resident_memory_bytes`), scraped via `GET /metrics` in standard Prometheus text format (`0.0.4`).
