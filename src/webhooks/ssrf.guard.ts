import { BadRequestException } from '@nestjs/common';

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200',
  'fd00:ec2::254',
]);

export interface SsrfValidationOptions {
  blockPrivateNetworks?: boolean;
}

export function isWebhookUrlSafe(
  rawUrl: string,
  options: SsrfValidationOptions = {},
): { safe: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      safe: false,
      reason: 'Webhook URL must use http or https protocol',
    };
  }

  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost.replace(/^\[|\]$/g, '');

  if (isCloudMetadataOrLinkLocal(host)) {
    return {
      safe: false,
      reason:
        'Cloud metadata and link-local addresses are forbidden (SSRF protection)',
    };
  }

  const blockPrivate =
    options.blockPrivateNetworks ??
    process.env.WEBHOOK_BLOCK_PRIVATE_IPS === 'true';

  if (blockPrivate && isPrivateOrLoopbackHost(host)) {
    return {
      safe: false,
      reason:
        'Private or loopback network targets are forbidden in strict SSRF mode',
    };
  }

  return { safe: true };
}

export function assertSafeWebhookUrl(
  rawUrl: string,
  options?: SsrfValidationOptions,
): void {
  const result = isWebhookUrlSafe(rawUrl, options);
  if (!result.safe) {
    throw new BadRequestException(result.reason ?? 'Unsafe webhook target URL');
  }
}

function isCloudMetadataOrLinkLocal(host: string): boolean {
  if (
    BLOCKED_METADATA_HOSTS.has(host) ||
    host.startsWith('169.254.') ||
    host.startsWith('fe80:') ||
    host.includes('169.254.169.254') ||
    host.endsWith(':a9fe:a9fe')
  ) {
    return true;
  }
  return false;
}

function isPrivateOrLoopbackHost(host: string): boolean {
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host === '::' ||
    host === '0:0:0:0:0:0:0:1' ||
    host === '0:0:0:0:0:0:0:0'
  ) {
    return true;
  }

  // IPv6 Unique Local (fc00::/7 -> fc.. or fd..) and Link-Local (fe80::/10)
  if (/^(fc|fd|fe[89ab])[0-9a-f]{0,2}:/i.test(host)) {
    return true;
  }

  // IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (host.startsWith('::ffff:')) {
    const tail = host.slice('::ffff:'.length);
    if (isPrivateOrLoopbackIpv4(tail)) {
      return true;
    }
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
    if (hexMatch) {
      const hi = Number.parseInt(hexMatch[1], 16);
      const lo = Number.parseInt(hexMatch[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      if (isPrivateOrLoopbackIpv4(ipv4)) {
        return true;
      }
    }
  }

  return isPrivateOrLoopbackIpv4(host);
}

function isPrivateOrLoopbackIpv4(host: string): boolean {
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4Match) {
    return false;
  }

  const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
  if (a === 127 || a === 10 || a === 0) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}
