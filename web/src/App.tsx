import { useCallback, useEffect, useState } from 'react';
import { fetchTelemetry, fetchWorkspaceBundle } from './api';
import { ArchitectureView } from './components/ArchitectureView';
import { ControlPlaneView } from './components/ControlPlaneView';
import { DocsView } from './components/DocsView';
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
} from './types';

function resolveInitialPage(): ActivePage {
  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/docs')) return 'docs';
  if (path.startsWith('/architecture')) return 'architecture';
  return 'dashboard';
}

export function App() {
  const [activePage, setActivePage] = useState<ActivePage>(resolveInitialPage);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('sd_theme') as 'dark' | 'light') || 'light',
  );

  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem('sd_key') || '',
  );
  const [statusText, setStatusText] = useState<string>('Ready');
  const [statusKind, setStatusKind] = useState<'idle' | 'ok' | 'bad'>('idle');
  const [correlationId, setCorrelationId] = useState<string>('—');
  const [rateLimitRemaining, setRateLimitRemaining] = useState<string>('—');

  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [cases, setCases] = useState<HealthCaseItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [ingests, setIngests] = useState<IngestItem[]>([]);
  const [webhook, setWebhook] = useState<WebhookEndpointInfo | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryResponse | null>(null);

  const [caseFilter, setCaseFilter] = useState<string>('open');
  const [caseQuery, setCaseQuery] = useState<string>('');
  const [productHealthyFilter, setProductHealthyFilter] = useState<string>('');
  const [productQuery, setProductQuery] = useState<string>('');
  const [provisioning, setProvisioning] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sd_theme', theme);
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setActivePage(resolveInitialPage());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = useCallback((page: ActivePage) => {
    setActivePage(page);
    const nextPath =
      page === 'docs'
        ? '/docs'
        : page === 'architecture'
          ? '/architecture'
          : '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const refreshTelemetry = useCallback(async () => {
    const data = await fetchTelemetry();
    if (data) setTelemetry(data);
  }, []);

  const loadWorkspaceWithKey = useCallback(
    async (targetKey: string) => {
      const trimmed = targetKey.trim();
      localStorage.setItem('sd_key', trimmed);
      if (!trimmed) {
        setStatusText('Paste API Key or Launch Sandbox');
        setStatusKind('idle');
        await refreshTelemetry();
        return;
      }

      setStatusText('Loading...');
      setStatusKind('idle');
      try {
        const bundle = await fetchWorkspaceBundle(
          trimmed,
          {
            caseStatus: caseFilter,
            caseQuery,
            productHealthy: productHealthyFilter,
            productQuery,
          },
          (meta) => {
            setCorrelationId(meta.correlationId);
            setRateLimitRemaining(meta.rateLimitRemaining);
          },
        );
        setSummary(bundle.summary);
        setCases(bundle.cases);
        setProducts(bundle.products);
        setIngests(bundle.ingests);
        setWebhook(bundle.webhook);
        setDeliveries(bundle.deliveries);
        setApiKeys(bundle.apiKeys);
        setStatusText('OK');
        setStatusKind('ok');
        await refreshTelemetry();
      } catch {
        setStatusText('Error');
        setStatusKind('bad');
      }
    },
    [caseFilter, caseQuery, productHealthyFilter, productQuery, refreshTelemetry],
  );

  useEffect(() => {
    void refreshTelemetry();
    if (apiKey.trim()) {
      void loadWorkspaceWithKey(apiKey);
    }
  }, [caseFilter, caseQuery, productHealthyFilter, productQuery]);

  const handleProvisionSandbox = useCallback(async () => {
    setProvisioning(true);
    try {
      const res = await fetch('/v1/sandbox/provision', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to provision sandbox');
      const data = await res.json();
      setApiKey(data.apiKey);
      localStorage.setItem('sd_key', data.apiKey);
      navigateTo('dashboard');
      await loadWorkspaceWithKey(data.apiKey);
      showToast(`Sandbox ready: ${data.workspace.name}`);
    } catch {
      showToast('Could not provision sandbox workspace');
    } finally {
      setProvisioning(false);
    }
  }, [loadWorkspaceWithKey, navigateTo, showToast]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-group">
            <span
              className="brand-title"
              onClick={() => navigateTo('dashboard')}
            >
              Signaldesk
            </span>
            <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              {summary
                ? `${summary.workspaceName}`
                : 'no workspace'}
            </span>
          </div>

          <nav className="nav-tabs" aria-label="Primary Views">
            <button
              type="button"
              className={`nav-tab ${activePage === 'dashboard' ? 'active' : ''}`}
              onClick={() => navigateTo('dashboard')}
            >
              Floor
            </button>
            <button
              type="button"
              className={`nav-tab ${activePage === 'docs' ? 'active' : ''}`}
              onClick={() => navigateTo('docs')}
            >
              Notes
            </button>
            <button
              type="button"
              className={`nav-tab ${activePage === 'architecture' ? 'active' : ''}`}
              onClick={() => navigateTo('architecture')}
            >
              Map
            </button>
          </nav>

          <div className="nav-utilities">
            <span
              className={`badge ${
                telemetry?.slos.overallCompliant !== false
                  ? 'badge-ok'
                  : 'badge-warn'
              } mono`}
            >
              p95 {telemetry ? `${telemetry.latencies.ingestHttp.p95Ms}ms` : '—'}
            </span>
            <a
              href="/metrics"
              target="_blank"
              rel="noopener"
              className="btn-link btn-sm mono"
            >
              metrics
            </a>
            <button
              type="button"
              className="btn-sm"
              onClick={() =>
                setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
              }
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
      </header>

      <main className="main-container">
        {activePage === 'dashboard' && (
          <ControlPlaneView
            apiKey={apiKey}
            setApiKey={setApiKey}
            statusText={statusText}
            statusKind={statusKind}
            correlationId={correlationId}
            rateLimitRemaining={rateLimitRemaining}
            summary={summary}
            cases={cases}
            products={products}
            ingests={ingests}
            webhook={webhook}
            deliveries={deliveries}
            apiKeys={apiKeys}
            telemetry={telemetry}
            caseFilter={caseFilter}
            setCaseFilter={setCaseFilter}
            caseQuery={caseQuery}
            setCaseQuery={setCaseQuery}
            productHealthyFilter={productHealthyFilter}
            setProductHealthyFilter={setProductHealthyFilter}
            productQuery={productQuery}
            setProductQuery={setProductQuery}
            onLoadWorkspace={() => loadWorkspaceWithKey(apiKey)}
            onProvisionSandbox={handleProvisionSandbox}
            provisioning={provisioning}
            onNavigate={navigateTo}
            showToast={showToast}
          />
        )}

        {activePage === 'docs' && (
          <DocsView
            onNavigate={navigateTo}
            onProvisionSandbox={() => void handleProvisionSandbox()}
            provisioning={provisioning}
          />
        )}

        {activePage === 'architecture' && (
          <ArchitectureView
            telemetry={telemetry}
            onNavigate={navigateTo}
          />
        )}
      </main>

      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
