import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { IngestProcessor } from '../src/ingests/ingest.processor';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifyWebhook } from '../src/webhooks/signature';

type Captured = { body: string; signature: string };

function listenReceiver(): Promise<{
  server: Server;
  url: string;
  hits: Captured[];
}> {
  const hits: Captured[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      hits.push({
        body: Buffer.concat(chunks).toString('utf8'),
        signature: String(req.headers['x-signaldesk-signature'] ?? ''),
      });
      res.writeHead(200);
      res.end('ok');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/hook`, hits });
    });
  });
}

describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let apiKey: string;
  let processor: IngestProcessor;
  let receiver: { server: Server; url: string; hits: Captured[] };

  beforeAll(async () => {
    receiver = await listenReceiver();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    processor = new IngestProcessor(app.get(PrismaService));

    const created = await request(app.getHttpServer())
      .post('/v1/workspaces')
      .set('x-admin-token', process.env.ADMIN_TOKEN as string)
      .send({ name: 'Webhook Co' })
      .expect(201);
    apiKey = created.body.apiKey;
  });

  afterAll(async () => {
    receiver.server.close();
    await app.close();
  });

  it('rejects webhook register without an api key', async () => {
    await request(app.getHttpServer())
      .post('/v1/webhooks')
      .send({ url: receiver.url })
      .expect(401);
  });

  it('posts a signed case.opened event when a case opens', async () => {
    const registered = await request(app.getHttpServer())
      .post('/v1/webhooks')
      .set('x-api-key', apiKey)
      .send({ url: receiver.url })
      .expect(201);

    expect(registered.body.secret).toMatch(/^whsec_/);
    expect(registered.body.url).toBe(receiver.url);

    const ingest = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'wh_open_1')
      .attach(
        'file',
        Buffer.from('sku,name,price,stock\nWH-1,Broken Hub,9.99,0\n'),
        'products.csv',
      )
      .expect(202);

    await processor.process(ingest.body.id);

    expect(receiver.hits).toHaveLength(1);
    const payload = JSON.parse(receiver.hits[0].body);
    expect(payload.event).toBe('case.opened');
    expect(payload.case.sku).toBe('WH-1');
    expect(payload.case.reasons).toContain('out_of_stock');
    expect(
      verifyWebhook(
        registered.body.secret,
        receiver.hits[0].signature,
        receiver.hits[0].body,
        Date.now(),
      ),
    ).toBe(true);
  });

  it('does not send again for the same open sku', async () => {
    const before = receiver.hits.length;
    const ingest = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'wh_open_2')
      .attach(
        'file',
        Buffer.from('sku,name,price,stock\nWH-1,Broken Hub,9.99,0\n'),
        'products.csv',
      )
      .expect(202);
    await processor.process(ingest.body.id);
    expect(receiver.hits).toHaveLength(before);
  });
});
