import { lookup as dnsLookupCb } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/**
 * SSRF guard for user-supplied webhook URLs. A tenant must not be able to point
 * a webhook at loopback / private / link-local / cloud-metadata addresses and
 * have our server POST to internal services. Two layers:
 *   1. assertDeliverableUrl — https + host/literal-IP pre-check (fast reject).
 *   2. safeRequest — the actual request pins DNS via a guarded `lookup` that
 *      re-checks the resolved address at CONNECT time, closing the
 *      resolve→connect DNS-rebinding window that a separate pre-check can't.
 *
 * NOTE: this file is duplicated byte-for-byte in apps/worker/src/lib/url-safety.ts.
 * Keep the two copies in sync.
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

/**
 * Extracts an embedded IPv4 from an IPv6 literal — both dotted and (WHATWG-URL-
 * normalized) compressed-hex forms of IPv4-mapped (::ffff:a.b.c.d) and the
 * deprecated IPv4-compatible (::a.b.c.d) addresses. `new URL()` rewrites
 * `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, so matching only the
 * dotted form would miss the whole mapped range — the SSRF hole this closes.
 */
function embeddedIpv4(lower: string): string | null {
  const dotted = lower.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1]!;
  const hex = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function ipv6IsBlocked(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  // Link-local fe80::/10 = first hextet fe80–febf (not just fe80::/16).
  const firstHextet = lower.split(':')[0]!;
  if (/^fe[89ab][0-9a-f]$/.test(firstHextet)) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
  const mapped = embeddedIpv4(lower);
  if (mapped) return ipv4IsBlocked(mapped);
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

/** DNS lookup that rejects the connection if the resolved address is private —
 *  used as http/https `lookup` so the address we validate IS the one connected
 *  to (no rebinding gap). Literal-IP hosts skip lookup, so assertDeliverableUrl
 *  still guards those. */
function guardedLookup(allowLocal: boolean) {
  return (hostname: string, options: unknown, cb: (err: Error | null, address: string, family: number) => void): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dnsLookupCb(hostname, options as any, (err: Error | null, address: string, family: number) => {
      if (err) return cb(err, address, family);
      if (!allowLocal && isBlockedAddress(address)) {
        return cb(new UnsafeUrlError('Webhook URL resolves to a private address'), address, family);
      }
      cb(null, address, family);
    });
  };
}

export interface SafeRequestResult {
  status: number;
}

/**
 * Makes an SSRF-safe outbound request to a tenant-controlled URL: pre-checks the
 * URL, then issues the request with a guarded DNS lookup so a rebinding attack
 * (public at check, private at connect) is refused at connect time. Redirects
 * are never followed (a 3xx to an internal host is returned as-is). Throws
 * UnsafeUrlError on an unsafe URL/address, or Error on network/timeout.
 */
export async function safeRequest(
  raw: string,
  init: { method: string; headers: Record<string, string>; body: string; timeoutMs: number },
  allowLocal: boolean,
): Promise<SafeRequestResult> {
  await assertDeliverableUrl(raw, allowLocal);
  const url = new URL(raw);
  const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return await new Promise<SafeRequestResult>((resolve, reject) => {
    const req = requester(
      url,
      {
        method: init.method,
        headers: init.headers,
        lookup: guardedLookup(allowLocal),
        timeout: init.timeoutMs,
      },
      (res) => {
        res.resume(); // drain and free the socket; we only need the status
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(init.body);
  });
}
