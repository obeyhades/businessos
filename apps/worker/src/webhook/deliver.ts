import type { PrismaClient, WebhookDelivery, WebhookEndpoint } from '@businessos/db';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_ENDPOINT_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMEOUT_MS,
} from '@businessos/types';
import { signWebhook } from '../lib/webhook-sign.js';
import { UnsafeUrlError, assertDeliverableUrl } from '../lib/url-safety.js';

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 60 * 60 * 1000;

interface SendResult {
  delivered: boolean;
  responseStatus?: number;
  error?: string;
}

/** Signs and POSTs one payload to a URL, re-checking SSRF at send time. */
export async function sendWebhookRequest(
  url: string,
  secret: string,
  eventType: string,
  deliveryId: string,
  endpointId: string,
  payload: unknown,
  allowLocal: boolean,
): Promise<SendResult> {
  try {
    await assertDeliverableUrl(url, allowLocal);
  } catch (err) {
    return { delivered: false, error: err instanceof UnsafeUrlError ? err.message : 'unsafe_url' };
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signWebhook(secret, body, timestamp),
        [WEBHOOK_EVENT_HEADER]: eventType,
        [WEBHOOK_DELIVERY_HEADER]: deliveryId,
        [WEBHOOK_ENDPOINT_HEADER]: endpointId,
      },
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
    if (res.status >= 200 && res.status < 300) {
      return { delivered: true, responseStatus: res.status };
    }
    return { delivered: false, responseStatus: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message.slice(0, 500) : 'request_failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attempts a single delivery and records the outcome on the row. On a retriable
 * failure the row stays PENDING with an exponential-backoff nextAttemptAt (the
 * retry sweep picks it up); once WEBHOOK_MAX_ATTEMPTS is reached it becomes
 * FAILED (terminal, redeliverable by hand).
 */
export async function attemptDelivery(
  prisma: PrismaClient,
  endpoint: Pick<WebhookEndpoint, 'id' | 'url' | 'secret'>,
  delivery: Pick<WebhookDelivery, 'id' | 'eventType' | 'payload' | 'attempts'>,
  allowLocal: boolean,
): Promise<'succeeded' | 'retry' | 'failed'> {
  const result = await sendWebhookRequest(
    endpoint.url,
    endpoint.secret,
    delivery.eventType,
    delivery.id,
    endpoint.id,
    delivery.payload,
    allowLocal,
  );
  const attempts = delivery.attempts + 1;

  if (result.delivered) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'SUCCEEDED',
        attempts,
        responseStatus: result.responseStatus ?? null,
        error: null,
        deliveredAt: new Date(),
        nextAttemptAt: null,
      },
    });
    return 'succeeded';
  }

  const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
  const backoff = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: exhausted ? 'FAILED' : 'PENDING',
      attempts,
      responseStatus: result.responseStatus ?? null,
      error: result.error ?? 'delivery_failed',
      nextAttemptAt: exhausted ? null : new Date(Date.now() + backoff),
    },
  });
  return exhausted ? 'failed' : 'retry';
}
