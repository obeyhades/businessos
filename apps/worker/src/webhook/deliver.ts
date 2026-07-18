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
import { UnsafeUrlError, safeRequest } from '../lib/url-safety.js';

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
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await safeRequest(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signWebhook(secret, body, timestamp),
          [WEBHOOK_EVENT_HEADER]: eventType,
          [WEBHOOK_DELIVERY_HEADER]: deliveryId,
          [WEBHOOK_ENDPOINT_HEADER]: endpointId,
        },
        body,
        timeoutMs: WEBHOOK_TIMEOUT_MS,
      },
      allowLocal,
    );
    if (res.status >= 200 && res.status < 300) {
      return { delivered: true, responseStatus: res.status };
    }
    return { delivered: false, responseStatus: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { delivered: false, error: err.message };
    return {
      delivered: false,
      error: err instanceof Error ? err.message.slice(0, 500) : 'request_failed',
    };
  }
}

export type DeliveryOutcome = 'succeeded' | 'retry' | 'failed';

/** The result columns for a completed attempt (everything except `attempts`,
 *  which the caller owns so a claim-by-increment isn't double-counted). */
function outcomeData(attempts: number, result: SendResult) {
  if (result.delivered) {
    return {
      data: {
        status: 'SUCCEEDED' as const,
        responseStatus: result.responseStatus ?? null,
        error: null,
        deliveredAt: new Date(),
        nextAttemptAt: null,
      },
      outcome: 'succeeded' as DeliveryOutcome,
    };
  }
  const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
  const backoff = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
  return {
    data: {
      status: (exhausted ? 'FAILED' : 'PENDING') as 'FAILED' | 'PENDING',
      responseStatus: result.responseStatus ?? null,
      error: result.error ?? 'delivery_failed',
      nextAttemptAt: exhausted ? null : new Date(Date.now() + backoff),
    },
    outcome: (exhausted ? 'failed' : 'retry') as DeliveryOutcome,
  };
}

/**
 * First-attempt delivery from the dispatch consumer: the row was just created
 * (attempts 0) and only this consumer touches it, so the attempt count is set
 * absolutely here. Retriable failures back off for the sweep to pick up.
 */
export async function attemptDelivery(
  prisma: PrismaClient,
  endpoint: Pick<WebhookEndpoint, 'id' | 'url' | 'secret'>,
  delivery: Pick<WebhookDelivery, 'id' | 'eventType' | 'payload' | 'attempts'>,
  allowLocal: boolean,
): Promise<DeliveryOutcome> {
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
  const { data, outcome } = outcomeData(attempts, result);
  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { attempts, ...data } });
  return outcome;
}

/**
 * Retry-attempt delivery from the sweep. The sweep has ALREADY claimed the row
 * by atomically incrementing `attempts` (its optimistic lock across worker
 * replicas), so `attemptNumber` is passed in and this only writes the outcome
 * columns — never `attempts` again.
 */
export async function finalizeClaimedDelivery(
  prisma: PrismaClient,
  endpoint: Pick<WebhookEndpoint, 'id' | 'url' | 'secret'>,
  delivery: Pick<WebhookDelivery, 'id' | 'eventType' | 'payload'>,
  attemptNumber: number,
  allowLocal: boolean,
): Promise<DeliveryOutcome> {
  const result = await sendWebhookRequest(
    endpoint.url,
    endpoint.secret,
    delivery.eventType,
    delivery.id,
    endpoint.id,
    delivery.payload,
    allowLocal,
  );
  const { data, outcome } = outcomeData(attemptNumber, result);
  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data });
  return outcome;
}
