import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_SIGNATURE_VERSION } from '@businessos/types';
import { signWebhook } from './webhook-sign.js';

/**
 * The worker computes the signature that endpoints verify, so its copy of the
 * scheme must match the documented formula exactly. (The API package's test
 * additionally asserts this copy is identical to the API's own copy.)
 */
function referenceSignature(secret: string, body: string, ts: number): string {
  const digest = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

const SECRET = 'whsec_worker_0123456789abcdef';
const BODY = JSON.stringify({ id: 'evt_1', type: 'invoice.finalized', payload: { total: 12500 } });
const TS = 1_770_000_000;

describe('signWebhook (worker copy)', () => {
  it('matches an independently computed HMAC-SHA256 over `${t}.${body}`', () => {
    expect(signWebhook(SECRET, BODY, TS)).toBe(referenceSignature(SECRET, BODY, TS));
  });

  it('emits the documented `t=<unixSeconds>,v1=<hex>` header shape', () => {
    expect(signWebhook(SECRET, BODY, TS)).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('is deterministic and sensitive to body, timestamp and secret', () => {
    const base = signWebhook(SECRET, BODY, TS);
    expect(signWebhook(SECRET, BODY, TS)).toBe(base);
    expect(signWebhook(SECRET, `${BODY} `, TS)).not.toBe(base);
    expect(signWebhook(SECRET, BODY, TS + 1)).not.toBe(base);
    expect(signWebhook(`${SECRET}x`, BODY, TS)).not.toBe(base);
  });
});
