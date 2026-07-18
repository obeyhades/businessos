import { z } from 'zod';
import { domainEventTypes } from '../events.js';
import { timestampSchema, uuidSchema } from './common.js';

/**
 * Webhook signing scheme (Stripe-style). The worker computes
 *   sig = HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
 * and sends header `x-businessos-signature: t=<unixSeconds>,v1=<hexSig>`.
 * Receivers recompute over the RAW request body and compare in constant time,
 * rejecting timestamps outside a tolerance window to prevent replay. The
 * algorithm and format live here so the worker, tests and docs never drift.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-businessos-signature';
export const WEBHOOK_EVENT_HEADER = 'x-businessos-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-businessos-delivery';
export const WEBHOOK_ENDPOINT_HEADER = 'x-businessos-webhook-id';
export const WEBHOOK_SIGNATURE_VERSION = 'v1';
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
/** Requests time out after this; keeps a slow endpoint from stalling the worker. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_ATTEMPTS = 6;

/** Internal command events are never delivered to external endpoints. */
const WEBHOOK_EXCLUDED_EVENTS = new Set<string>(['email.send']);
export const webhookableEventTypes = domainEventTypes.filter(
  (t) => !WEBHOOK_EXCLUDED_EVENTS.has(t),
);

/** A subscription entry: a specific domain event, or '*' for every event. */
export const webhookEventSubscriptionSchema = z.union([
  z.literal('*'),
  z.enum(webhookableEventTypes as [string, ...string[]]),
]);
export type WebhookEventSubscription = z.infer<typeof webhookEventSubscriptionSchema>;

const eventTypesSchema = z
  .array(webhookEventSubscriptionSchema)
  .min(1, 'Subscribe to at least one event type')
  .max(webhookableEventTypes.length + 1)
  .transform((arr) => [...new Set(arr)]);

/**
 * Webhook target URL shape check. The https requirement and the SSRF
 * private-address block are enforced server-side by assertDeliverableUrl at
 * create/ping/delivery time (env-aware: loopback is allowed only in local dev),
 * so this stays a plain http(s) URL shape check.
 */
export const webhookUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => u.startsWith('https://') || u.startsWith('http://'), {
    message: 'Webhook URL must be http(s)',
  });

export const webhookEndpointDtoSchema = z.object({
  id: uuidSchema,
  url: z.string(),
  description: z.string().nullable(),
  eventTypes: z.array(z.string()),
  enabled: z.boolean(),
  /** Last 4 chars of the secret, for recognition — never the whole secret. */
  secretHint: z.string(),
  createdById: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type WebhookEndpointDto = z.infer<typeof webhookEndpointDtoSchema>;

/** Returned exactly once (create + rotate): carries the raw signing secret. */
export const webhookEndpointWithSecretDtoSchema = webhookEndpointDtoSchema.extend({
  secret: z.string(),
});
export type WebhookEndpointWithSecretDto = z.infer<typeof webhookEndpointWithSecretDtoSchema>;

export const createWebhookEndpointBodySchema = z.object({
  url: webhookUrlSchema,
  description: z.string().trim().max(300).optional(),
  eventTypes: eventTypesSchema,
  enabled: z.boolean().default(true),
});
export type CreateWebhookEndpointBody = z.infer<typeof createWebhookEndpointBodySchema>;

export const updateWebhookEndpointBodySchema = z
  .object({
    url: webhookUrlSchema.optional(),
    description: z.string().trim().max(300).nullable().optional(),
    eventTypes: eventTypesSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateWebhookEndpointBody = z.infer<typeof updateWebhookEndpointBodySchema>;

export const webhookDeliveryStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type WebhookDeliveryStatusDto = z.infer<typeof webhookDeliveryStatusSchema>;

export const webhookDeliveryDtoSchema = z.object({
  id: uuidSchema,
  endpointId: uuidSchema,
  eventId: uuidSchema,
  eventType: z.string(),
  status: webhookDeliveryStatusSchema,
  attempts: z.number().int(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  nextAttemptAt: timestampSchema.nullable(),
  deliveredAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type WebhookDeliveryDto = z.infer<typeof webhookDeliveryDtoSchema>;

export const webhookEndpointIdParamsSchema = z.object({ endpointId: uuidSchema });
export type WebhookEndpointIdParams = z.infer<typeof webhookEndpointIdParamsSchema>;

export const webhookDeliveryListQuerySchema = z.object({
  status: webhookDeliveryStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type WebhookDeliveryListQuery = z.infer<typeof webhookDeliveryListQuerySchema>;

/** Result of a synchronous /ping test delivery. */
export const webhookPingResultSchema = z.object({
  delivered: z.boolean(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type WebhookPingResult = z.infer<typeof webhookPingResultSchema>;
