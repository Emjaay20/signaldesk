import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  computePercentiles,
  MetricsService,
} from './observability/metrics.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('health')
  health(): string {
    return 'OK';
  }

  @Get('healthz')
  healthz(): string {
    return 'OK';
  }

  @Get('readyz')
  async ready(): Promise<string> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'READY';
    } catch {
      throw new ServiceUnavailableException('NOT_READY');
    }
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async prometheusMetrics(): Promise<string> {
    const worker = await this.loadWorkerJobStats();
    return this.metrics.toPrometheusText(worker.stats);
  }

  @Get('v1/telemetry')
  async getTelemetry() {
    const dbStart = Date.now();
    let dbHealthy = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }
    const dbPingMs = Math.max(1, Date.now() - dbStart);

    const [pendingIngests, processingIngests, retryingWebhooks, worker] =
      await Promise.all([
        this.prisma.ingest.count({ where: { status: 'pending' } }),
        this.prisma.ingest.count({ where: { status: 'processing' } }),
        this.prisma.webhookDelivery.count({
          where: { status: { in: ['pending', 'retrying'] } },
        }),
        this.loadWorkerJobStats(),
      ]);

    return {
      status: dbHealthy ? 'operational' : 'degraded',
      database: {
        healthy: dbHealthy,
        pingMs: dbPingMs,
      },
      queues: {
        pendingIngests,
        processingIngests,
        retryingWebhooks,
      },
      slos: this.metrics.getSlos(),
      latencies: {
        ingestHttp: this.metrics.getIngestHttpStats(),
        healthHttp: this.metrics.getHealthHttpStats(),
        workerJob: worker.stats,
      },
      counters: {
        ...this.metrics.getCounters(),
        ingestJobsCompleted: worker.completed,
        ingestJobsFailed: worker.failed,
        rowsProcessedTotal: worker.rowsProcessed,
      },
      runtime: {
        ...this.metrics.getRuntimeStats(),
        lastWorkerTickAt: worker.lastCompletedAt,
      },
    };
  }

  private async loadWorkerJobStats() {
    const jobs = await this.prisma.ingest.findMany({
      where: { completedAt: { not: null }, durationMs: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: 500,
      select: {
        durationMs: true,
        rowCount: true,
        status: true,
        completedAt: true,
      },
    });

    const durations = jobs
      .filter((j) => j.status === 'complete' && j.durationMs != null)
      .map((j) => j.durationMs as number);

    return {
      stats: computePercentiles(durations),
      completed: jobs.filter((j) => j.status === 'complete').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      rowsProcessed: jobs.reduce((sum, j) => sum + (j.rowCount ?? 0), 0),
      lastCompletedAt: jobs[0]?.completedAt ?? null,
    };
  }
}

