import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IntervalHistogram, monitorEventLoopDelay } from 'perf_hooks';

const MAX_SAMPLES = 500;

export interface LatencyPercentiles {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface SloStatus {
  name: string;
  targetP95Ms: number;
  actualP95Ms: number;
  compliant: boolean;
  sampleCount: number;
  errorBudgetRemainingPct: number;
}

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly startedAt = Date.now();
  private eventLoopHistogram?: IntervalHistogram;

  private readonly ingestHttpSamples: number[] = [];
  private readonly healthHttpSamples: number[] = [];
  private readonly workerJobSamples: number[] = [];

  private httpRequestsTotal = 0;
  private httpErrorsTotal = 0;
  private ingestJobsCompleted = 0;
  private ingestJobsFailed = 0;
  private staleLocksRecovered = 0;
  private rowsProcessedTotal = 0;
  private webhooksDeliveredTotal = 0;
  private webhooksFailedTotal = 0;
  private webhooksRetriedTotal = 0;
  private lastWorkerTickAt: Date | null = null;

  onModuleInit(): void {
    try {
      this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
      this.eventLoopHistogram.enable();
    } catch {
      // Graceful fallback if perf_hooks histogram unavailable
    }
  }

  onModuleDestroy(): void {
    this.eventLoopHistogram?.disable();
  }

  recordHttpRequest(path: string, statusCode: number, durationMs: number): void {
    this.httpRequestsTotal += 1;
    if (statusCode >= 500) {
      this.httpErrorsTotal += 1;
    }

    if (path.startsWith('/v1/ingests')) {
      this.pushSample(this.ingestHttpSamples, durationMs);
    } else if (
      path === '/health' ||
      path === '/healthz' ||
      path === '/readyz'
    ) {
      this.pushSample(this.healthHttpSamples, durationMs);
    }
  }

  recordWorkerJob(durationMs: number, rowCount: number, success: boolean): void {
    this.lastWorkerTickAt = new Date();
    if (success) {
      this.ingestJobsCompleted += 1;
      this.rowsProcessedTotal += rowCount;
      this.pushSample(this.workerJobSamples, durationMs);
    } else {
      this.ingestJobsFailed += 1;
    }
  }

  recordWorkerHeartbeat(): void {
    this.lastWorkerTickAt = new Date();
  }

  recordStaleLockRecovery(count: number): void {
    this.staleLocksRecovered += count;
  }

  recordWebhookDelivery(status: 'delivered' | 'retrying' | 'exhausted'): void {
    if (status === 'delivered') {
      this.webhooksDeliveredTotal += 1;
    } else if (status === 'retrying') {
      this.webhooksRetriedTotal += 1;
    } else {
      this.webhooksFailedTotal += 1;
    }
  }

  getIngestHttpStats(): LatencyPercentiles {
    return computePercentiles(this.ingestHttpSamples);
  }

  getHealthHttpStats(): LatencyPercentiles {
    return computePercentiles(this.healthHttpSamples);
  }

  getWorkerJobStats(): LatencyPercentiles {
    return computePercentiles(this.workerJobSamples);
  }

