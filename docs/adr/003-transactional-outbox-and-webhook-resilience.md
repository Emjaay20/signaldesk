# ADR 003 — Transactional Webhook Outbox, HMAC Replay Protection & SSRF Defense

- **Status**: Accepted
- **Date**: 2026-10-16
- **Deciders**: Principal Platform Architecture

## Context

Outbound tenant webhooks are inherently untrusted network boundaries:
1. Tenant endpoints may experience transient 5xx failures or network timeouts, risking lost incident notifications if webhooks are fire-and-forget.
2. Tenant receivers must cryptographically verify that payloads originated from Signaldesk and were not replayed by an eavesdropper.
3. Malicious tenants could register internal RFC1918 addresses or cloud instance metadata endpoints (`http://169.254.169.254/latest/meta-data/`), creating a Server-Side Request Forgery (SSRF) vulnerability.

## Decision

1. **Persistent Delivery Outbox (`WebhookDelivery` Model)**:
   - Every webhook dispatch records a `WebhookDelivery` audit entry containing `eventType`, `targetUrl`, `payload`, `signature`, `status` (`delivered` | `retrying` | `exhausted`), `attempts`, `lastStatusCode`, `durationMs`, and `nextAttemptAt`.
   - Failed deliveries schedule automatic retries using **exponential backoff with jitter**:
     $$\text{delay}(a) = \min\left(60000,\; 2^{a-1} \times 1000\right) + \text{Uniform}(0, 250)\text{ ms}$$
   - Operators can inspect delivery history via `GET /v1/webhooks/deliveries` and trigger manual redelivery via `POST /v1/webhooks/deliveries/:id/replay`.

2. **Timestamped HMAC-SHA256 Signatures (`x-signaldesk-signature`)**:
   - Payloads are signed over `${timestamp}.${rawBody}` using the workspace's `whsec_...` secret.
   - `verifyWebhook` enforces constant-time comparison (`crypto.timingSafeEqual`) and rejects signatures outside a $\pm 5\text{ minute}$ replay window (`MAX_AGE_MS = 300,000`).

3. **Defense-in-Depth SSRF & Timeout Guard (`ssrf.guard.ts`)**:
   - Outbound requests enforce `AbortSignal.timeout(5000)` to prevent slowloris socket exhaustion in the worker.
   - Cloud metadata hosts (`169.254.169.254`, `metadata.google.internal`, `100.100.100.200`, `[fd00:ec2::254]`) are unconditionally blocked at registration time.
   - Private/loopback ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `localhost`) are blocked when `WEBHOOK_BLOCK_PRIVATE_IPS=true`.
