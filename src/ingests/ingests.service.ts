import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Workspace } from '@prisma/client';
import { MultiCloudBlobStorageAdapter } from '../common/ports/blob-storage.port';
import { MetricsService } from '../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueWebhookEvent } from '../webhooks/deliver';
import { IngestProcessor } from './ingest.processor';

const MAX_BYTES = 5 * 1024 * 1024;

export type IngestView = {
  id: string;
  ingestId: string;
  status: string;
  filename: string | null;
  byteSize: number;
  rowCount: number | null;
  error: string | null;
  attempts?: number;
  durationMs?: number | null;
  storageUri?: string;
  createdAt: Date;
  completedAt: Date | null;
};

@Injectable()
export class IngestsService {
  private readonly storagePort = new MultiCloudBlobStorageAdapter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async create(
    workspace: Workspace,
    ingestKey: string | undefined,
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
  ): Promise<IngestView> {
    const key = ingestKey?.trim();
    if (!key) {
      throw new BadRequestException('x-ingest-id header is required');
    }
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('CSV file is required');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('CSV exceeds 5MB limit');
    }
    if (!hasSkuAndNameHeader(file.buffer)) {
      throw new BadRequestException('CSV must include sku and name columns');
    }

    const existing = await this.prisma.ingest.findUnique({
      where: {
        workspaceId_ingestKey: {
          workspaceId: workspace.id,
          ingestKey: key,
        },
      },
    });
    if (existing) {
      return this.toView(existing);
    }

    const blob = this.storagePort.put({
      workspaceId: workspace.id,
      ingestKey: key,
      filename: file.originalname,
      byteSize: file.size,
      bytes: file.buffer,
    });

