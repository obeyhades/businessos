import { describe, expect, it } from 'vitest';
import { assertDeliverableUrl, isBlockedAddress, UnsafeUrlError } from './url-safety.js';

/**
 * The worker re-checks the target URL at delivery time (DNS may have changed
 * since the endpoint was created — the DNS-rebinding hole), so its copy of the
 * SSRF guard must block the same address classes as the API's.
 */
describe('isBlockedAddress (worker copy)', () => {
  it('blocks loopback, private, link-local and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fe80::1',
      'fc00::1',
      'fd00::1',
      '::ffff:10.0.0.1',
      // Compressed-hex IPv4-mapped forms `new URL()` produces (critical SSRF fix).
      '::ffff:a9fe:a9fe', // 169.254.169.254
      '::ffff:7f00:1', // 127.0.0.1
      '::ffff:c0a8:1', // 192.168.0.1
      'fe90::1', // full fe80::/10 link-local
      'febf::1',
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('allows genuine public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it('refuses anything that is not a valid IP', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('assertDeliverableUrl (worker copy)', () => {
  it('rejects http, non-https literal-private, localhost and ftp when allowLocal is false', async () => {
    for (const url of [
      'http://example.com/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.1/hook',
      'https://localhost/hook',
      'https://svc.internal/hook',
      'ftp://example.com/hook',
    ]) {
      await expect(assertDeliverableUrl(url, false)).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it('allows an https public IP literal when allowLocal is false', async () => {
    await expect(assertDeliverableUrl('https://8.8.8.8/hook', false)).resolves.toBeUndefined();
  });

  it('relaxes http/loopback but never non-http(s) when allowLocal is true', async () => {
    await expect(assertDeliverableUrl('http://127.0.0.1:9099/hook', true)).resolves.toBeUndefined();
    await expect(assertDeliverableUrl('ftp://example.com/hook', true)).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });
});
