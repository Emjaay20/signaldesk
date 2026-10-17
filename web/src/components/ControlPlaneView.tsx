import { FormEvent, useRef, useState } from 'react';
import { apiRequest } from '../api';
import {
  ActivePage,
  ApiKeyItem,
  CatalogSummary,
  HealthCaseItem,
  IngestItem,
  ProductItem,
  TelemetryResponse,
  WebhookDeliveryItem,
  WebhookEndpointInfo,
} from '../types';

interface ControlPlaneViewProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  statusText: string;
  statusKind: 'idle' | 'ok' | 'bad';
  correlationId: string;
  rateLimitRemaining: string;
  summary: CatalogSummary | null;
  cases: HealthCaseItem[];
  products: ProductItem[];
  ingests: IngestItem[];
  webhook: WebhookEndpointInfo | null;
  deliveries: WebhookDeliveryItem[];
  apiKeys: ApiKeyItem[];
  telemetry: TelemetryResponse | null;
  caseFilter: string;
  setCaseFilter: (v: string) => void;
  caseQuery: string;
  setCaseQuery: (v: string) => void;
  productHealthyFilter: string;
  setProductHealthyFilter: (v: string) => void;
  productQuery: string;
  setProductQuery: (v: string) => void;
  onLoadWorkspace: () => Promise<void>;
  onProvisionSandbox: () => Promise<void>;
  provisioning: boolean;
  onNavigate: (page: ActivePage) => void;
  showToast: (msg: string) => void;
}