  getRuntimeStats() {
    const mem = process.memoryUsage();
    const loopLagP99Ms = this.eventLoopHistogram
      ? Number((this.eventLoopHistogram.percentile(99) / 1e6).toFixed(2))
      : 0;

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      eventLoopLagP99Ms: Number.isFinite(loopLagP99Ms) ? loopLagP99Ms : 0,
      lastWorkerTickAt: this.lastWorkerTickAt,
    };
  }

  getSlos(): {
    overallCompliant: boolean;
    objectives: SloStatus[];
  } {
    const ingestStats = this.getIngestHttpStats();
    const healthStats = this.getHealthHttpStats();

    const objectives: SloStatus[] = [
      {
        name: 'Ingest API Latency (p95 < 200ms)',
        targetP95Ms: 200,
        actualP95Ms: ingestStats.p95Ms,
        compliant: ingestStats.p95Ms <= 200,
        sampleCount: ingestStats.count,
        errorBudgetRemainingPct: errorBudgetRemainingPct(
          this.ingestHttpSamples,
          200,
        ),
      },
      {
        name: 'Health Probe Latency (p95 < 50ms)',
        targetP95Ms: 50,
        actualP95Ms: healthStats.p95Ms,
        compliant: healthStats.p95Ms <= 50,
        sampleCount: healthStats.count,
        errorBudgetRemainingPct: errorBudgetRemainingPct(
          this.healthHttpSamples,
          50,
        ),
      },
    ];

    return {
      overallCompliant: objectives.every((o) => o.compliant),
      objectives,
    };
  }

  getCounters() {
    return {
      httpRequestsTotal: this.httpRequestsTotal,
      httpErrorsTotal: this.httpErrorsTotal,
      ingestJobsCompleted: this.ingestJobsCompleted,
      ingestJobsFailed: this.ingestJobsFailed,
      staleLocksRecovered: this.staleLocksRecovered,
      rowsProcessedTotal: this.rowsProcessedTotal,
      webhooksDeliveredTotal: this.webhooksDeliveredTotal,
      webhooksRetriedTotal: this.webhooksRetriedTotal,
      webhooksFailedTotal: this.webhooksFailedTotal,
    };
  }

  toPrometheusText(workerOverride?: LatencyPercentiles): string {
    const ingest = this.getIngestHttpStats();
    const health = this.getHealthHttpStats();
    const worker = workerOverride ?? this.getWorkerJobStats();
    const runtime = this.getRuntimeStats();

    const lines = [
      '# HELP signaldesk_uptime_seconds Process uptime in seconds',
      '# TYPE signaldesk_uptime_seconds gauge',
      `signaldesk_uptime_seconds ${runtime.uptimeSeconds}`,
      '# HELP signaldesk_http_requests_total Total HTTP requests processed',
      '# TYPE signaldesk_http_requests_total counter',
      `signaldesk_http_requests_total ${this.httpRequestsTotal}`,
      '# HELP signaldesk_http_errors_total Total HTTP 5xx responses',
      '# TYPE signaldesk_http_errors_total counter',
      `signaldesk_http_errors_total ${this.httpErrorsTotal}`,
      '# HELP signaldesk_ingest_http_duration_ms Ingest HTTP latency percentiles in ms',
      '# TYPE signaldesk_ingest_http_duration_ms summary',
      `signaldesk_ingest_http_duration_ms{quantile="0.5"} ${ingest.p50Ms}`,
      `signaldesk_ingest_http_duration_ms{quantile="0.95"} ${ingest.p95Ms}`,
      `signaldesk_ingest_http_duration_ms{quantile="0.99"} ${ingest.p99Ms}`,
      `signaldesk_ingest_http_duration_ms_count ${ingest.count}`,
      '# HELP signaldesk_health_http_duration_ms Health endpoint latency percentiles in ms',
      '# TYPE signaldesk_health_http_duration_ms summary',
      `signaldesk_health_http_duration_ms{quantile="0.5"} ${health.p50Ms}`,
      `signaldesk_health_http_duration_ms{quantile="0.95"} ${health.p95Ms}`,
      `signaldesk_health_http_duration_ms{quantile="0.99"} ${health.p99Ms}`,
      `signaldesk_health_http_duration_ms_count ${health.count}`,
      '# HELP signaldesk_worker_job_duration_ms Worker CSV processing duration percentiles in ms',
      '# TYPE signaldesk_worker_job_duration_ms summary',
      `signaldesk_worker_job_duration_ms{quantile="0.5"} ${worker.p50Ms}`,
      `signaldesk_worker_job_duration_ms{quantile="0.95"} ${worker.p95Ms}`,
      `signaldesk_worker_job_duration_ms{quantile="0.99"} ${worker.p99Ms}`,
      `signaldesk_worker_job_duration_ms_count ${worker.count}`,
      '# HELP signaldesk_ingest_rows_processed_total Total catalog rows processed by worker',
      '# TYPE signaldesk_ingest_rows_processed_total counter',
      `signaldesk_ingest_rows_processed_total ${this.rowsProcessedTotal}`,
      '# HELP signaldesk_webhook_deliveries_total Total webhook delivery attempts by status',
      '# TYPE signaldesk_webhook_deliveries_total counter',
      `signaldesk_webhook_deliveries_total{status="delivered"} ${this.webhooksDeliveredTotal}`,
      `signaldesk_webhook_deliveries_total{status="retrying"} ${this.webhooksRetriedTotal}`,
      `signaldesk_webhook_deliveries_total{status="exhausted"} ${this.webhooksFailedTotal}`,
      '# HELP nodejs_eventloop_lag_p99_ms Node.js event loop p99 delay in ms',
      '# TYPE nodejs_eventloop_lag_p99_ms gauge',
      `nodejs_eventloop_lag_p99_ms ${runtime.eventLoopLagP99Ms}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${runtime.rssBytes}`,
    ];

    return `${lines.join('\n')}\n`;
  }

  private pushSample(bucket: number[], value: number): void {
    if (bucket.length >= MAX_SAMPLES) {
      bucket.shift();
    }
    bucket.push(Number(value.toFixed(2)));
  }
}

export function errorBudgetRemainingPct(
  samples: number[],
  targetMs: number,
  slo = 0.95,
): number {
  if (samples.length === 0) {
    return 100;
  }
  const within = samples.filter((s) => s <= targetMs).length / samples.length;
  return Math.max(
    0,
    Math.min(100, Number((((within - slo) / (1 - slo)) * 100).toFixed(1))),
  );
}

export function computePercentiles(samples: number[]): LatencyPercentiles {
  if (samples.length === 0) {
    return { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p: number) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
    );
    return sorted[idx];
  };
  return {
    count: sorted.length,
    p50Ms: pick(50),
    p95Ms: pick(95),
    p99Ms: pick(99),
    maxMs: sorted[sorted.length - 1],
  };
}
