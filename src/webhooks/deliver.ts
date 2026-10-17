import { Prisma, PrismaClient } from '@prisma/client';
import { getCorrelationId } from '../observability/request-context';
import { signWebhook } from './signature';

type Db = PrismaClient | Prisma.TransactionClient;

export type CaseOpenedEvent = {
  workspaceId: string;
  caseId: string;
  sku: string;
  name: string;
  reasons: string[];
  healthScore: number;
};

export type CaseResolvedEvent = {
  workspaceId: string;
  caseId: string;
  sku: string;
  name: string;
  healthScore: number;
  resolution?: string;
};

export type WebhookLifecycleEvent =
  | ({ eventType: 'case.opened' } & CaseOpenedEvent)
  | ({ eventType: 'case.resolved' } & CaseResolvedEvent);

export type WebhookEndpointRef = {
  id: string;
  url: string;
  secret: string;
};

const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 5000;
export const MAX_WEBHOOK_ATTEMPTS = 5;

export function computeBackoffMs(attempt: number, withJitter = false): number {
  const baseMs = Math.min(60_000, Math.pow(2, Math.max(0, attempt - 1)) * 1000);
  if (!withJitter) {
    return baseMs;
  }
  const jitter = Math.floor(Math.random() * 250);
  return baseMs + jitter;
}

export function serializeWebhookPayload(
  event: WebhookLifecycleEvent | CaseOpenedEvent,
): { eventType: 'case.opened' | 'case.resolved'; body: string } {
  const isResolved =
    'eventType' in event && event.eventType === 'case.resolved';

  if (isResolved) {
    return {
      eventType: 'case.resolved',
      body: JSON.stringify({
        event: 'case.resolved',
        workspaceId: event.workspaceId,
        case: {
          id: event.caseId,
          sku: event.sku,
          status: 'closed',
          resolution: event.resolution ?? 'catalog_recovered',
        },
        product: {
          sku: event.sku,
          name: event.name,
          healthScore: event.healthScore,
        },
      }),
    };
  }

  const opened = event as CaseOpenedEvent;
  return {
    eventType: 'case.opened',
    body: JSON.stringify({
      event: 'case.opened',
      workspaceId: opened.workspaceId,
      case: {
        id: opened.caseId,
        sku: opened.sku,
        reasons: opened.reasons,
        status: 'open',
      },
      product: {
        sku: opened.sku,
        name: opened.name,
        healthScore: opened.healthScore,
      },
    }),
  };
}

/**
 * Persist the webhook in the same DB transaction as the case mutation.
 * HTTP is never performed here — the worker drains pending/retrying rows.
 */
export async function enqueueWebhookEvent(
  db: Db,
  endpoint: WebhookEndpointRef | null,
  event: WebhookLifecycleEvent,
): Promise<boolean> {
  if (!endpoint) {
    return false;
  }

  const { eventType, body } = serializeWebhookPayload(event);
  await db.webhookDelivery.create({
    data: {
      workspaceId: event.workspaceId,
      endpointId: endpoint.id,
      eventType,
      targetUrl: endpoint.url,
      payload: body,
      signature: '',
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_WEBHOOK_ATTEMPTS,
      nextAttemptAt: new Date(),
    },
  });
  return true;
}

export async function attemptSignedPost(opts: {
  url: string;
  secret: string;
  payload: string;
  eventType: string;
  extraHeaders?: Record<string, string>;
}): Promise<{
  ok: boolean;
  statusCode: number | null;
  errorMsg: string | null;
  durationMs: number;
  signature: string;
}> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhook(opts.secret, timestamp, opts.payload);
  const startMs = Date.now();

  let ok = false;
  let statusCode: number | null = null;
  let errorMsg: string | null = null;

  try {
    const res = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signaldesk-signature': signature,
        'x-signaldesk-event': opts.eventType,
        'x-correlation-id': getCorrelationId(),
        ...opts.extraHeaders,
      },
      body: opts.payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    statusCode = res.status;
    if (res.status >= 300 && res.status < 400) {
      ok = false;
      errorMsg = `HTTP ${res.status} redirect disallowed (SSRF protection)`;
    } else {
      ok = res.ok;
      if (!res.ok) {
        errorMsg = `HTTP ${res.status}`;
      }
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'network error';
  }

  return {
    ok,
    statusCode,
    errorMsg,
    durationMs: Math.max(1, Date.now() - startMs),
    signature,
  };
}
