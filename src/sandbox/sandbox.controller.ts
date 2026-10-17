import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
} from '../auth/api-key.crypto';
import { IngestProcessor } from '../ingests/ingest.processor';
import { MetricsService } from '../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';

const SANDBOX_INITIAL_CSV = [
  'sku,name,price,stock,status',
  'DMS-100,Cloud Edge Router X1,249.99,42,active',
  'DMS-101,Ingress Gateway,189.00,0,out_of_stock',
  'DMS-102,Zero-Trust Hardware Token,,18,active',
  'DMS-103,Fiber Uplink Transceiver 40G,64.50,0,out_of_stock',
  'DMS-104,Rackmount PDU Telemetry Unit,310.00,14,active',
  'DMS-105,Kubernetes Node Appliance,1290.00,6,active',
  'DMS-106,HSM Crypto Accelerator,,0,out_of_stock',
  'DMS-107,NVMe Storage Array 16TB,840.00,9,active',
  'DMS-108,,95.00,25,active',
  'DMS-109,Redundant Power Supply 1200W,175.00,110,active',
].join('\n');

@Controller('v1/sandbox')
export class SandboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Built-in loopback webhook sink for live sandbox verification.
   */
  @Post('webhook-sink')
  @HttpCode(200)
  webhookSink(
    @Headers('x-signaldesk-signature') signature: string | undefined,
    @Headers('x-signaldesk-event') event: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return {
      received: true,
      verifiedHeaderFormat: Boolean(signature?.startsWith('t=')),
      event: event ?? body?.event ?? 'unknown',
      receivedAt: new Date().toISOString(),
    };
  }

  /**
   * Provisions an interactive sandbox workspace with sample catalog & loopback webhook
   * so engineers and hiring managers can explore the full control plane in 1 click.
   */
  @Post('provision')
  @HttpCode(201)
  async provisionSandbox() {
    const rawKey = generateApiKey();
    const webhookSecret = `whsec_${randomBytes(24).toString('base64url')}`;
    const port = Number(process.env.PORT) || 3010;
    const baseUrl = (
      process.env.SANDBOX_SINK_BASE_URL || `http://127.0.0.1:${port}`
    ).replace(/\/+$/, '');
    const sinkUrl = `${baseUrl}/v1/sandbox/webhook-sink`;

    const suffix = randomBytes(2).toString('hex').toUpperCase();
    const workspace = await this.prisma.workspace.create({
      data: {
        name: `Sandbox ${suffix}`,
        apiKeys: {
          create: {
            name: 'sandbox-primary',
            keyPrefix: apiKeyPrefix(rawKey),
            keyHash: hashApiKey(rawKey),
          },
        },
        webhook: {
          create: {
            url: sinkUrl,
            secret: webhookSecret,
          },
        },
      },
    });

    const csvBuf = Buffer.from(SANDBOX_INITIAL_CSV, 'utf8');
    const ingest = await this.prisma.ingest.create({
      data: {
        workspaceId: workspace.id,
        ingestKey: `ing_seed_${suffix.toLowerCase()}`,
        filename: 'deimos-infra-catalog.csv',
        byteSize: csvBuf.length,
        csvBytes: new Uint8Array(csvBuf),
        status: 'pending',
      },
    });

    const processor = new IngestProcessor(this.prisma, this.metrics);
    await processor.process(ingest.id);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt,
      },
      apiKey: rawKey,
      webhook: {
        url: sinkUrl,
        secret: webhookSecret,
      },
      seedIngestId: ingest.id,
    };
  }
}
