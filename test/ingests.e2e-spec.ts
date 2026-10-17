import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { IngestProcessor } from '../src/ingests/ingest.processor';
import { PrismaService } from '../src/prisma/prisma.service';

const CSV = Buffer.from(
  'sku,name,price,stock,status\nSKU-1,Widget,9.99,12,active\nSKU-2,Gadget,4.5,0,out_of_stock\n',
);

describe('Ingests (e2e)', () => {
  let app: INestApplication;
  let apiKey: string;
  let prisma: PrismaService;

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

    const created = await request(app.getHttpServer())
      .post('/v1/workspaces')
      .set('x-admin-token', process.env.ADMIN_TOKEN as string)
      .send({ name: 'Catalog Co' })
      .expect(201);
    apiKey = created.body.apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects ingest without an api key', async () => {
    await request(app.getHttpServer())
      .post('/v1/ingests')
      .attach('file', CSV, 'products.csv')
      .set('x-ingest-id', 'ing_001')
      .expect(401);
  });

  it('rejects ingest without x-ingest-id', async () => {
    await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .attach('file', CSV, 'products.csv')
      .expect(400);
  });

  it('rejects ingest without a csv file', async () => {
    await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'ing_nofile')
      .expect(400);
  });

  it('accepts a csv and returns pending without loading products yet', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'ing_100')
      .attach('file', CSV, 'products.csv')
      .expect(202);

    expect(res.body.status).toBe('pending');
    expect(res.body.ingestId).toBe('ing_100');
    expect(res.body.id).toEqual(expect.any(String));

    const products = await request(app.getHttpServer())
      .get('/v1/products')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(products.body).toEqual([]);
  });

  it('is idempotent for the same ingest id', async () => {
    const first = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'ing_200')
      .attach('file', CSV, 'products.csv')
      .expect(202);

    const second = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'ing_200')
      .attach('file', Buffer.from('sku,name\nX,Other\n'), 'other.csv')
      .expect(202);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.ingestId).toBe('ing_200');
  });

  it('worker streams rows into the workspace catalog', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/ingests')
      .set('x-api-key', apiKey)
      .set('x-ingest-id', 'ing_300')
      .attach('file', CSV, 'products.csv')
      .expect(202);

    const processor = new IngestProcessor(prisma);
    await processor.process(created.body.id);

    const ingest = await request(app.getHttpServer())
      .get(`/v1/ingests/${created.body.id}`)
      .set('x-api-key', apiKey)
      .expect(200);
    expect(ingest.body.status).toBe('complete');
    expect(ingest.body.rowCount).toBe(2);

    const products = await request(app.getHttpServer())
      .get('/v1/products')
      .set('x-api-key', apiKey)
      .expect(200);

    expect(products.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: 'SKU-1',
          name: 'Widget',
          price: 9.99,
          stock: 12,
          status: 'active',
        }),
        expect.objectContaining({
          sku: 'SKU-2',
          name: 'Gadget',
          price: 4.5,
          stock: 0,
          status: 'out_of_stock',
        }),
      ]),
    );
  });
});
