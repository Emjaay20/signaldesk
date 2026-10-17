import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { IngestProcessor } from '../src/ingests/ingest.processor';
import { MetricsService } from '../src/observability/metrics.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Principal Platform Capabilities (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let metrics: MetricsService;
  let processor: IngestProcessor;
  let apiKey: string;
  let workspaceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    metrics = app.get(MetricsService);
    processor = new IngestProcessor(prisma, metrics);

    const created = await request(app.getHttpServer())
      .post('/v1/workspaces')
      .set('x-admin-token', process.env.ADMIN_TOKEN as string)
      .send({ name: 'Deimos Principal Test' })
      .expect(201);

    apiKey = created.body.apiKey;
    workspaceId = created.body.workspace.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('propagates x-correlation-id and rate-limit headers on responses', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-api-key', apiKey)
      .set('x-correlation-id', 'corr_custom_trace_99')
      .expect(200);

    expect(res.headers['x-correlation-id']).toBe('corr_custom_trace_99');
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('supports zero-downtime API key rotation and revocation', async () => {
    const rotated = await request(app.getHttpServer())
      .post('/v1/api-keys')
      .set('x-api-key', apiKey)
      .send({ name: 'ci-deploy-key' })
      .expect(201);

    expect(rotated.body.apiKey).toMatch(/^sd_live_/);
    const secondKey = rotated.body.apiKey;

    // Newly minted key authenticates immediately
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-api-key', secondKey)
      .expect(200);

    // List keys shows both keys
    const list = await request(app.getHttpServer())
      .get('/v1/api-keys')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);

    // Revoke the secondary key
    await request(app.getHttpServer())
      .delete(`/v1/api-keys/${rotated.body.id}`)
      .set('x-api-key', apiKey)
      .expect(200);

    // Revoked key is immediately rejected with 401
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-api-key', secondKey)
      .expect(401);
  });

  it('flags missing_name SKUs during CSV ingest and supports manual operator case resolution', async () => {
    const csv = Buffer.from(
      'sku,name,price,stock,status\nSKU-NONAME,,19.99,10,active\n',
    );
    const created = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'ing_missing_name_1')
      .attach('file', csv, 'missing-name.csv')
      .expect(202);

    await processor.process(created.body.id);

    const cases = await request(app.getHttpServer())
      .get('/v1/cases?status=open')
      .set('x-api-key', apiKey)
      .expect(200);

    const missingNameCase = cases.body.find(
      (c: { sku: string }) => c.sku === 'SKU-NONAME',
    );
    expect(missingNameCase).toBeDefined();
    expect(missingNameCase.reasons).toContain('missing_name');

    // Operator manually resolves the case
    const resolved = await request(app.getHttpServer())
      .post(`/v1/cases/${missingNameCase.id}/resolve`)
      .set('x-api-key', apiKey)
      .send({ resolution: 'catalog_team_verified' })
      .expect(200);

    expect(resolved.body.status).toBe('closed');
    expect(resolved.body.resolution).toBe('catalog_team_verified');
  });

  it('reclaims stale processing locks when a worker crashes mid-ingest', async () => {
    const csv = Buffer.from(
      'sku,name,price,stock\nSTALE-1,Recovered Widget,15.00,20\n',
    );
    const ingest = await prisma.ingest.create({
      data: {
        workspaceId,
        ingestKey: 'ing_stale_lock_test',
        filename: 'stale.csv',
        byteSize: csv.length,
        csvBytes: new Uint8Array(csv),
        status: 'processing',
        attempts: 1,
        lockedAt: new Date(Date.now() - 300_000), // 5 minutes ago (expired)
        lockedBy: 'crashed_worker_01',
      },
    });

    const reclaimedCount = await processor.reclaimStaleLocks();
    expect(reclaimedCount).toBeGreaterThanOrEqual(1);

    const afterReclaim = await prisma.ingest.findUnique({
      where: { id: ingest.id },
    });
    expect(afterReclaim?.status).toBe('pending');

    await processor.process(ingest.id);
    const completed = await prisma.ingest.findUnique({
      where: { id: ingest.id },
    });
    expect(completed?.status).toBe('complete');
    expect(completed?.rowCount).toBe(1);
  });

  it('rejects SSRF metadata webhook targets and records/replays webhook deliveries in the outbox', async () => {
    // Reject AWS/cloud metadata SSRF URL
    await request(app.getHttpServer())
      .post('/v1/webhooks')
      .set('x-api-key', apiKey)
      .send({ url: 'http://169.254.169.254/latest/meta-data/' })
      .expect(400);

    // Start local receiver that fails first request (503) and succeeds on replay (200)
    let attemptCount = 0;
    const server: Server = createServer(
      (_req: IncomingMessage, res: ServerResponse) => {
        attemptCount += 1;
        if (attemptCount === 1) {
          res.writeHead(503);
          res.end('temporary outage');
        } else {
          res.writeHead(200);
          res.end('ok');
        }
      },
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const hookUrl = `http://127.0.0.1:${port}/flaky-hook`;

    try {
      await request(app.getHttpServer())
        .post('/v1/webhooks')
        .set('x-api-key', apiKey)
        .send({ url: hookUrl })
        .expect(201);

      const ingest = await request(app.getHttpServer())
        .post('/v1/ingests')
        .set('x-api-key', apiKey)
        .set('x-ingest-id', 'ing_outbox_retry_1')
        .attach(
          'file',
          Buffer.from('sku,name,price,stock\nOUTBOX-1,Flaky Target SKU,9.99,0\n'),
          'outbox.csv',
        )
        .expect(202);

      await processor.process(ingest.body.id);

      const deliveries = await request(app.getHttpServer())
        .get('/v1/webhooks/deliveries')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(deliveries.body.length).toBeGreaterThanOrEqual(1);
      const firstDelivery = deliveries.body[0];
      expect(firstDelivery.status).toBe('retrying');
      expect(firstDelivery.lastStatusCode).toBe(503);

      // Replay the failed delivery -> receiver now returns 200 OK
      const replayed = await request(app.getHttpServer())
        .post(`/v1/webhooks/deliveries/${firstDelivery.id}/replay`)
        .set('x-api-key', apiKey)
        .expect(200);

      expect(replayed.body.status).toBe('delivered');
      expect(replayed.body.lastStatusCode).toBe(200);
      expect(replayed.body.attempts).toBe(2);

      // Resolving the open case manually immediately drains the case.resolved webhook
      const openCases = await request(app.getHttpServer())
        .get('/v1/cases?status=open')
        .set('x-api-key', apiKey)
        .expect(200);
      const outboxCase = openCases.body.find(
        (c: { sku: string }) => c.sku === 'OUTBOX-1',
      );
      expect(outboxCase).toBeDefined();

      await request(app.getHttpServer())
        .post(`/v1/cases/${outboxCase.id}/resolve`)
        .set('x-api-key', apiKey)
        .send({ resolution: 'manual_hotfix_applied' })
        .expect(200);

      const deliveriesAfterResolve = await request(app.getHttpServer())
        .get('/v1/webhooks/deliveries')
        .set('x-api-key', apiKey)
        .expect(200);
      const resolvedDelivery = deliveriesAfterResolve.body.find(
        (d: { eventType: string }) => d.eventType === 'case.resolved',
      );
      expect(resolvedDelivery).toBeDefined();
      expect(resolvedDelivery.status).toBe('delivered');
      expect(resolvedDelivery.lastStatusCode).toBe(200);
    } finally {
      server.close();
    }
  });

  it('exposes Prometheus /metrics, /v1/telemetry, /v1/catalog/summary, and 1-click sandbox provisioning', async () => {
    const summary = await request(app.getHttpServer())
      .get('/v1/catalog/summary')
      .set('x-api-key', apiKey)
      .expect(200);

    expect(summary.body.totalProducts).toBeGreaterThanOrEqual(2);
    expect(summary.body.storageProvider).toBe('postgres-bytea');

    const prom = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(prom.text).toContain('signaldesk_http_requests_total');
    expect(prom.text).toContain('signaldesk_ingest_http_duration_ms');

    const telemetry = await request(app.getHttpServer())
      .get('/v1/telemetry')
      .expect(200);
    expect(telemetry.body.status).toBe('operational');
    expect(telemetry.body.slos.objectives).toHaveLength(2);

    const sandbox = await request(app.getHttpServer())
      .post('/v1/sandbox/provision')
      .expect(201);
    expect(sandbox.body.apiKey).toMatch(/^sd_live_/);
    expect(sandbox.body.workspace.name).toContain('Sandbox');

    const docsPage = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(docsPage.text).toContain('<div id="root"></div>');

    const archPage = await request(app.getHttpServer())
      .get('/architecture')
      .expect(200);
    expect(archPage.text).toContain('<div id="root"></div>');
  });
});
