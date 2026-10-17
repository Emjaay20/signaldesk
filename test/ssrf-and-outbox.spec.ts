import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { MultiCloudBlobStorageAdapter } from '../src/common/ports/blob-storage.port';
import { streamCsvChunks } from '../src/ingests/ingest.processor';
import { computePercentiles } from '../src/observability/metrics.service';
import { attemptSignedPost, computeBackoffMs } from '../src/webhooks/deliver';
import { isWebhookUrlSafe } from '../src/webhooks/ssrf.guard';

describe('Principal Platform Unit Suite (SSRF, Backoff, Streaming, Multi-Cloud Ports)', () => {
  describe('SSRF Protection Guard', () => {
    it('blocks cloud metadata endpoints unconditionally (including IPv4-mapped IPv6)', () => {
      expect(
        isWebhookUrlSafe('http://169.254.169.254/latest/meta-data/').safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://[::ffff:169.254.169.254]/latest/meta-data/').safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://metadata.google.internal/computeMetadata/v1/').safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://100.100.100.200/latest/meta-data/').safe,
      ).toBe(false);
    });

    it('blocks non-http protocols', () => {
      expect(isWebhookUrlSafe('file:///etc/passwd').safe).toBe(false);
      expect(isWebhookUrlSafe('ftp://internal.corp/hook').safe).toBe(false);
    });

    it('blocks RFC1918, CGNAT, IPv6 ULA/link-local, and IPv4-mapped IPv6 loopback when blockPrivateNetworks is enabled', () => {
      expect(
        isWebhookUrlSafe('http://127.0.0.1:8080/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://[::ffff:127.0.0.1]:8080/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://[fd00::1234]/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://[fe80::1]/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://100.64.10.5/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://10.0.14.8/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://192.168.1.50/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('http://172.20.0.3/hook', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(false);
      expect(
        isWebhookUrlSafe('https://hooks.acme.example.com/v1/events', {
          blockPrivateNetworks: true,
        }).safe,
      ).toBe(true);
    });

    it('disallows HTTP 3xx redirects during webhook delivery to prevent open-redirect SSRF bypass', async () => {
      const redirectServer = createServer(
        (_req: IncomingMessage, res: ServerResponse) => {
          res.writeHead(302, {
            Location: 'http://169.254.169.254/latest/meta-data/',
          });
          res.end();
        },
      );
      await new Promise<void>((resolve) =>
        redirectServer.listen(0, '127.0.0.1', resolve),
      );
      const { port } = redirectServer.address() as AddressInfo;

      try {
        const result = await attemptSignedPost({
          url: `http://127.0.0.1:${port}/redirect`,
          secret: 'whsec_test_secret_123456',
          payload: JSON.stringify({ event: 'case.opened' }),
          eventType: 'case.opened',
        });
        expect(result.ok).toBe(false);
        expect(result.statusCode).toBe(302);
        expect(result.errorMsg).toContain('redirect disallowed');
      } finally {
        redirectServer.close();
      }
    });
  });

  describe('Webhook Exponential Backoff', () => {
    it('doubles delay per attempt and caps at 60s', () => {
      expect(computeBackoffMs(1, false)).toBe(1000);
      expect(computeBackoffMs(2, false)).toBe(2000);
      expect(computeBackoffMs(3, false)).toBe(4000);
      expect(computeBackoffMs(10, false)).toBe(60000);
    });
  });

  describe('Multi-Cloud Blob Storage Port', () => {
    it('generates cloud-native URIs across AWS S3, GCP GCS, Azure Blob, MinIO, and Postgres', () => {
      const s3 = new MultiCloudBlobStorageAdapter('aws-s3', 'deimos-bucket');
      expect(s3.buildObjectUri('ws_1', 'ing_1', 'items.csv')).toBe(
        's3://deimos-bucket/ws_1/ing_1/items.csv',
      );

      const gcs = new MultiCloudBlobStorageAdapter('gcp-gcs', 'deimos-bucket');
      expect(gcs.buildObjectUri('ws_1', 'ing_1', 'items.csv')).toBe(
        'gs://deimos-bucket/ws_1/ing_1/items.csv',
      );

      const az = new MultiCloudBlobStorageAdapter('azure-blob', 'deimos-bucket');
      expect(az.buildObjectUri('ws_1', 'ing_1', 'items.csv')).toBe(
        'az://deimos-bucket/ws_1/ing_1/items.csv',
      );

      const pg = new MultiCloudBlobStorageAdapter('postgres-bytea');
      expect(pg.buildObjectUri('ws_1', 'ing_1', 'items.csv')).toBe(
        'pg-bytea://ingests/ws_1/ing_1/items.csv',
      );
    });

    it('put() returns blob metadata and load() round-trips catalog bytes', () => {
      const pg = new MultiCloudBlobStorageAdapter('postgres-bytea');
      const bytes = Buffer.from('sku,name\nA,Alpha\n');
      const meta = pg.put({
        workspaceId: 'ws_1',
        ingestKey: 'ing_1',
        filename: 'items.csv',
        byteSize: bytes.length,
        bytes,
      });
      expect(meta.provider).toBe('postgres-bytea');
      expect(meta.byteSize).toBe(bytes.length);
      expect(meta.objectUri).toContain('ing_1');
      expect(pg.load(bytes).equals(bytes)).toBe(true);
    });
  });

  describe('Bounded AsyncGenerator CSV Streaming', () => {
    it('streams CSV rows in bounded chunks and preserves rows with missing names for scoring', async () => {
      const csv = Buffer.from(
        [
          'sku,name,price,stock,status',
          'SKU-1,Alpha,10.5,5,active',
          'SKU-2,,12.0,3,active',
          'SKU-3,Gamma,,0,out_of_stock',
        ].join('\n'),
      );

      const chunks = [];
      for await (const chunk of streamCsvChunks(csv, 2)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(2);
      expect(chunks[0][1]).toEqual({
        sku: 'SKU-2',
        name: '',
        price: 12.0,
        stock: 3,
        status: 'active',
      });
      expect(chunks[1]).toHaveLength(1);
    });
  });

  describe('SLO Latency Percentiles', () => {
    it('computes p50, p95, p99 accurately', () => {
      const stats = computePercentiles([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
      expect(stats.count).toBe(10);
      expect(stats.p50Ms).toBe(50);
      expect(stats.p95Ms).toBe(100);
      expect(stats.maxMs).toBe(100);
    });
  });
});
