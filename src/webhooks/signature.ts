import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_MS = 5 * 60 * 1000;

export function signWebhook(
  secret: string,
  timestamp: number,
  body: string,
): string {
  const v1 = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export function verifyWebhook(
  secret: string,
  header: string,
  body: string,
  nowMs: number,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const idx = part.indexOf('=');
      return [part.slice(0, idx), part.slice(idx + 1)];
    }),
  );
  const timestamp = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(timestamp) || !v1) {
    return false;
  }
  if (Math.abs(nowMs - timestamp * 1000) > MAX_AGE_MS) {
    return false;
  }
  const expected = signWebhook(secret, timestamp, body);
  const received = `t=${timestamp},v1=${v1}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
