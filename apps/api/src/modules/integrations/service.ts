import { randomBytes } from 'node:crypto';
import type { WebhookDelivery, WebhookEndpoint } from '@businessos/db';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_ENDPOINT_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMEOUT_MS,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookEndpointWithSecretDto,
} from '@businessos/types';
import { signWebhook } from '../../lib/webhook-sign.js';
import { UnsafeUrlError, safeRequest } from '../../lib/url-safety.js';

/** A high-entropy signing secret shown to the user once. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** Never expose the whole secret after creation — just enough to recognize it. */
function secretHint(secret: string): string {
  return `…${secret.slice(-4)}`;
}

export function toWebhookEndpointDto(endpoint: WebhookEndpoint): WebhookEndpointDto {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    eventTypes: endpoint.eventTypes,
    enabled: endpoint.enabled,
    secretHint: secretHint(endpoint.secret),
    createdById: endpoint.createdById,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

export function toWebhookEndpointWithSecretDto(
  endpoint: WebhookEndpoint,
): WebhookEndpointWithSecretDto {
  return { ...toWebhookEndpointDto(endpoint), secret: endpoint.secret };
}

export function toWebhookDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryDto {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    responseStatus: delivery.responseStatus,
    error: delivery.error,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

export interface WebhookSendResult {
  delivered: boolean;
  responseStatus?: number;
  error?: string;
}

/**
 * Signs and POSTs one payload to an endpoint, re-checking the URL for SSRF at
 * send time (DNS may have changed since creation). Returns a result rather than
 * throwing on HTTP failure — used by the synchronous /ping route.
 */
export async function sendWebhook(
  url: string,
  secret: string,
  eventType: string,
  deliveryId: string,
  endpointId: string,
  payload: unknown,
  allowLocal: boolean,
): Promise<WebhookSendResult> {
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
    // 2xx is success; everything else (incl. 3xx redirects we won't follow) fails.
    if (res.status >= 200 && res.status < 300) {
      return { delivered: true, responseStatus: res.status };
    }
    return { delivered: false, responseStatus: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { delivered: false, error: err.message };
    return { delivered: false, error: err instanceof Error ? err.message.slice(0, 500) : 'request_failed' };
  }
}
