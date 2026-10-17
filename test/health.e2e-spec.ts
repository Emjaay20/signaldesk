import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness on /health', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.text).toBe('OK');
  });

  it('reports ready when the database is up', async () => {
    const res = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(res.text).toBe('READY');
  });
});