    const created = await this.prisma.ingest.create({
      data: {
        workspaceId: workspace.id,
        ingestKey: key,
        filename: file.originalname,
        byteSize: blob.byteSize,
        csvBytes: new Uint8Array(file.buffer),
        status: 'pending',
      },
    });
    return this.toView(created);
  }

  async get(workspace: Workspace, id: string): Promise<IngestView | null> {
    const ingest = await this.prisma.ingest.findFirst({
      where: { id, workspaceId: workspace.id },
    });
    return ingest ? this.toView(ingest) : null;
  }

  async listIngests(workspace: Workspace, limit = 20): Promise<IngestView[]> {
    const rows = await this.prisma.ingest.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true,
        workspaceId: true,
        ingestKey: true,
        status: true,
        filename: true,
        byteSize: true,
        rowCount: true,
        error: true,
        attempts: true,
        durationMs: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return rows.map((r) => this.toView(r));
  }

  async triggerProcess(
    workspace: Workspace,
    id: string,
  ): Promise<IngestView> {
    const ingest = await this.prisma.ingest.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!ingest) {
      throw new NotFoundException('Ingest job not found');
    }
    const processor = new IngestProcessor(this.prisma, this.metrics);
    await processor.process(id);
    const updated = await this.get(workspace, id);
    if (!updated) {
      throw new NotFoundException('Ingest job not found');
    }
    return updated;
  }

  async listProducts(
    workspace: Workspace,
    filters?: { healthy?: string; q?: string },
  ) {
    const healthyFilter =
      filters?.healthy === 'true'
        ? true
        : filters?.healthy === 'false'
          ? false
          : undefined;
    const query = filters?.q?.trim();

    return this.prisma.product.findMany({
      where: {
        workspaceId: workspace.id,
        ...(healthyFilter !== undefined ? { healthy: healthyFilter } : {}),
        ...(query
          ? {
              OR: [
                { sku: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { sku: 'asc' },
      select: {
        id: true,
        sku: true,
        name: true,
        price: true,
        stock: true,
        status: true,
        healthScore: true,
        healthReasons: true,
        healthy: true,
        updatedAt: true,
      },
    });
  }

  async listCases(
    workspace: Workspace,
    filters?: { status?: string; q?: string },
  ) {
    const query = filters?.q?.trim();
    return this.prisma.healthCase.findMany({
      where: {
        workspaceId: workspace.id,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(query
          ? { sku: { contains: query, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { openedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        sku: true,
        status: true,
        reasons: true,
        resolution: true,
        openedAt: true,
        closedAt: true,
        productId: true,
      },
    });
  }

  async resolveCase(
    workspace: Workspace,
    caseId: string,
    resolutionNote = 'operator_resolved',
  ) {
    const target = await this.prisma.healthCase.findFirst({
      where: { id: caseId, workspaceId: workspace.id },
    });
    if (!target) {
      throw new NotFoundException('Health case not found');
    }
    if (target.status === 'closed') {
      return target;
    }

    const product = await this.prisma.product.findUnique({
      where: { id: target.productId },
      select: { name: true, healthScore: true },
    });

    const closedCase = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.healthCase.update({
        where: { id: target.id },
        data: {
          status: 'closed',
          resolution: resolutionNote.trim() || 'operator_resolved',
          closedAt: new Date(),
        },
        select: {
          id: true,
          sku: true,
          status: true,
          reasons: true,
          resolution: true,
          openedAt: true,
          closedAt: true,
          productId: true,
        },
      });

      const endpoint = await tx.webhookEndpoint.findUnique({
        where: { workspaceId: workspace.id },
      });
      await enqueueWebhookEvent(
        tx,
        endpoint
          ? { id: endpoint.id, url: endpoint.url, secret: endpoint.secret }
          : null,
        {
          eventType: 'case.resolved',
          workspaceId: workspace.id,
          caseId: closed.id,
          sku: closed.sku,
          name: product?.name ?? closed.sku,
          healthScore: product?.healthScore ?? 0,
          resolution: closed.resolution ?? 'operator_resolved',
        },
      );

      return closed;
    });

    // Drain due outbox events immediately so manual case resolutions dispatch
    // webhooks with low latency even when no background worker is polling.
    const processor = new IngestProcessor(this.prisma, this.metrics);
    await processor.processRetryableWebhooks();

    return closedCase;
  }

  async getCatalogSummary(workspace: Workspace) {
    const [
      totals,
      healthyProducts,
      openCasesCount,
      closedCasesCount,
      ingestsCount,
      reasonRows,
    ] = await Promise.all([
      this.prisma.product.aggregate({
        where: { workspaceId: workspace.id },
        _count: { _all: true },
        _avg: { healthScore: true },
      }),
      this.prisma.product.count({
        where: { workspaceId: workspace.id, healthy: true },
      }),
      this.prisma.healthCase.count({
        where: { workspaceId: workspace.id, status: 'open' },
      }),
      this.prisma.healthCase.count({
        where: { workspaceId: workspace.id, status: 'closed' },
      }),
      this.prisma.ingest.count({
        where: { workspaceId: workspace.id },
      }),
      this.prisma.$queryRaw<Array<{ reason: string; count: number }>>`
        SELECT reason, COUNT(*)::int AS count
        FROM (
          SELECT unnest("healthReasons") AS reason
          FROM "Product"
          WHERE "workspaceId" = ${workspace.id}
        ) t
        GROUP BY reason
      `,
    ]);

    const totalProducts = totals._count._all;
    const reasonBreakdown: Record<string, number> = {
      out_of_stock: 0,
      missing_price: 0,
      missing_name: 0,
    };
    for (const row of reasonRows) {
      reasonBreakdown[row.reason] = Number(row.count);
    }

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      storageProvider: this.storagePort.provider,
      totalProducts,
      healthyProducts,
      unhealthyProducts: totalProducts - healthyProducts,
      averageHealthScore:
        totalProducts > 0 ? Math.round(totals._avg.healthScore ?? 100) : 100,
      openCasesCount,
      closedCasesCount,
      totalIngestsCount: ingestsCount,
      reasonBreakdown,
    };
  }

  private toView(ingest: {
    id: string;
    workspaceId?: string;
    ingestKey: string;
    status: string;
    filename: string | null;
    byteSize: number;
    rowCount: number | null;
    error: string | null;
    attempts?: number;
    durationMs?: number | null;
    createdAt: Date;
    completedAt: Date | null;
  }): IngestView {
    return {
      id: ingest.id,
      ingestId: ingest.ingestKey,
      status: ingest.status,
      filename: ingest.filename,
      byteSize: ingest.byteSize,
      rowCount: ingest.rowCount,
      error: ingest.error,
      attempts: ingest.attempts ?? 0,
      durationMs: ingest.durationMs ?? null,
      storageUri: ingest.workspaceId
        ? this.storagePort.buildObjectUri(
            ingest.workspaceId,
            ingest.ingestKey,
            ingest.filename ?? undefined,
          )
        : undefined,
      createdAt: ingest.createdAt,
      completedAt: ingest.completedAt,
    };
  }
}

function hasSkuAndNameHeader(buf: Buffer): boolean {
  const first = buf.toString('utf8').split(/\r?\n/, 1)[0] ?? '';
  const cols = first.split(',').map((c) => c.trim().toLowerCase());
  return cols.includes('sku') && cols.includes('name');
}
