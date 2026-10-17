import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Workspace } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { attemptSignedPost, computeBackoffMs } from './deliver';
import { assertSafeWebhookUrl } from './ssrf.guard';

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(workspace: Workspace, url: string) {
    assertSafeWebhookUrl(url);

    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const endpoint = await this.prisma.webhookEndpoint.upsert({
      where: { workspaceId: workspace.id },
      create: { workspaceId: workspace.id, url, secret },
      update: { url, secret },
    });
    return {
      id: endpoint.id,
      url: endpoint.url,
      secret: endpoint.secret,
    };
  }

  async getEndpoint(workspace: Workspace) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { workspaceId: workspace.id },
    });
    if (!endpoint) {
      return null;
    }
    return {
      id: endpoint.id,
      url: endpoint.url,
      secretPreview: `${endpoint.secret.slice(0, 12)}••••••••`,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    };
  }

  async listDeliveries(workspace: Workspace, limit = 25) {
    return this.prisma.webhookDelivery.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true,
        eventType: true,
        targetUrl: true,
        payload: true,
        signature: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        lastStatusCode: true,
        lastError: true,
        durationMs: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
  }

  async replayDelivery(workspace: Workspace, deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, workspaceId: workspace.id },
      include: { endpoint: true },
    });
    if (!delivery) {
      throw new NotFoundException('Webhook delivery record not found');
    }

    const endpoint =
      delivery.endpoint ??
      (await this.prisma.webhookEndpoint.findUnique({
        where: { workspaceId: workspace.id },
      }));

    if (!endpoint?.secret || !endpoint.url) {
      throw new BadRequestException(
        'Webhook endpoint is missing; cannot replay this delivery',
      );
    }

    const targetUrl = endpoint.url;
    const result = await attemptSignedPost({
      url: targetUrl,
      secret: endpoint.secret,
      payload: delivery.payload,
      eventType: delivery.eventType,
      extraHeaders: { 'x-signaldesk-replay': 'true' },
    });

    const attempts = delivery.attempts + 1;
    const status = result.ok
      ? 'delivered'
      : attempts >= delivery.maxAttempts
        ? 'exhausted'
        : 'retrying';

    return this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        targetUrl,
        signature: result.signature,
        status,
        attempts,
        lastStatusCode: result.statusCode,
        lastError: result.errorMsg,
        durationMs: result.durationMs,
        deliveredAt: result.ok ? new Date() : delivery.deliveredAt,
        nextAttemptAt: new Date(
          Date.now() + computeBackoffMs(attempts, true),
        ),
      },
    });
  }
}
