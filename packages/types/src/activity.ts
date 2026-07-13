/**
 * User-facing activity timeline event types (distinct from AUDIT_ACTIONS,
 * which are security-focused). Stable identifiers persisted in the database.
 */
export const ACTIVITY_TYPES = [
  'customer.created',
  'customer.updated',
  'customer.archived',
  'contact.added',
  'project.created',
  'project.updated',
  'project.status_changed',
  'task.created',
  'task.status_changed',
  'task.completed',
  'task.assigned',
  'comment.added',
  'attachment.added',
  // Phase 3
  'employee.created',
  'employee.status_changed',
  'employee.onboarding_started',
  'certification.added',
  'absence.requested',
  'absence.approved',
  'absence.rejected',
  'document.added',
  'note.added',
  // Phase 4
  'quote.created',
  'quote.sent',
  'quote.accepted',
  'quote.declined',
  'quote.converted',
  'invoice.created',
  'invoice.finalized',
  'invoice.sent',
  'invoice.overdue',
  'invoice.cancelled',
  'payment.registered',
  'invoice.credited',
  // Phase 5
  'invoice.accounting_drafted',
  // Phase 6
  'event.scheduled',
  'event.updated',
  'event.cancelled',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];
