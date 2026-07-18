import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_SIGNATURE_VERSION } from '@businessos/types';
import { signWebhook } from './webhook-sign.js';
// The worker keeps a byte-for-byte copy (API signs, worker delivers). Import it
// here to prove the two never drift — a signature the worker computes must be
// the one the API's docs/tests describe.
import { signWebhook as signWebhookWorker } from '../../../worker/src/lib/webhook-sign.js';

/** Independent reference implementation of the documented scheme. */
function referenceSignature(secret: string, body: string, ts: number): string {
  const digest = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

const SECRET = 'whsec_test_0123456789abcdef';
const BODY = JSON.stringify({ id: 'evt_1', type: 'task.completed', payload: { a: 1 } });
const TS = 1_770_000_000;

describe('signWebhook', () => {
  it('matches an independently computed HMAC-SHA256 over `${t}.${body}`', () => {
    expect(signWebhook(SECRET, BODY, TS)).toBe(referenceSignature(SECRET, BODY, TS));
  });

  it('emits the documented `t=<unixSeconds>,v1=<hex>` header shape', () => {
    const sig = signWebhook(SECRET, BODY, TS);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(sig.startsWith(`t=${TS},`)).toBe(true);
  });

  it('is deterministic — identical inputs yield an identical signature', () => {
    expect(signWebhook(SECRET, BODY, TS)).toBe(signWebhook(SECRET, BODY, TS));
  });

  it('changes when the body, the timestamp, or the secret changes', () => {
    const base = signWebhook(SECRET, BODY, TS);
    expect(signWebhook(SECRET, `${BODY} `, TS)).not.toBe(base);
    expect(signWebhook(SECRET, BODY, TS + 1)).not.toBe(base);
    expect(signWebhook(`${SECRET}x`, BODY, TS)).not.toBe(base);
  });

  it('binds the timestamp into the digest (t is not merely a prefix)', () => {
    // Same digest hex must not appear under two different timestamps.
    const a = signWebhook(SECRET, BODY, TS).split('v1=')[1];
    const b = signWebhook(SECRET, BODY, TS + 60).split('v1=')[1];
    expect(a).not.toBe(b);
  });
});

describe('api and worker copies of signWebhook', () => {
  it('produce identical output for the same input (kept in sync byte-for-byte)', () => {
    const cases: Array<[string, string, number]> = [
      [SECRET, BODY, TS],
      ['whsec_another', '', 0],
      ['whsec_x', '{"nested":{"deep":true}}', 1_700_000_123],
      ['whsec_unicode', '{"msg":"hallå världen 🌍"}', 1_699_999_999],
    ];
    for (const [secret, body, ts] of cases) {
      expect(signWebhookWorker(secret, body, ts)).toBe(signWebhook(secret, body, ts));
    }
  });
});
