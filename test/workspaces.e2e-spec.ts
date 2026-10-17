import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashApiKey } from '../src/auth/api-key.crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Workspaces (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects workspace create without an admin token', async () => {
    await request(app.getHttpServer())
      .post('/v1/workspaces')
      .send({ name: 'Acme' })
      .expect(401);
  });

  it('creates a workspace and returns the api key once', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/workspaces')
      .set('x-admin-token', process.env.ADMIN_TOKEN as string)
      .send({ name: 'Acme' })
      .expect(201);

    expect(res.body.workspace).toEqual(
      expect.objectContaining({ name: 'Acme' }),
    );
    expect(res.body.workspace.id).toEqual(expect.any(String));
    expect(res.body.apiKey).toMatch(/^sd_live_/);
    expect(res.body.apiKey.length).toBeGreaterThan(20);
  });

  it('rejects /v1/me without an api key', async () => {
    await request(app.getHttpServer()).get('/v1/me').expect(401);
  });

  it('returns the workspace for a valid api key', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/workspaces')
      .set('x-admin-token', process.env.ADMIN_TOKEN as string)
      .send({ name: 'Northwind' })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-api-key', created.body.apiKey)
      .expect(200);

    expect(me.body.workspace).toEqual(
      expect.objectContaining({
        id: created.body.workspace.id,
        name: 'Northwind',
      }),
    );
  });

  it('stores a hash of the api key, never the plaintext', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/workspaces')
      .set('x-admin-token', process.env.ADMIN_TOKEN as string)
      .send({ name: 'Hashed' })
      .expect(201);

    const prisma = app.get(PrismaService);
    const stored = await prisma.apiKey.findMany({
      where: { workspaceId: created.body.workspace.id },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0].keyHash).toBe(hashApiKey(created.body.apiKey));
    expect(stored[0].keyHash).not.toBe(created.body.apiKey);
    expect(JSON.stringify(stored[0])).not.toContain(created.body.apiKey);
  });

  it('rejects /v1/me with an invalid api key', async () => {
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-api-key', 'sd_live_this_is_not_a_real_key')
      .expect(401);
  });
});
