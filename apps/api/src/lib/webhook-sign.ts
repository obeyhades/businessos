import { createHmac } from 'node:crypto';
import { WEBHOOK_SIGNATURE_VERSION } from '@businessos/types';

/**
 * Computes the webhook signature header value:
 *   t=<unixSeconds>,v1=<hex HMAC_SHA256(secret, `${t}.${body}`)>
 * Receivers recompute over the RAW body and compare in constant time. Mirrored
 * byte-for-byte in apps/worker/src/lib/webhook-sign.ts — keep in sync.
 */
export function signWebhook(secret: string, body: string, timestampSeconds: number): string {
  const signed = `${timestampSeconds}.${body}`;
  const digest = createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${timestampSeconds},${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}
