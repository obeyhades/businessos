import { z } from 'zod';

/**
 * Messages that flow through the outbox → RabbitMQ. Two kinds share one
 * envelope: domain events (facts, past tense) and commands (work requests,
 * e.g. email.send). The `type` doubles as the AMQP routing key on the
 * `businessos.events` topic exchange.
 */
export const EXCHANGE_NAME = 'businessos.events';
export const DLX_NAME = 'businessos.dlx';
export const EMAIL_QUEUE = 'email.send';
export const EMAIL_RETRY_QUEUE = 'email.send.retry';
export const DEAD_LETTER_QUEUE = 'businessos.dead-letter';
/** Phase 5: draft-voucher generation from invoice/payment domain events. */
export const ACCOUNTING_QUEUE = 'accounting.draft';

export const MAX_JOB_ATTEMPTS = 5;
/** Base delay for retry backoff in ms; actual delay = base * 2^(attempt-1). */
export const RETRY_BASE_DELAY_MS = 5_000;

/** Optional attachment fetched from object storage by the email worker. */
export const emailAttachmentSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

export const emailSendPayloadSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  /** Plain-text body. HTML email is a later enhancement. */
  text: z.string().min(1),
  /** For correlation in logs/audit without logging the body. */
  kind: z.enum(['invitation', 'password_reset', 'invoice', 'invoice_reminder', 'event_reminder']),
  organizationId: z.string().uuid().nullable(),
  attachment: emailAttachmentSchema.optional(),
});
export type EmailSendPayload = z.infer<typeof emailSendPayloadSchema>;

export const domainEventTypes = [
  'user.registered',
  'organization.created',
  'member.invited',
  'member.invitation_accepted',
  'email.send',
  // Phase 2
  'customer.created',
  'task.completed',
  // Phase 4
  'quote.accepted',
  'invoice.finalized',
  'invoice.sent',
  'invoice.overdue',
  'payment.registered',
  // Phase 5 — emitted for future accounting-system integrations (no internal
  // consumer binds these yet, mirroring how invoice.finalized began).
  'voucher.posted',
  'voucher.reversed',
  // Phase 6 — calendar integration seam (no internal consumer yet).
  'calendar.event.created',
  'calendar.event.updated',
  'calendar.event.cancelled',
] as const;
export type DomainEventType = (typeof domainEventTypes)[number];

export const outboxEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(domainEventTypes),
  payload: z.unknown(),
  occurredAt: z.string().datetime(),
});
export type OutboxEnvelope = z.infer<typeof outboxEnvelopeSchema>;
