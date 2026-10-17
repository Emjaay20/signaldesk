import { ActivePage, TelemetryResponse } from '../types';

interface ArchitectureViewProps {
  telemetry: TelemetryResponse | null;
  onNavigate: (page: ActivePage) => void;
}

export function ArchitectureView({
  telemetry,
  onNavigate,
}: ArchitectureViewProps) {
  return (
    <div>
      <section className="hero-banner">
        <div className="hero-content">
          <h2 className="hero-title">Runtime map</h2>
          <p className="hero-subtitle">
            API accepts the CSV. Worker scores it. Postgres holds leases and the outbox.
          </p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => onNavigate('dashboard')}
          >
            Floor
          </button>
          <button type="button" onClick={() => onNavigate('docs')}>
            Notes
          </button>
        </div>
      </section>

      <section className="panel" style={{ overflowX: 'auto' }}>
        <div className="panel-header">
            <div className="panel-title">Topology</div>
          <span className="badge badge-info mono">
            Traefik TLS · NestJS API · Async Worker · Transactional Outbox
          </span>
        </div>
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <svg
            viewBox="0 0 1100 620"
            style={{ width: '100%', minWidth: '820px', display: 'block', background: '#020617', borderRadius: '0.75rem' }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
              </marker>
              <pattern
                id="arch-grid"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>

            <rect width="100%" height="100%" fill="url(#arch-grid)" />

            {/* Arrows */}
            <line x1="150" y1="118" x2="248" y2="198" stroke="#22d3ee" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="150" y1="198" x2="248" y2="218" stroke="#22d3ee" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="150" y1="278" x2="248" y2="238" stroke="#34d399" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="380" y1="218" x2="418" y2="218" stroke="#34d399" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="520" y1="308" x2="520" y2="358" stroke="#34d399" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="630" y1="218" x2="698" y2="188" stroke="#fb923c" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="630" y1="240" x2="698" y2="268" stroke="#a78bfa" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="630" y1="268" x2="698" y2="348" stroke="#fbbf24" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="630" y1="390" x2="698" y2="268" stroke="#a78bfa" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <line x1="850" y1="188" x2="918" y2="188" stroke="#fb923c" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
            <path
              d="M 990 230 L 990 500 Q 990 530 960 530 L 210 530 Q 180 530 180 500 L 180 250"
              fill="none"
              stroke="#fb7185"
              strokeWidth="1.5"
              strokeDasharray="5,5"
            />
            <text x="295" y="150" fill="#94a3b8" fontSize="9">HTTPS</text>
            <text x="386" y="210" fill="#94a3b8" fontSize="9">:80</text>
            <text x="530" y="338" fill="#94a3b8" fontSize="9">lease locks</text>
            <text x="862" y="176" fill="#94a3b8" fontSize="9">HMAC-SHA256</text>
            <text x="650" y="548" fill="#fb7185" fontSize="9">
              x-api-key (SHA-256) + x-correlation-id + workspace isolation
            </text>

            {/* External Actors */}
            <rect x="24" y="88" width="126" height="60" rx="6" fill="rgba(8, 51, 68, 0.55)" stroke="#22d3ee" strokeWidth="1.5" />
            <text x="87" y="112" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">React SPA</text>
            <text x="87" y="128" fill="#94a3b8" fontSize="9" textAnchor="middle">Control Plane + Docs</text>

            <rect x="24" y="168" width="126" height="60" rx="6" fill="rgba(30, 41, 59, 0.7)" stroke="#94a3b8" strokeWidth="1.5" />
            <text x="87" y="192" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">Tenant API</text>
            <text x="87" y="208" fill="#94a3b8" fontSize="9" textAnchor="middle">SaaS / CI pipelines</text>

            <rect x="24" y="248" width="126" height="60" rx="6" fill="rgba(30, 41, 59, 0.7)" stroke="#94a3b8" strokeWidth="1.5" />
            <text x="87" y="272" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">CSV Feed</text>
            <text x="87" y="288" fill="#94a3b8" fontSize="9" textAnchor="middle">x-ingest-id</text>

            {/* Cloud Region Boundary */}
            <rect x="180" y="36" width="900" height="540" rx="12" fill="rgba(251, 191, 36, 0.04)" stroke="#fbbf24" strokeWidth="1" strokeDasharray="8,4" />
            <text x="198" y="60" fill="#fbbf24" fontSize="11" fontWeight="600">
              AetherHost · Docker Compose · Traefik TLS (signaldesk.aetherhost.com.ng)
            </text>

            {/* Traefik */}
            <rect x="250" y="188" width="130" height="60" rx="6" fill="rgba(120, 53, 15, 0.4)" stroke="#fbbf24" strokeWidth="1.5" />
            <text x="315" y="212" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">Traefik Edge</text>
            <text x="315" y="228" fill="#94a3b8" fontSize="9" textAnchor="middle">Let&apos;s Encrypt TLS</text>

            {/* NestJS API */}
            <rect x="420" y="118" width="210" height="190" rx="6" fill="rgba(6, 78, 59, 0.45)" stroke="#34d399" strokeWidth="1.5" />
            <text x="525" y="144" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">NestJS 10 API</text>
            <text x="525" y="164" fill="#94a3b8" fontSize="9" textAnchor="middle">Identity · Key Rotation</text>
            <text x="525" y="180" fill="#94a3b8" fontSize="9" textAnchor="middle">Idempotent Ingest Gate</text>
            <text x="525" y="196" fill="#94a3b8" fontSize="9" textAnchor="middle">Health Scoring · Cases</text>
            <text x="525" y="212" fill="#94a3b8" fontSize="9" textAnchor="middle">SSRF Guard · Outbox Replay</text>
            <text x="525" y="238" fill="#34d399" fontSize="9" textAnchor="middle">SLO: p95 ingest &lt; 200ms</text>
            <text x="525" y="256" fill="#22d3ee" fontSize="9" textAnchor="middle">Prometheus /metrics</text>

            {/* Worker */}
            <rect x="420" y="360" width="210" height="80" rx="6" fill="rgba(6, 78, 59, 0.45)" stroke="#34d399" strokeWidth="1.5" />
            <text x="525" y="385" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">Node Stream Worker</text>
            <text x="525" y="403" fill="#94a3b8" fontSize="9" textAnchor="middle">AsyncGenerator (250 rows/chunk)</text>
            <text x="525" y="420" fill="#34d399" fontSize="9" textAnchor="middle">Stale Lock Recovery + Retries</text>

            {/* Outbox / Queue */}
            <rect x="700" y="158" width="150" height="60" rx="6" fill="rgba(251, 146, 60, 0.3)" stroke="#fb923c" strokeWidth="1.5" />
            <text x="775" y="182" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">Webhook Outbox</text>
            <text x="775" y="198" fill="#94a3b8" fontSize="9" textAnchor="middle">Exp Backoff + Jitter</text>

            {/* Postgres */}
            <rect x="700" y="238" width="150" height="60" rx="6" fill="rgba(76, 29, 149, 0.45)" stroke="#a78bfa" strokeWidth="1.5" />
            <text x="775" y="262" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">PostgreSQL 16</text>
            <text x="775" y="278" fill="#94a3b8" fontSize="9" textAnchor="middle">Source of Truth (Prisma)</text>

            {/* Multi-Cloud Blob Port */}
            <rect x="700" y="318" width="150" height="60" rx="6" fill="rgba(120, 53, 15, 0.35)" stroke="#fbbf24" strokeWidth="1.5" />
            <text x="775" y="342" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">Storage Port</text>
            <text x="775" y="358" fill="#94a3b8" fontSize="9" textAnchor="middle">S3 · GCS · Azure · PG</text>

            {/* Webhook Receiver */}
            <rect x="920" y="158" width="140" height="60" rx="6" fill="rgba(30, 41, 59, 0.7)" stroke="#94a3b8" strokeWidth="1.5" />
            <text x="990" y="182" fill="white" fontSize="12" fontWeight="600" textAnchor="middle">Tenant Webhooks</text>
            <text x="990" y="198" fill="#94a3b8" fontSize="9" textAnchor="middle">Signed Briefs (5m TTL)</text>
          </svg>
        </div>
      </section>

      {telemetry && (
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">📊 Live Platform SLO &amp; Node.js Runtime Diagnostics</div>
            <span className="badge badge-ok mono">Status: {telemetry.status}</span>
          </div>
          <div className="kpi-grid" style={{ marginBottom: 0 }}>
            <div className="kpi-card">
              <div className="kpi-label">Database Readiness Ping</div>
              <div className="kpi-value">{telemetry.database.pingMs} ms</div>
              <div className="kpi-sub">PostgreSQL 16 connection pool</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Ingest HTTP (p50 / p95 / p99)</div>
              <div className="kpi-value">
                {telemetry.latencies.ingestHttp.p50Ms} / {telemetry.latencies.ingestHttp.p95Ms} /{' '}
                {telemetry.latencies.ingestHttp.p99Ms} ms
              </div>
              <div className="kpi-sub">Target SLO: p95 &lt; 200ms</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Node.js Event Loop Lag (p99)</div>
              <div className="kpi-value">{telemetry.runtime.eventLoopLagP99Ms} ms</div>
              <div className="kpi-sub">
                RSS: {(telemetry.runtime.rssBytes / (1024 * 1024)).toFixed(1)} MB
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Processed Rows / Webhooks</div>
              <div className="kpi-value">{telemetry.counters.rowsProcessedTotal}</div>
              <div className="kpi-sub">
                {telemetry.counters.webhooksDeliveredTotal} webhooks delivered
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
