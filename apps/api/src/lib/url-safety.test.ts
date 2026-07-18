import { describe, expect, it } from 'vitest';
import { assertDeliverableUrl, isBlockedAddress, UnsafeUrlError } from './url-safety.js';

/**
 * The SSRF guard is the single control that stops a tenant pointing a webhook at
 * our internal network (loopback, RFC-1918, link-local, cloud metadata). These
 * are pure/lookup-light assertions — no live DNS is required because every case
 * uses an IP literal or a protocol/host that short-circuits before resolution.
 */
describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local and cloud-metadata IPv4', () => {
    for (const ip of [
      '0.0.0.0', // "this network"
      '127.0.0.1', // loopback
      '127.1.2.3', // 127/8
      '10.0.0.1', // 10/8 private
      '10.255.255.255',
      '172.16.0.1', // 172.16/12 private (low edge)
      '172.20.10.5',
      '172.31.255.255', // 172.16/12 private (high edge)
      '192.168.0.1', // 192.168/16 private
      '169.254.169.254', // link-local — the classic cloud metadata endpoint
      '100.64.0.1', // 100.64/10 CGNAT
      '224.0.0.1', // multicast
      '255.255.255.255', // broadcast (>= 240)
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('allows genuine public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.167.0.1', '11.0.0.1']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it('blocks loopback, unique-local, link-local and mapped-private IPv6', () => {
    for (const ip of [
      '::1', // loopback
      '::', // unspecified
      'fe80::1', // link-local
      'fc00::1', // fc00::/7 unique-local
      'fd00::abcd', // fd00 unique-local
      '::ffff:10.0.0.1', // IPv4-mapped private (dotted)
      '::ffff:127.0.0.1', // IPv4-mapped loopback (dotted)
      // Compressed-hex forms that `new URL()` normalizes to — the critical
      // SSRF bypass the guard must catch (169.254.169.254 / 127.0.0.1 / 10.0.0.1 / 192.168.0.1).
      '::ffff:a9fe:a9fe',
      '::ffff:7f00:1',
      '::ffff:a00:1',
      '::ffff:c0a8:1',
      // Full fe80::/10 link-local (not just fe80::/16).
      'fe90::1',
      'febf::1',
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('allows public IPv6 (incl. an IPv4-mapped public address)', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false); // Google DNS
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false); // mapped public
  });

  it('refuses anything that is not a valid IP', () => {
    for (const value of ['', 'not-an-ip', 'example.com', '999.1.1.1', '10.0.0']) {
      expect(isBlockedAddress(value)).toBe(true);
    }
  });
});

describe('assertDeliverableUrl (allowLocal = false, i.e. production)', () => {
  async function expectRejected(url: string): Promise<void> {
    await expect(assertDeliverableUrl(url, false)).rejects.toBeInstanceOf(UnsafeUrlError);
  }

  it('rejects http:// (https is mandatory in production)', async () => {
    await expectRejected('http://example.com/hook');
  });

  it('rejects non-http(s) schemes such as ftp://', async () => {
    await expectRejected('ftp://example.com/hook');
  });

  it('rejects localhost and internal/local/private-suffix hosts', async () => {
    await expectRejected('https://localhost/hook');
    await expectRejected('https://api.localhost/hook');
    await expectRejected('https://svc.internal/hook');
    await expectRejected('https://db.local/hook');
  });

  it('rejects URLs whose host is a private/loopback IP literal', async () => {
    await expectRejected('https://127.0.0.1/hook');
    await expectRejected('https://10.0.0.5/hook');
    await expectRejected('https://169.254.169.254/latest/meta-data'); // cloud metadata
    await expectRejected('https://[::1]/hook');
  });

  it('rejects a malformed URL', async () => {
    await expectRejected('not a url');
  });

  it('allows an https URL whose host is a public IP literal', async () => {
    await expect(assertDeliverableUrl('https://8.8.8.8/hook', false)).resolves.toBeUndefined();
  });
});

describe('assertDeliverableUrl (allowLocal = true, i.e. local dev/tests)', () => {
  it('allows http:// and loopback/localhost so tests can point at a local receiver', async () => {
    await expect(assertDeliverableUrl('http://127.0.0.1:9099/hook', true)).resolves.toBeUndefined();
    await expect(assertDeliverableUrl('http://localhost:3000/hook', true)).resolves.toBeUndefined();
    await expect(assertDeliverableUrl('https://svc.internal/hook', true)).resolves.toBeUndefined();
  });

  it('still rejects non-http(s) schemes even when local delivery is allowed', async () => {
    await expect(assertDeliverableUrl('ftp://example.com/hook', true)).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });

  it('still rejects a malformed URL', async () => {
    await expect(assertDeliverableUrl('http://', true)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
