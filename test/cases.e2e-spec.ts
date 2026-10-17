import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { IngestProcessor } from '../src/ingests/ingest.processor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Cases (e2e)', () => {
  let app: INestApplication;
  let apiKey: string;
  let prisma: PrismaService;
  let processor: IngestProcessor;

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
    processor = new IngestProcessor(prisma);

    const created = await request(app.getHttpServer())
      .post('/v1/workspaces')
      .set('x-admin-token', process.env.ADMIN_TOKEN as string)
      .send({ name: 'Cases Co' })
      .expect(201);
    apiKey = created.body.apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  async function ingest(ingestId: string, csv: string) {
    const created = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', ingestId)
      .attach('file', Buffer.from(csv), 'products.csv')
      .expect(202);
    await processor.process(created.body.id);
    return created.body.id;
  }

  it('rejects listing cases without an api key', async () => {
    await request(app.getHttpServer()).get('/v1/cases').expect(401);
  });

  it('opens a case when a product is out of stock', async () => {
    await ingest(
      'case_open_1',
      'sku,name,price,stock\nOK-1,Healthy,9.99,5\nBAD-1,Dead,4.50,0\n',
    );

    const cases = await request(app.getHttpServer())
      .get('/v1/cases')
      .set('x-api-key', apiKey)
      .expect(200);

    expect(cases.body).toHaveLength(1);
    expect(cases.body[0]).toEqual(
      expect.objectContaining({
        sku: 'BAD-1',
        status: 'open',
        reasons: ['out_of_stock'],
      }),
    );

    const products = await request(app.getHttpServer())
      .get('/v1/products')
      .set('x-api-key', apiKey)
      .expect(200);

    const dead = products.body.find((p: { sku: string }) => p.sku === 'BAD-1');
    const ok = products.body.find((p: { sku: string }) => p.sku === 'OK-1');
    expect(dead.healthy).toBe(false);
    expect(dead.healthScore).toBe(60);
    expect(ok.healthy).toBe(true);
    expect(ok.healthScore).toBe(100);
  });

  it('closes the case when the product becomes healthy', async () => {
    await ingest(
      'case_close_1',
      'sku,name,price,stock\nFIX-1,Was Dead,4.50,0\n',
    );
    await ingest(
      'case_close_2',
      'sku,name,price,stock\nFIX-1,Was Dead,4.50,8\n',
    );

    const open = await request(app.getHttpServer())
      .get('/v1/cases')
      .query({ status: 'open' })
      .set('x-api-key', apiKey)
      .expect(200);

    expect(open.body.find((c: { sku: string }) => c.sku === 'FIX-1')).toBeUndefined();

    const all = await request(app.getHttpServer())
      .get('/v1/cases')
      .query({ status: 'closed' })
      .set('x-api-key', apiKey)
      .expect(200);

    expect(all.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'FIX-1', status: 'closed' }),
      ]),
    );
  });

  it('does not open a second case for the same unhealthy sku', async () => {
    await ingest(
      'case_dedupe_1',
      'sku,name,price,stock\nDUP-1,Repeat,1,0\n',
    );
    await ingest(
      'case_dedupe_2',
      'sku,name,price,stock\nDUP-1,Repeat,1,0\n',
    );

    const cases = await request(app.getHttpServer())
      .get('/v1/cases')
      .set('x-api-key', apiKey)
      .expect(200);

    const dups = cases.body.filter((c: { sku: string }) => c.sku === 'DUP-1');
    expect(dups).toHaveLength(1);
    expect(dups[0].status).toBe('open');
  });

  it('filters cases by sku and records an operator resolution note', async () => {
    await ingest(
      'case_search_1',
      'sku,name,price,stock\nFIND-ME,Broken Lamp,8,0\nOTHER-9,Broken Plug,3,0\n',
    );

    const filtered = await request(app.getHttpServer())
      .get('/v1/cases')
      .query({ q: 'FIND-ME', status: 'open' })
      .set('x-api-key', apiKey)
      .expect(200);

    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].sku).toBe('FIND-ME');

    const resolved = await request(app.getHttpServer())
      .post(`/v1/cases/${filtered.body[0].id}/resolve`)
      .set('x-api-key', apiKey)
      .send({ resolution: 'supplier restocked Friday' })
      .expect(200);

    expect(resolved.body.status).toBe('closed');
    expect(resolved.body.resolution).toBe('supplier restocked Friday');
  });
});