export function ControlPlaneView({
  apiKey,
  setApiKey,
  statusText,
  statusKind,
  correlationId,
  rateLimitRemaining,
  summary,
  cases,
  products,
  ingests,
  webhook,
  deliveries,
  apiKeys,
  telemetry,
  caseFilter,
  setCaseFilter,
  caseQuery,
  setCaseQuery,
  productHealthyFilter,
  setProductHealthyFilter,
  productQuery,
  setProductQuery,
  onLoadWorkspace,
  onProvisionSandbox,
  provisioning,
  onNavigate,
  showToast,
}: ControlPlaneViewProps) {
  const [showKey, setShowKey] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('restocked');
  const [ingestIdInput, setIngestIdInput] = useState('');
  const [lastIngestId, setLastIngestId] = useState('ing_demo_001');
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [mintedKeyOnce, setMintedKeyOnce] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadCsvText = async (
    csvContent: string,
    filename: string,
    customIngestKey?: string,
  ) => {
    if (!apiKey.trim()) {
      showToast('Provision a Live Sandbox or paste a Workspace API Key first');
      return;
    }
    const chosenKey =
      customIngestKey ||
      ingestIdInput.trim() ||
      `ing_${Date.now().toString(36)}`;
    setLastIngestId(chosenKey);

    try {
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([csvContent], { type: 'text/csv' }),
        filename,
      );
      const created = await apiRequest<IngestItem>(
        '/v1/ingests',
        apiKey,
        {
          method: 'POST',
          headers: { 'x-ingest-id': chosenKey },
          body: fd,
        },
      );
      if (created.status === 'pending') {
        await apiRequest(
          `/v1/ingests/${created.id}/process`,
          apiKey,
          { method: 'POST' },
        );
      }
      showToast(`Ingest "${created.ingestId}" streamed and scored!`);
      await onLoadWorkspace();
    } catch (err) {
      showToast(
        `Ingest error: ${err instanceof Error ? err.message : 'failed'}`,
      );
    }
  };

  const handleFileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      showToast('Choose a .csv file or click one of the simulation presets');
      return;
    }
    const text = await file.text();
    await uploadCsvText(text, file.name);
  };

  const handleSimulateDegraded = () => {
    const csv = [
      'sku,name,price,stock,status',
      'DMS-101,Multi-Cloud Ingress Gateway,189.00,0,out_of_stock',
      'DMS-102,Zero-Trust Hardware Token,,18,active',
      'DMS-106,HSM Crypto Accelerator,,0,out_of_stock',
      'DMS-108,,95.00,25,active',
      'DMS-200,Edge AI Inference Node,1499.00,0,out_of_stock',
    ].join('\n');
    void uploadCsvText(
      csv,
      'degraded-drop.csv',
      `ing_deg_${Date.now().toString(36)}`,
    );
  };

  const handleSimulateRecovery = () => {
    const csv = [
      'sku,name,price,stock,status',
      'DMS-101,Multi-Cloud Ingress Gateway,189.00,35,active',
      'DMS-102,Zero-Trust Hardware Token,49.00,18,active',
      'DMS-103,Fiber Uplink Transceiver 40G,64.50,50,active',
      'DMS-106,HSM Crypto Accelerator,620.00,12,active',
      'DMS-108,Cloud VPN Concentrator,95.00,25,active',
      'DMS-200,Edge AI Inference Node,1499.00,8,active',
    ].join('\n');
    void uploadCsvText(
      csv,
      'recovery-restock.csv',
      `ing_rec_${Date.now().toString(36)}`,
    );
  };

  const handleSimulateIdempotent = () => {
    const csv =
      'sku,name,price,stock\nDMS-999,Duplicate Payload Ignored,10.00,5\n';
    void uploadCsvText(csv, 'duplicate.csv', lastIngestId);
  };

  const handleSaveWebhook = async () => {
    const targetUrl = webhookUrlInput.trim() || webhook?.url || '';
    if (!targetUrl) {
      showToast('Enter a valid http/https webhook URL');
      return;
    }
    try {
      const saved = await apiRequest<WebhookEndpointInfo>(
        '/v1/webhooks',
        apiKey,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: targetUrl }),
        },
      );
      if (saved.secret) {
        setRevealedSecret(saved.secret);
      }
      showToast('Webhook endpoint saved and SSRF-verified!');
      await onLoadWorkspace();
    } catch (err) {
      showToast(
        `Webhook rejected: ${err instanceof Error ? err.message : 'invalid'}`,
      );
    }
  };

  const handleCreateApiKey = async () => {
    try {
      const created = await apiRequest<{
        id: string;
        name: string;
        apiKey: string;
      }>('/v1/api-keys', apiKey, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim() || 'rotated-service-key',
        }),
      });
      setMintedKeyOnce(created.apiKey);
      setNewKeyName('');
      showToast(`Rotated key "${created.name}" created!`);
      await onLoadWorkspace();
    } catch (err) {
      showToast(
        `Key creation failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await apiRequest(`/v1/api-keys/${id}`, apiKey, { method: 'DELETE' });
      showToast('API key immediately revoked');
      await onLoadWorkspace();
    } catch (err) {
      showToast(
        `Revocation failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  };

  const handleResolveCase = async (id: string) => {
    try {
      await apiRequest(`/v1/cases/${id}/resolve`, apiKey, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resolution: resolutionNote.trim() || 'operator_resolved',
        }),
      });
      showToast(`Resolved ${id.slice(0, 8)}…`);
      await onLoadWorkspace();
    } catch (err) {
      showToast(
        `Resolve failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  };

  const handleReplayWebhook = async (id: string) => {
    try {
      await apiRequest(`/v1/webhooks/deliveries/${id}/replay`, apiKey, {
        method: 'POST',
      });
      showToast('Webhook redelivered with fresh HMAC-SHA256 signature');
      await onLoadWorkspace();
    } catch (err) {
      showToast(
        `Replay failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  };

  const handleProcessIngest = async (id: string) => {
    try {
      await apiRequest(`/v1/ingests/${id}/process`, apiKey, {
        method: 'POST',
      });
      showToast('Ingest processed');
      await onLoadWorkspace();
    } catch (err) {
      showToast(
        `Process failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  };

  return (
    <div>
      <section className="hero-banner">
        <div className="hero-content">
          <h1 className="hero-title">Catalog floor</h1>
          <p className="hero-subtitle">
            Ingest a CSV, score SKUs, open cases, sign webhooks. Nothing else.
          </p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void onProvisionSandbox()}
            disabled={provisioning}
          >
            {provisioning ? 'Provisioning…' : 'Open sandbox'}
          </button>
        </div>
      </section>

      {/* Workspace Auth & Telemetry Bar */}
      <section className="auth-strip">
        <div className="auth-form-row">
          <label htmlFor="key" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Workspace API Key:
          </label>
          <input
            id="key"
            className="auth-key-input mono"
            type={showKey ? 'text' : 'password'}
            placeholder="sd_live_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="btn-sm"
            onClick={() => setShowKey((s) => !s)}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
          <button
            id="load"
            type="button"
            className="btn-primary"
            onClick={() => void onLoadWorkspace()}
          >
            Load Workspace
          </button>
          <span
            id="status"
            className={`mono ${
              statusKind === 'ok' ? 'ok' : statusKind === 'bad' ? 'bad' : ''
            }`}
            style={{ fontSize: '0.8rem', padding: '0.15rem 0.45rem', borderRadius: '0.35rem' }}
          >
            {statusText}
          </span>
        </div>
        <div
          className="mono"
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            display: 'flex',
            gap: '0.9rem',
            flexWrap: 'wrap',
          }}
        >
          <span>Trace: {correlationId}</span>
          <span>RateLimit Left: {rateLimitRemaining}</span>
        </div>
      </section>

      {/* KPI Summary Grid */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Catalog Health Score</div>
          <div className="kpi-value">
            {summary ? `${summary.averageHealthScore}/100` : '100/100'}
          </div>
          <div className="kpi-sub mono">
            Port: {summary?.storageProvider ?? 'postgres-bytea'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Catalog SKUs</div>
          <div className="kpi-value">{summary?.totalProducts ?? products.length}</div>
          <div className="kpi-sub">
            {summary
              ? `${summary.healthyProducts} healthy · ${summary.unhealthyProducts} degraded`
              : 'Connect workspace to inspect'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Open Health Cases</div>
          <div className="kpi-value">
            {summary?.openCasesCount ?? cases.filter((c) => c.status === 'open').length}
          </div>
          <div className="kpi-sub">
            {summary?.closedCasesCount ?? 0} resolved incidents
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Ingest Latency (p95 SLO)</div>
          <div className="kpi-value">
            {telemetry ? `${telemetry.latencies.ingestHttp.p95Ms} ms` : '0 ms'}
          </div>
          <div className="kpi-sub mono">
            Event Loop p99: {telemetry?.runtime.eventLoopLagP99Ms ?? 0} ms
          </div>
        </div>
      </section>

      {/* Two-Column Studio: Ingest Pipeline + Webhook Outbox / API Keys */}
      <div className="grid-2col">
        {/* Ingest Studio */}
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Ingests</div>
            <span className="badge badge-info mono">POST /v1/ingests</span>
          </div>
          <form
            onSubmit={(e) => void handleFileSubmit(e)}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.6rem',
              alignItems: 'center',
            }}
          >
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" />
            <input
              type="text"
              className="mono"
              placeholder="x-ingest-id (auto)"
              value={ingestIdInput}
              onChange={(e) => setIngestIdInput(e.target.value)}
              style={{ width: '165px' }}
            />
            <button type="submit" className="btn-primary">
              Upload &amp; Stream
            </button>
          </form>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.45rem',
              marginTop: '0.75rem',
            }}
          >
            <button
              type="button"
              className="btn-amber btn-sm"
              onClick={handleSimulateDegraded}
            >
              Simulate Degraded Drop (Opens Cases + Webhooks)
            </button>
            <button
              type="button"
              className="btn-emerald btn-sm"
              onClick={handleSimulateRecovery}
            >
              Simulate Restock Recovery (Auto-Resolves Cases)
            </button>
            <button
              type="button"
              className="btn-sm"
              onClick={handleSimulateIdempotent}
            >
              Test Idempotent Replay ({lastIngestId})
            </button>
          </div>

          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Ingest Key</th>
                  <th>Status</th>
                  <th>Rows</th>
                  <th>Duration</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {ingests.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      No ingests recorded yet
                    </td>
                  </tr>
                ) : (
                  ingests.map((ing) => (
                    <tr key={ing.id}>
                      <td className="mono">{ing.ingestId}</td>
                      <td>
                        <span
                          className={`badge ${
                            ing.status === 'complete'
                              ? 'badge-ok'
                              : ing.status === 'failed'
                                ? 'badge-bad'
                                : 'badge-warn'
                          }`}
                        >
                          {ing.status}
                        </span>
                      </td>
                      <td className="mono">{ing.rowCount ?? '—'}</td>
                      <td className="mono">
                        {ing.durationMs ? `${ing.durationMs}ms` : '—'}
                      </td>
                      <td>
                        {ing.status === 'pending' ? (
                          <button
                            type="button"
                            className="btn-sm btn-primary"
                            onClick={() => void handleProcessIngest(ing.id)}
                          >
                            Process
                          </button>
                        ) : (
                          <span
                            className="mono"
                            style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}
                          >
                            complete
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Webhook Outbox & API Key Rotation */}
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Webhooks</div>
            <span className="badge badge-info mono">HMAC-SHA256 + SSRF Guard</span>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '0.6rem',
            }}
          >
            <input
              type="url"
              placeholder={
                webhook?.url || 'https://ops.example.com/webhooks/signaldesk'
              }
              value={webhookUrlInput}
              onChange={(e) => setWebhookUrlInput(e.target.value)}
              style={{ flex: '1 1 200px' }}
            />
            <button
              type="button"
              className="btn-sm btn-primary"
              onClick={() => void handleSaveWebhook()}
            >
              Save Endpoint
            </button>
          </div>

          <div
            className="mono"
            style={{
              fontSize: '0.74rem',
              color: 'var(--text-muted)',
              marginBottom: '0.85rem',
            }}
          >
            {revealedSecret
              ? `New Signing Secret (copy now): ${revealedSecret}`
              : webhook
                ? `Endpoint: ${webhook.url} · Secret: ${webhook.secretPreview}`
                : 'Webhook Endpoint: Not configured'}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th>HTTP</th>
                  <th>Latency</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      No webhook deliveries logged
                    </td>
                  </tr>
                ) : (
                  deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.eventType}</td>
                      <td>
                        <span
                          className={`badge ${
                            d.status === 'delivered' ? 'badge-ok' : 'badge-warn'
                          }`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="mono">{d.lastStatusCode ?? 'ERR'}</td>
                      <td className="mono">
                        {d.durationMs ? `${d.durationMs}ms` : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => void handleReplayWebhook(d.id)}
                        >
                          Replay
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* API Key Vault */}
          <div
            style={{
              marginTop: '1.1rem',
              paddingTop: '0.85rem',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.55rem',
              }}
            >
              <strong style={{ fontSize: '0.82rem' }}>
                Zero-Downtime API Key Rotation
              </strong>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="label (e.g. ci-cd)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  style={{ width: '135px', padding: '0.32rem 0.55rem' }}
                />
                <button
                  type="button"
                  className="btn-sm btn-emerald"
                  onClick={() => void handleCreateApiKey()}
                >
                  + Rotate Key
                </button>
              </div>
            </div>

            {mintedKeyOnce && (
              <div
                className="mono"
                style={{
                  fontSize: '0.74rem',
                  padding: '0.45rem 0.65rem',
                  marginBottom: '0.6rem',
                  borderRadius: '0.45rem',
                  background: 'rgba(16, 185, 129, 0.14)',
                  color: '#34d399',
                }}
              >
                New API Key (save now): {mintedKeyOnce}
              </div>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>State</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                        Load workspace to inspect API keys
                      </td>
                    </tr>
                  ) : (
                    apiKeys.map((k) => (
                      <tr key={k.id}>
                        <td className="mono">
                          {k.name}{' '}
                          {k.current && (
                            <span className="badge badge-info">current</span>
                          )}
                        </td>
                        <td className="mono">{k.keyPrefix}...</td>
                        <td>
                          <span
                            className={`badge ${
                              k.revokedAt ? 'badge-bad' : 'badge-ok'
                            }`}
                          >
                            {k.revokedAt ? 'revoked' : 'active'}
                          </span>
                        </td>
                        <td>
                          {!k.revokedAt && !k.current ? (
                            <button
                              type="button"
                              className="btn-sm btn-rose"
                              onClick={() => void handleRevokeKey(k.id)}
                            >
                              Revoke
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {/* Health Cases Incident Table */}
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Cases</div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="SKU…"
              value={caseQuery}
              onChange={(e) => setCaseQuery(e.target.value)}
              aria-label="Search cases by SKU"
              style={{ width: '140px' }}
            />
            <select
              value={caseFilter}
              onChange={(e) => setCaseFilter(e.target.value)}
              aria-label="Filter cases by status"
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="">All history</option>
            </select>
            <input
              type="text"
              placeholder="Resolve note"
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              aria-label="Resolution note"
              style={{ width: '160px' }}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Reasons</th>
                <th>Status</th>
                <th>Resolution</th>
                <th>Opened</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="cases">
              {cases.length === 0 ? (
                <tr>
                  <td colSpan={6}>None</td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => {
                          setCaseQuery(c.sku);
                          setCaseFilter('');
                        }}
                      >
                        {c.sku}
                      </button>
                    </td>
                    <td className="bad mono">{c.reasons.join(', ')}</td>
                    <td>
                      <span
                        className={`badge ${
                          c.status === 'open' ? 'badge-bad' : 'badge-ok'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="mono">{c.resolution || '—'}</td>
                    <td className="mono">
                      {new Date(c.openedAt).toLocaleTimeString()}
                    </td>
                    <td>
                      {c.status === 'open' ? (
                        <button
                          type="button"
                          className="btn-sm btn-emerald"
                          onClick={() => void handleResolveCase(c.id)}
                        >
                          Resolve
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Product Catalog Explorer */}
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Catalog</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search SKU or name..."
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
            />
            <select
              value={productHealthyFilter}
              onChange={(e) => setProductHealthyFilter(e.target.value)}
              aria-label="Filter products by health state"
            >
              <option value="">All Health States</option>
              <option value="false">Unhealthy Only</option>
              <option value="true">Healthy Only</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Score</th>
                <th>Healthy</th>
                <th>Deficit Reasons</th>
              </tr>
            </thead>
            <tbody id="products">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7}>None</td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.sku}</td>
                    <td>{p.name || '(missing name)'}</td>
                    <td className="mono">
                      {p.price !== null && p.price !== undefined
                        ? `$${Number(p.price).toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="mono">
                      {p.stock !== null && p.stock !== undefined
                        ? p.stock
                        : '—'}
                    </td>
                    <td className="mono">
                      <strong>{p.healthScore}</strong>
                    </td>
                    <td className={`${p.healthy ? 'ok' : 'bad'} mono`}>
                      {String(p.healthy)}
                    </td>
                    <td className="mono">
                      {p.healthReasons.length > 0
                        ? p.healthReasons.join(', ')
                        : 'healthy'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
