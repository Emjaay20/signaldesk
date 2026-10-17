import { enqueueWebhookEvent } from '../src/webhooks/deliver';

describe('Transactional outbox enqueue', () => {
  it('writes a pending delivery row and never calls fetch', async () => {
    const created: Array<Record<string, unknown>> = [];
    const db = {
      webhookDelivery: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
      },
    };

    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return new Response('nope', { status: 500 });
    }) as typeof fetch;

    try {
      const enqueued = await enqueueWebhookEvent(
        db as never,
        {
          id: 'ep_1',
          url: 'https://hooks.example.test/v1',
          secret: 'whsec_test',
        },
        {
          eventType: 'case.opened',
          workspaceId: 'ws_1',
          caseId: 'case_1',
          sku: 'SKU-1',
          name: 'Widget',
          reasons: ['out_of_stock'],
          healthScore: 60,
        },
      );

      expect(enqueued).toBe(true);
      expect(fetchCalls).toBe(0);
      expect(created).toHaveLength(1);
      expect(created[0]).toEqual(
        expect.objectContaining({
          workspaceId: 'ws_1',
          endpointId: 'ep_1',
          eventType: 'case.opened',
          status: 'pending',
          attempts: 0,
          signature: '',
        }),
      );
      expect(String(created[0].payload)).toContain('case.opened');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('is a no-op when the workspace has no webhook endpoint', async () => {
    const created: unknown[] = [];
    const db = {
      webhookDelivery: {
        create: async ({ data }: { data: unknown }) => {
          created.push(data);
          return data;
        },
      },
    };

    const enqueued = await enqueueWebhookEvent(db as never, null, {
      eventType: 'case.opened',
      workspaceId: 'ws_1',
      caseId: 'case_1',
      sku: 'SKU-1',
      name: 'Widget',
      reasons: ['out_of_stock'],
      healthScore: 60,
    });

    expect(enqueued).toBe(false);
    expect(created).toHaveLength(0);
  });
});
