import {
  ApiKeyItem,
  CatalogSummary,
  HealthCaseItem,
  IngestItem,
  ProductItem,
  TelemetryResponse,
  WebhookDeliveryItem,
  WebhookEndpointInfo,
} from './types';

export interface ApiMetaHeaders {
  correlationId: string;
  rateLimitRemaining: string;
}

export async function apiRequest<T>(
  path: string,
  apiKey: string,
  options: RequestInit = {},
  onHeaders?: (meta: ApiMetaHeaders) => void,
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (apiKey.trim()) {
    headers.set('x-api-key', apiKey.trim());
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (onHeaders) {
    onHeaders({
      correlationId: res.headers.get('x-correlation-id') || '—',
      rateLimitRemaining: res.headers.get('x-ratelimit-remaining') || '—',
    });
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.message) {
        message = Array.isArray(errJson.message)
          ? errJson.message.join(', ')
          : String(errJson.message);
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export async function fetchTelemetry(): Promise<TelemetryResponse | null> {
  try {
    const res = await fetch('/v1/telemetry');
    if (!res.ok) return null;
    return (await res.json()) as TelemetryResponse;
  } catch {
    return null;
  }
}

export interface WorkspaceBundle {
  summary: CatalogSummary | null;
  cases: HealthCaseItem[];
  products: ProductItem[];
  ingests: IngestItem[];
  webhook: WebhookEndpointInfo | null;
  deliveries: WebhookDeliveryItem[];
  apiKeys: ApiKeyItem[];
}

export async function fetchWorkspaceBundle(
  apiKey: string,
  filters: {
    caseStatus: string;
    caseQuery: string;
    productHealthy: string;
    productQuery: string;
  },
  onHeaders?: (meta: ApiMetaHeaders) => void,
): Promise<WorkspaceBundle> {
  const caseUrlParams = new URLSearchParams();
  if (filters.caseStatus) caseUrlParams.set('status', filters.caseStatus);
  if (filters.caseQuery?.trim()) caseUrlParams.set('q', filters.caseQuery.trim());
  const caseUrl = `/v1/cases${
    caseUrlParams.toString() ? `?${caseUrlParams.toString()}` : ''
  }`;
  const prodParams = new URLSearchParams();
  if (filters.productHealthy) prodParams.set('healthy', filters.productHealthy);
  if (filters.productQuery.trim()) {
    prodParams.set('q', filters.productQuery.trim());
  }
  const prodUrl = `/v1/products${
    prodParams.toString() ? `?${prodParams.toString()}` : ''
  }`;

  const [cases, products, summary, ingests, webhook, deliveries, apiKeys] =
    await Promise.all([
      apiRequest<HealthCaseItem[]>(caseUrl, apiKey, {}, onHeaders),
      apiRequest<ProductItem[]>(prodUrl, apiKey),
      apiRequest<CatalogSummary>('/v1/catalog/summary', apiKey).catch(
        () => null,
      ),
      apiRequest<IngestItem[]>('/v1/ingests?limit=10', apiKey).catch(() => []),
      apiRequest<WebhookEndpointInfo | null>('/v1/webhooks', apiKey).catch(
        () => null,
      ),
      apiRequest<WebhookDeliveryItem[]>(
        '/v1/webhooks/deliveries?limit=10',
        apiKey,
      ).catch(() => []),
      apiRequest<ApiKeyItem[]>('/v1/api-keys', apiKey).catch(() => []),
    ]);

  return {
    summary,
    cases,
    products,
    ingests,
    webhook,
    deliveries,
    apiKeys,
  };
}
