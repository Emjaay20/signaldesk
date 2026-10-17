import { createHash, randomBytes } from 'crypto';

const KEY_PREFIX = 'sd_live_';

export function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function apiKeyPrefix(raw: string): string {
  return raw.slice(0, 12);
}
