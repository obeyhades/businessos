import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for user-supplied webhook URLs. A tenant must not be able to point
 * a webhook at loopback / private / link-local / cloud-metadata addresses and
 * have our server POST to internal services. We require https, then resolve the
 * host and reject if ANY resolved address is non-public — closing the
 * DNS-rebinding hole where a public name resolves to a private IP.
 *
 * NOTE: this file is intentionally duplicated byte-for-byte in
 * apps/worker/src/lib/url-safety.ts (API validates at create/ping time; the
 * worker re-checks at delivery time). Keep the two copies in sync.
 */

function ipv4IsBlocked(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + broadcast
  return false;
}

function ipv6IsBlocked(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsBlocked(mapped[1]!);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4IsBlocked(ip);
  if (kind === 6) return ipv6IsBlocked(ip);
  return true; // not a valid IP → refuse
}

export class UnsafeUrlError extends Error {}

/**
 * Throws UnsafeUrlError unless `raw` is an https URL whose host resolves only to
 * public addresses. Call before making any request to a tenant-controlled URL.
 *
 * `allowLocal` (driven by WEBHOOK_ALLOW_LOCAL, off in production) relaxes the
 * https requirement and the private-address block so local dev/tests can point
 * a webhook at a loopback receiver. It must never be enabled in production.
 */
export async function assertDeliverableUrl(raw: string, allowLocal = false): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (allowLocal) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new UnsafeUrlError('Webhook URL must use http(s)');
    }
    return;
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Webhook URL must use https');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const lowered = host.toLowerCase();
  if (
    lowered === 'localhost' ||
    lowered.endsWith('.localhost') ||
    lowered.endsWith('.local') ||
    lowered.endsWith('.internal')
  ) {
    throw new UnsafeUrlError('Webhook URL host is not allowed');
  }

  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new UnsafeUrlError('Webhook URL resolves to a private address');
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError('Webhook URL host could not be resolved');
  }
  if (addresses.length === 0) throw new UnsafeUrlError('Webhook URL host could not be resolved');
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeUrlError('Webhook URL resolves to a private address');
    }
  }
}
