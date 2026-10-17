export interface CatalogSummary {
  workspaceId: string;
  workspaceName: string;
  storageProvider: string;
  totalProducts: number;
  healthyProducts: number;
  unhealthyProducts: number;
  averageHealthScore: number;
  openCasesCount: number;
  closedCasesCount: number;
  totalIngestsCount: number;
  reasonBreakdown: Record<string, number>;
}

export interface ProductItem {
  id: string;
  sku: string;
  name: string;
  price: number | null;
  stock: number | null;
  status: string | null;
  healthScore: number;
  healthReasons: string[];
  healthy: boolean;
  updatedAt: string;
}

export interface HealthCaseItem {
  id: string;
  sku: string;
  status: 'open' | 'closed' | string;
  reasons: string[];
  resolution: string | null;
  openedAt: string;
  closedAt: string | null;
  productId: string;
}

export interface IngestItem {
  id: string;
  ingestId: string;
  status: 'pending' | 'processing' | 'complete' | 'failed' | string;
  filename: string | null;
  byteSize: number;
  rowCount: number | null;
  error: string | null;
  attempts?: number;
  durationMs?: number | null;
  storageUri?: string;
  createdAt: string;
  completedAt: string | null;
}

export interface WebhookEndpointInfo {
  id: string;
  url: string;
  secretPreview?: string;
  secret?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebhookDeliveryItem {
  id: string;
  eventType: string;
  targetUrl: string;
  payload: string;
  signature: string;
  status: 'delivered' | 'retrying' | 'exhausted' | 'pending' | string;
  attempts: number;
  maxAttempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  current?: boolean;
}

export interface LatencyStats {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface TelemetryResponse {
  status: 'operational' | 'degraded';
  database: {
    healthy: boolean;
    pingMs: number;
  };
  queues: {
    pendingIngests: number;
    processingIngests: number;
    retryingWebhooks: number;
  };
  slos: {
    overallCompliant: boolean;
    objectives: Array<{
      name: string;
      targetP95Ms: number;
      actualP95Ms: number;
      compliant: boolean;
      sampleCount: number;
    }>;
  };
  latencies: {
    ingestHttp: LatencyStats;
    healthHttp: LatencyStats;
    workerJob: LatencyStats;
  };
  counters: {
    httpRequestsTotal: number;
    httpErrorsTotal: number;
    ingestJobsCompleted: number;
    ingestJobsFailed: number;
    staleLocksRecovered: number;
    rowsProcessedTotal: number;
    webhooksDeliveredTotal: number;
    webhooksRetriedTotal: number;
    webhooksFailedTotal: number;
  };
  runtime: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    eventLoopLagP99Ms: number;
    lastWorkerTickAt: string | null;
  };
}

export type ActivePage = 'dashboard' | 'docs' | 'architecture';
