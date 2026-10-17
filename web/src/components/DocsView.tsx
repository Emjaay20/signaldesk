import { useState } from 'react';
import { ActivePage } from '../types';

interface DocsViewProps {
  onNavigate: (page: ActivePage) => void;
  onProvisionSandbox: () => void;
  provisioning: boolean;
}

export function DocsView({
  onNavigate,
  onProvisionSandbox,
  provisioning,
}: DocsViewProps) {
  const [activeSection, setActiveSection] = useState<string>('overview');

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(`doc-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="docs-layout">
      <aside className="docs-sidebar" aria-label="Documentation Navigation">
        <div className="docs-sidebar-title">Documentation &amp; ADR Hub</div>
        <ul className="docs-nav-list">
          <li>
            <button
              type="button"
              className={`docs-nav-btn ${activeSection === 'overview' ? 'active' : ''}`}
              onClick={() => scrollToSection('overview')}
            >
              1. Purpose &amp; Real-World Use Cases
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`docs-nav-btn ${activeSection === 'workflow' ? 'active' : ''}`}
              onClick={() => scrollToSection('workflow')}
            >
              2. How to Use Signaldesk
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`docs-nav-btn ${activeSection === 'tradeoffs' ? 'active' : ''}`}
              onClick={() => scrollToSection('tradeoffs')}
            >
              3. Principal Technical Trade-Offs
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`docs-nav-btn ${activeSection === 'what-we-built' ? 'active' : ''}`}
              onClick={() => scrollToSection('what-we-built')}
            >
              4. Engineering Capabilities Built
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`docs-nav-btn ${activeSection === 'webhooks' ? 'active' : ''}`}
              onClick={() => scrollToSection('webhooks')}
            >
              5. HMAC Webhook Verification
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`docs-nav-btn ${activeSection === 'api-ref' ? 'active' : ''}`}
              onClick={() => scrollToSection('api-ref')}
            >
              6. Full API Contract
            </button>
          </li>
        </ul>
      </aside>

      <div className="docs-content">
        {/* Section 1: Purpose & Real-World Use Cases */}
        <section id="doc-overview" className="docs-section">
          <span className="badge badge-info" style={{ marginBottom: '0.6rem' }}>
            Product &amp; Domain Guide
          </span>
          <h2>What is Signaldesk &amp; What Should You Use It For?</h2>
          <div className="docs-prose">
            <p>
              <strong>Signaldesk</strong> is a multi-tenant data quality, catalog health scoring,
              and automated incident-briefing control plane. Organizations syncing thousands of SKUs,
              cloud assets, or supply-chain records from external ERP feeds face a critical operational
              problem: <strong>corrupt upstream feeds silently break downstream revenue and operations</strong>.
            </p>
            <p>
              Instead of letting missing prices, unnamed items, or stockouts reach production
              checkouts unmonitored, Signaldesk sits in the ingestion path: it accepts bulk CSV feeds
              idempotently within a strict <code>p95 &lt; 200ms</code> latency budget, streams and scores
              every item in the background, opens deduplicated operational <strong>Health Cases</strong>,
              fires cryptographically signed <strong>HMAC-SHA256 webhooks</strong> to downstream responders
              (Slack, PagerDuty, ERP workflows), and automatically resolves incidents when a subsequent
              feed restores healthy data.
            </p>
          </div>

          <div className="tradeoff-grid">
            <div className="tradeoff-card">
              <h4>🛒 Multi-Tenant E-Commerce &amp; Retail</h4>
              <p>
                Marketplaces onboarding ratusan merchant CSV catalogs daily use Signaldesk to quarantine
                and flag SKUs missing pricing (<code>missing_price</code>), missing display titles
                (<code>missing_name</code>), or hitting zero inventory (<code>out_of_stock</code>) before
                ads or checkout flows fail.
              </p>
            </div>
            <div className="tradeoff-card">
              <h4>☁️ Cloud Hardware &amp; FinOps Asset Control</h4>
              <p>
                Infrastructure &amp; MSP teams (such as multi-cloud operations across AWS, GCP, Azure,
                and on-prem data centers) ingest hardware/appliance inventory exports to detect depleted
                spare capacity and trigger automated procurement webhooks.
              </p>
            </div>
            <div className="tradeoff-card">
              <h4>🏥 Supply-Chain &amp; Logistics Operations</h4>
              <p>
                Regional distribution hubs upload periodic warehouse snapshots with an idempotency key
                (<code>x-ingest-id</code>). Signaldesk deduplicates network retries, tracks stockout cases,
                and auto-closes cases as soon as restock shipments arrive.
              </p>
            </div>
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={onProvisionSandbox}
              disabled={provisioning}
            >
              {provisioning ? 'Provisioning Sandbox...' : '⚡ Provision Live Demo Workspace Now'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('architecture')}
            >
              View System Architecture Diagram →
            </button>
          </div>
        </section>

        {/* Section 2: How to Use Signaldesk */}
        <section id="doc-workflow" className="docs-section">
          <span className="badge badge-ok" style={{ marginBottom: '0.6rem' }}>
            Interactive Walkthrough
          </span>
          <h2>How to Use Signaldesk (UI &amp; API Workflow)</h2>
          <div className="docs-prose">
            <p>
              You can drive Signaldesk entirely from the interactive <strong>Control Plane UI</strong>{' '}
              (by clicking <em>Launch 1-Click Live Sandbox</em>) or integrate it into CI/CD and data
              pipelines via standard HTTP endpoints:
            </p>
          </div>

          <h3>Step 1 — Provision an Isolated Tenant Workspace</h3>
          <div className="docs-prose">
            <p>
              Platform administrators create a tenant workspace using <code>x-admin-token</code> (verified
              with constant-time <code>crypto.timingSafeEqual</code>). Signaldesk generates a{' '}
              <code>sd_live_...</code> API key <strong>once</strong> and persists only its SHA-256 hash.
            </p>
          </div>
          <pre className="code-block">{`curl -s -X POST https://signaldesk.aetherhost.com.ng/v1/workspaces \\
  -H 'content-type: application/json' \\
  -H 'x-admin-token: YOUR_ADMIN_TOKEN' \\
  -d '{"name":"Deimos Cloud Ops"}'`}</pre>

          <h3>Step 2 — Register an SSRF-Protected Webhook Endpoint</h3>
          <div className="docs-prose">
            <p>
              Tenants register a target URL to receive <code>case.opened</code> briefs. Signaldesk validates
              the URL against its SSRF guard and returns a <code>whsec_...</code> HMAC signing secret.
            </p>
          </div>
          <pre className="code-block">{`curl -s -X POST https://signaldesk.aetherhost.com.ng/v1/webhooks \\
  -H 'x-api-key: sd_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://ops.example.com/webhooks/signaldesk"}'`}</pre>

          <h3>Step 3 — Ingest Catalog CSVs Idempotently</h3>
          <div className="docs-prose">
            <p>
              Upload a CSV with an <code>x-ingest-id</code> header. The API validates the schema and returns{' '}
              <code>202 Accepted</code> in under 25ms. Re-sending the same <code>x-ingest-id</code> safely
              returns the existing job without duplicating work.
            </p>
          </div>
          <pre className="code-block">{`curl -s -X POST https://signaldesk.aetherhost.com.ng/v1/ingests \\
  -H 'x-api-key: sd_live_YOUR_KEY' \\
  -H 'x-ingest-id: ing_2026_10_16_batch1' \\
  -F 'file=@catalog-with-issues.csv'`}</pre>
        </section>

        {/* Section 3: Principal Technical Trade-Offs */}
        <section id="doc-tradeoffs" className="docs-section">
          <span className="badge badge-warn" style={{ marginBottom: '0.6rem' }}>
            Principal Engineering Decisions
          </span>
          <h2>Key Architectural Trade-Offs &amp; Design Rationale</h2>
          <div className="docs-prose">
            <p>
              Every architectural decision in Signaldesk balances <strong>scalability, operational cost,
              fault tolerance, and delivery speed</strong>:
            </p>
          </div>

          <div className="tradeoff-grid">
            <div className="tradeoff-card">
              <h4>1. Vite + React SPA on Same-Origin NestJS vs. Next.js SSR</h4>
              <p>
                <strong>Decision:</strong> Compile the React 18 + TypeScript frontend via Vite into static
                bundles served directly by NestJS on port 80.
              </p>
              <p>
                <strong>Trade-off &amp; Why:</strong> Signaldesk is an authenticated operational control
                plane where SEO/SSR provides zero business value. Serving compiled assets from the same
                origin eliminates CORS preflight latency, saves ~180 MB of duplicate Node.js SSR runtime
                memory inside the <code>512m</code> container budget, and keeps deployments atomic.
              </p>
            </div>

            <div className="tradeoff-card">
              <h4>2. Hybrid Extract (202 Accepted + AsyncGenerator Chunks) vs. Sync Upsert</h4>
              <p>
                <strong>Decision:</strong> Persist raw CSV bytes synchronously on <code>POST /v1/ingests</code>{' '}
                and stream rows in 250-row batches via <code>AsyncGenerator</code> in the worker.
              </p>
              <p>
                <strong>Trade-off &amp; Why:</strong> Synchronous row-by-row upserts violate the{' '}
                <code>p95 &lt; 200ms</code> ingest SLO and risk HTTP timeouts on 5 MB uploads. Streaming
                in 250-row chunks keeps worker heap allocation <code>O(chunk size)</code> instead of{' '}
                <code>O(N)</code> and replaces 2N queries with batch <code>WHERE sku IN (...)</code> lookups.
              </p>
            </div>

            <div className="tradeoff-card">
              <h4>3. PostgreSQL Lease Locks &amp; Outbox vs. Mandatory Redis/Kafka Sprawl</h4>
              <p>
                <strong>Decision:</strong> Implement optimistic lease locking (<code>lockedAt</code>,{' '}
                <code>lockedBy</code>, <code>reclaimStaleLocks</code>) and a PostgreSQL{' '}
                <code>WebhookDelivery</code> outbox with hexagonal ports for S3/GCS/Azure.
              </p>
              <p>
                <strong>Trade-off &amp; Why:</strong> Avoids operational fragility of managing separate
                broker clusters for moderate throughput while guaranteeing zero stuck <code>processing</code>{' '}
                jobs after OOM/SIGKILL crashes and at-least-once webhook delivery with exponential backoff.
              </p>
            </div>

            <div className="tradeoff-card">
              <h4>4. 60s Debounced API Key Telemetry vs. Per-Request DB Writes</h4>
              <p>
                <strong>Decision:</strong> Debounce <code>ApiKey.lastUsedAt</code> updates in{' '}
                <code>ApiKeyGuard</code> to at most once per 60 seconds per key.
              </p>
              <p>
                <strong>Trade-off &amp; Why:</strong> Updating <code>lastUsedAt</code> on every{' '}
                <code>GET /v1/products</code> turns read-only queries into write transactions. A 60-second
                debounce removes 99%+ of write amplification while preserving security audit accuracy.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: What We Built */}
        <section id="doc-what-we-built" className="docs-section">
          <span className="badge badge-info" style={{ marginBottom: '0.6rem' }}>
            Implementation Matrix
          </span>
          <h2>What We Built Across the Stack</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pillar</th>
                  <th>Engineering Implementation</th>
                  <th>Key Source Modules</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Modular DDD &amp; Multi-Cloud Ports</strong></td>
                  <td>
                    Explicit bounded contexts (Identity, Ingests, Health Scoring, Webhooks, Observability)
                    + <code>CatalogBlobStoragePort</code> supporting AWS S3, GCP GCS, Azure Blob, MinIO, and Postgres.
                  </td>
                  <td className="mono">src/common/ports/blob-storage.port.ts</td>
                </tr>
                <tr>
                  <td><strong>Streaming &amp; Lease Recovery</strong></td>
                  <td>
                    <code>streamCsvChunks</code> AsyncGenerator (250 rows/chunk), batch case prefetching,
                    and <code>reclaimStaleLocks</code> recovering crashed worker jobs after 120s.
                  </td>
                  <td className="mono">src/ingests/ingest.processor.ts</td>
                </tr>
                <tr>
                  <td><strong>Transactional Webhook Outbox</strong></td>
                  <td>
                    Persistent <code>WebhookDelivery</code> log, 5s timeout, exponential backoff with jitter,
                    and manual replay endpoint (<code>POST /v1/webhooks/deliveries/:id/replay</code>).
                  </td>
                  <td className="mono">src/webhooks/deliver.ts · webhooks.service.ts</td>
                </tr>
                <tr>
                  <td><strong>Security &amp; Zero-Downtime Key Rotation</strong></td>
                  <td>
                    SHA-256 hashed keys, <code>timingSafeEqual</code> verification, key rotation/revocation
                    (<code>/v1/api-keys</code>), SSRF metadata blocking, and per-tenant rate limiting.
                  </td>
                  <td className="mono">src/auth/* · src/webhooks/ssrf.guard.ts</td>
                </tr>
                <tr>
                  <td><strong>Observability &amp; SLO Error Budgets</strong></td>
                  <td>
                    <code>AsyncLocalStorage</code> correlation IDs (<code>x-correlation-id</code>), structured
                    JSON logs, Prometheus <code>/metrics</code>, and live p50/p95/p99 + Event Loop lag telemetry.
                  </td>
                  <td className="mono">src/observability/metrics.service.ts</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 5: Webhook Verification */}
        <section id="doc-webhooks" className="docs-section">
          <span className="badge badge-ok" style={{ marginBottom: '0.6rem' }}>
            Consumer Security Guide
          </span>
          <h2>Verifying HMAC-SHA256 Webhook Signatures</h2>
          <div className="docs-prose">
            <p>
              Every outbound webhook includes an <code>x-signaldesk-signature</code> header formatted as{' '}
              <code>t=&lt;unix_timestamp&gt;,v1=&lt;hex_hmac_sha256&gt;</code>. Consumers should verify the
              HMAC over <code>{`\${timestamp}.\${rawBody}`}</code> using <code>crypto.timingSafeEqual</code>{' '}
              and reject timestamps older than 5 minutes to prevent replay attacks:
            </p>
          </div>
          <pre className="code-block">{`import { createHmac, timingSafeEqual } from 'crypto';

export function verifySignaldeskWebhook(
  secret: string,
  signatureHeader: string,
  rawBody: string,
): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('=')),
  );
  const timestamp = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(timestamp) || !v1) return false;

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() - timestamp * 1000) > 5 * 60 * 1000) {
    return false;
  }

  const expectedHex = createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');

  const a = Buffer.from(\`t=\${timestamp},v1=\${expectedHex}\`);
  const b = Buffer.from(\`t=\${timestamp},v1=\${v1}\`);
  return a.length === b.length && timingSafeEqual(a, b);
}`}</pre>
        </section>

        {/* Section 6: Full API Contract */}
        <section id="doc-api-ref" className="docs-section">
          <span className="badge badge-info" style={{ marginBottom: '0.6rem' }}>
            REST API Specification
          </span>
          <h2>Complete REST API Reference</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Auth Header</th>
                  <th>Purpose &amp; Behavior</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono">POST /v1/workspaces</td>
                  <td className="mono">x-admin-token</td>
                  <td>Creates a tenant workspace and returns the raw <code>sd_live_...</code> key once.</td>
                </tr>
                <tr>
                  <td className="mono">GET /v1/me</td>
                  <td className="mono">x-api-key</td>
                  <td>Returns authenticated workspace identity.</td>
                </tr>
                <tr>
                  <td className="mono">GET · POST · DELETE /v1/api-keys</td>
                  <td className="mono">x-api-key</td>
                  <td>Lists, rotates (mints), or immediately revokes workspace API keys.</td>
                </tr>
                <tr>
                  <td className="mono">POST /v1/ingests</td>
                  <td className="mono">x-api-key + x-ingest-id</td>
                  <td>Uploads a catalog CSV (&le; 5 MB); idempotent on <code>x-ingest-id</code>, returns 202.</td>
                </tr>
                <tr>
                  <td className="mono">POST /v1/ingests/:id/process</td>
                  <td className="mono">x-api-key</td>
                  <td>Triggers immediate chunked processing of a pending ingest job.</td>
                </tr>
                <tr>
                  <td className="mono">GET /v1/products</td>
                  <td className="mono">x-api-key</td>
                  <td>Lists scored catalog SKUs with optional <code>?healthy=true|false&amp;q=search</code>.</td>
                </tr>
                <tr>
                  <td className="mono">GET /v1/catalog/summary</td>
                  <td className="mono">x-api-key</td>
                  <td>Aggregate health score, healthy/unhealthy split, and reason counts.</td>
                </tr>
                <tr>
                  <td className="mono">GET /v1/cases</td>
                  <td className="mono">x-api-key</td>
                  <td>Lists open or closed health cases (<code>?status=open|closed</code>).</td>
                </tr>
                <tr>
                  <td className="mono">POST /v1/cases/:id/resolve</td>
                  <td className="mono">x-api-key</td>
                  <td>Manually closes an open health case with an operator resolution note.</td>
                </tr>
                <tr>
                  <td className="mono">POST · GET /v1/webhooks</td>
                  <td className="mono">x-api-key</td>
                  <td>Configures or inspects the workspace webhook endpoint (SSRF guarded).</td>
                </tr>
                <tr>
                  <td className="mono">GET /v1/webhooks/deliveries</td>
                  <td className="mono">x-api-key</td>
                  <td>Lists transactional outbox webhook deliveries, status codes, and latencies.</td>
                </tr>
                <tr>
                  <td className="mono">POST /v1/webhooks/deliveries/:id/replay</td>
                  <td className="mono">x-api-key</td>
                  <td>Re-signs and replays a webhook delivery from the outbox.</td>
                </tr>
                <tr>
                  <td className="mono">GET /metrics · GET /v1/telemetry</td>
                  <td className="mono">Public</td>
                  <td>Prometheus 0.0.4 exposition format and JSON SLO/runtime diagnostics.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
