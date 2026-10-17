import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { MultiCloudBlobStorageAdapter } from '../common/ports/blob-storage.port';
import { scoreProduct } from '../health/score';
import { MetricsService } from '../observability/metrics.service';
import {
  attemptSignedPost,
  CaseOpenedEvent,
  CaseResolvedEvent,
  computeBackoffMs,
  enqueueWebhookEvent,
  WebhookEndpointRef,
} from '../webhooks/deliver';

type Db = PrismaClient | Prisma.TransactionClient;

const DEFAULT_CHUNK_SIZE = 250;
const STALE_LEASE_MS = Number(process.env.INGEST_STALE_LEASE_MS) || 120_000;
const MAX_INGEST_ATTEMPTS = 3;

export type ProductRow = {
  sku: string;
  name: string;
  price: number | null;
  stock: number | null;
  status: string | null;
};

export class IngestProcessor {
  private readonly workerId: string;
  private readonly storage = new MultiCloudBlobStorageAdapter();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly metrics?: MetricsService,
    workerId?: string,
  ) {
    this.workerId =
      workerId ?? `worker_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  }

  /**
   * Reclaims jobs stuck in `processing` whose worker lease expired (e.g. OOM or SIGKILL).
   * Jobs that exceeded MAX_INGEST_ATTEMPTS are moved to dead-letter (`failed`).
   */
  async reclaimStaleLocks(
    staleBefore = new Date(Date.now() - STALE_LEASE_MS),
  ): Promise<number> {
    const expired = await this.prisma.ingest.updateMany({
      where: {
        status: 'processing',
        lockedAt: { lt: staleBefore },
        attempts: { gte: MAX_INGEST_ATTEMPTS },
      },
      data: {
        status: 'failed',
        error: 'Worker lease expired after maximum retry attempts',
        completedAt: new Date(),
      },
    });

    const reclaimed = await this.prisma.ingest.updateMany({
      where: {
        status: 'processing',
        lockedAt: { lt: staleBefore },
        attempts: { lt: MAX_INGEST_ATTEMPTS },
      },
      data: {
        status: 'pending',
        lockedAt: null,
        lockedBy: null,
      },
    });

    const total = expired.count + reclaimed.count;
    if (total > 0) {
      this.metrics?.recordStaleLockRecovery(total);
    }
    return total;
  }

  async processPending(limit = 5): Promise<number> {
    this.metrics?.recordWorkerHeartbeat();
    await this.reclaimStaleLocks();

    const jobs = await this.prisma.ingest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    let done = 0;
    for (const job of jobs) {
      const processed = await this.process(job.id);
      if (processed) {
        done += 1;
      }
    }

    await this.processRetryableWebhooks();
    return done;
  }

  async process(ingestId: string): Promise<boolean> {
    const startMs = Date.now();
    const claimed = await this.prisma.ingest.updateMany({
      where: { id: ingestId, status: 'pending' },
      data: {
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: this.workerId,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      return false;
    }

    const ingest = await this.prisma.ingest.findUnique({
      where: { id: ingestId },
    });
    if (!ingest) {
      return false;
    }

    try {
      const endpoint = await this.prisma.webhookEndpoint.findUnique({
        where: { workspaceId: ingest.workspaceId },
      });
      const endpointRef: WebhookEndpointRef | null = endpoint
        ? { id: endpoint.id, url: endpoint.url, secret: endpoint.secret }
        : null;

      let totalRows = 0;
      const csvBytes = this.storage.load(ingest.csvBytes);

      for await (const chunk of streamCsvChunks(csvBytes, DEFAULT_CHUNK_SIZE)) {
        totalRows += chunk.length;
        await this.prisma.$transaction(async (tx) => {
          await upsertProductChunk(tx, ingest.workspaceId, chunk, endpointRef);
        });
      }

      const durationMs = Math.max(1, Date.now() - startMs);
      await this.prisma.ingest.update({
        where: { id: ingest.id },
        data: {
          status: 'complete',
          rowCount: totalRows,
          durationMs,
          lockedAt: null,
          completedAt: new Date(),
          error: null,
        },
      });
      this.metrics?.recordWorkerJob(durationMs, totalRows, true);

      await this.processRetryableWebhooks();
      return true;
    } catch (err) {
      const durationMs = Math.max(1, Date.now() - startMs);
      const message = err instanceof Error ? err.message : 'ingest failed';
      await this.prisma.ingest.update({
        where: { id: ingest.id },
        data: {
          status: 'failed',
          error: message,
          durationMs,
          lockedAt: null,
          completedAt: new Date(),
        },
      });
      this.metrics?.recordWorkerJob(durationMs, 0, false);
      return false;
    }
  }

  /**
   * Drains due webhook deliveries in the transactional outbox using exponential backoff.
   */
  async processRetryableWebhooks(limit = 50): Promise<number> {
    let retried = 0;
    for (;;) {
      const n = await this.drainDueWebhooks(limit);
      retried += n;
      if (n < limit) {
        break;
      }
    }
    return retried;
  }

  private async drainDueWebhooks(limit: number): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: { in: ['pending', 'retrying'] },
        nextAttemptAt: { lte: new Date() },
      },
      include: { endpoint: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });

    let retried = 0;
    for (const delivery of due) {
      // Atomically claim the outbox row with a 30s lease window to prevent
      // duplicate concurrent deliveries across worker replicas and inline drains.
      const claimNow = new Date();
      const claimed = await this.prisma.webhookDelivery.updateMany({
        where: {
          id: delivery.id,
          status: { in: ['pending', 'retrying'] },
          nextAttemptAt: { lte: claimNow },
        },
        data: {
          status: 'retrying',
          nextAttemptAt: new Date(claimNow.getTime() + 30_000),
        },
      });
      if (claimed.count !== 1) {
        continue;
      }

      const secret = delivery.endpoint?.secret;
      const targetUrl = delivery.endpoint?.url ?? delivery.targetUrl;
      if (!secret || !targetUrl) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'exhausted', lastError: 'Endpoint removed' },
        });
        continue;
      }

      const result = await attemptSignedPost({
        url: targetUrl,
        secret,
        payload: delivery.payload,
        eventType: delivery.eventType,
        extraHeaders: {
          'x-signaldesk-retry-attempt': String(delivery.attempts + 1),
        },
      });

      const attempts = delivery.attempts + 1;
      const status = result.ok
        ? 'delivered'
        : attempts >= delivery.maxAttempts
          ? 'exhausted'
          : 'retrying';

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          signature: result.signature,
          status,
          attempts,
          lastStatusCode: result.statusCode,
          lastError: result.errorMsg,
          durationMs: result.durationMs,
          deliveredAt: result.ok ? new Date() : null,
          nextAttemptAt: new Date(
            Date.now() + computeBackoffMs(attempts, true),
          ),
        },
      });
      this.metrics?.recordWebhookDelivery(status);
      retried += 1;
    }

    return retried;
  }
}

export async function* streamCsvChunks(
  bytes: Buffer,
  chunkSize = DEFAULT_CHUNK_SIZE,
): AsyncGenerator<ProductRow[], void, unknown> {
  const parser = Readable.from(bytes).pipe(
    parse({
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  );

  let batch: ProductRow[] = [];
  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    const sku = (record.sku ?? '').trim();
    if (!sku) {
      continue;
    }
    const name = (record.name ?? '').trim();
    batch.push({
      sku,
      name,
      price: parseOptionalFloat(record.price),
      stock: parseOptionalInt(record.stock),
      status: record.status?.trim() ? record.status.trim() : null,
    });

    if (batch.length >= chunkSize) {
      yield batch;
      batch = [];
    }
  }

  if (batch.length > 0) {
    yield batch;
  }
}

async function upsertProductChunk(
  tx: Db,
  workspaceId: string,
  rows: ProductRow[],
  endpoint: WebhookEndpointRef | null,
): Promise<void> {
  const dedupedMap = new Map<string, ProductRow>();
  for (const row of rows) {
    dedupedMap.set(row.sku, row);
  }
  const uniqueRows = Array.from(dedupedMap.values());
  const skus = uniqueRows.map((r) => r.sku);

  const scored = uniqueRows.map((row) => ({
    row,
    health: scoreProduct({
      name: row.name,
      price: row.price,
      stock: row.stock,
    }),
  }));

  const [existingOpenCases, existingProducts] = await Promise.all([
    tx.healthCase.findMany({
      where: {
        workspaceId,
        sku: { in: skus },
        status: 'open',
      },
    }),
    tx.product.findMany({
      where: { workspaceId, sku: { in: skus } },
      select: { sku: true },
    }),
  ]);
  const openCaseBySku = new Map(existingOpenCases.map((c) => [c.sku, c]));
  const existingSku = new Set(existingProducts.map((p) => p.sku));

  const toCreate = scored.filter(({ row }) => !existingSku.has(row.sku));
  const toUpdate = scored.filter(({ row }) => existingSku.has(row.sku));

  if (toCreate.length > 0) {
    await tx.product.createMany({
      data: toCreate.map(({ row, health }) => ({
        workspaceId,
        sku: row.sku,
        name: row.name,
        price: row.price,
        stock: row.stock,
        status: row.status,
        healthScore: health.score,
        healthReasons: health.reasons,
        healthy: health.healthy,
      })),
    });
  }

  if (toUpdate.length > 0) {
    await Promise.all(
      toUpdate.map(({ row, health }) =>
        tx.product.update({
          where: { workspaceId_sku: { workspaceId, sku: row.sku } },
          data: {
            name: row.name,
            price: row.price,
            stock: row.stock,
            status: row.status,
            healthScore: health.score,
            healthReasons: health.reasons,
            healthy: health.healthy,
          },
        }),
      ),
    );
  }

  const products = await tx.product.findMany({
    where: { workspaceId, sku: { in: skus } },
  });
  const productBySku = new Map(products.map((p) => [p.sku, p]));

  for (const { row, health } of scored) {
    const product = productBySku.get(row.sku);
    if (!product) {
      continue;
    }

    const open = openCaseBySku.get(row.sku);

    if (!health.healthy) {
      if (open) {
        await tx.healthCase.update({
          where: { id: open.id },
          data: { reasons: health.reasons },
        });
      } else {
        const created = await tx.healthCase.create({
          data: {
            workspaceId,
            productId: product.id,
            sku: product.sku,
            status: 'open',
            reasons: health.reasons,
          },
        });
        openCaseBySku.set(row.sku, created);
        const opened: CaseOpenedEvent = {
          workspaceId,
          caseId: created.id,
          sku: product.sku,
          name: product.name,
          reasons: health.reasons,
          healthScore: health.score,
        };
        await enqueueWebhookEvent(tx, endpoint, {
          eventType: 'case.opened',
          ...opened,
        });
      }
    } else if (open) {
      await tx.healthCase.update({
        where: { id: open.id },
        data: {
          status: 'closed',
          resolution: 'catalog_recovered',
          closedAt: new Date(),
        },
      });
      openCaseBySku.delete(row.sku);
      const resolved: CaseResolvedEvent = {
        workspaceId,
        caseId: open.id,
        sku: product.sku,
        name: product.name,
        healthScore: health.score,
        resolution: 'catalog_recovered',
      };
      await enqueueWebhookEvent(tx, endpoint, {
        eventType: 'case.resolved',
        ...resolved,
      });
    }
  }
}

function parseOptionalFloat(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}
