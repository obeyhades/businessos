import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import { isoDateTimeSchema } from './calendar.js';

/** A normalized (trimmed, lower-cased) email address. */
export const emailAddressSchema = z
  .string()
  .trim()
  .max(320)
  .email()
  .transform((s) => s.toLowerCase());

// ---------------------------------------------------------------------------
// Accounts (mailboxes)
// ---------------------------------------------------------------------------

export const emailAccountTypeSchema = z.enum(['SHARED', 'PERSONAL']);
export type EmailAccountType = z.infer<typeof emailAccountTypeSchema>;

export const emailAccountDtoSchema = z.object({
  id: uuidSchema,
  address: z.string(),
  displayName: z.string().nullable(),
  type: emailAccountTypeSchema,
  ownerId: uuidSchema.nullable(),
  provider: z.string(),
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type EmailAccountDto = z.infer<typeof emailAccountDtoSchema>;

export const createEmailAccountBodySchema = z.object({
  address: emailAddressSchema,
  displayName: z.string().trim().max(200).optional(),
  type: emailAccountTypeSchema.default('SHARED'),
});
export type CreateEmailAccountBody = z.infer<typeof createEmailAccountBodySchema>;

export const updateEmailAccountBodySchema = z
  .object({
    displayName: z.string().trim().max(200).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateEmailAccountBody = z.infer<typeof updateEmailAccountBodySchema>;

export const emailAccountIdParamsSchema = z.object({ accountId: uuidSchema });
export type EmailAccountIdParams = z.infer<typeof emailAccountIdParamsSchema>;

// ---------------------------------------------------------------------------
// Messages, threads, labels
// ---------------------------------------------------------------------------

export const emailDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export type EmailDirection = z.infer<typeof emailDirectionSchema>;

export const emailMessageStatusSchema = z.enum(['DRAFT', 'QUEUED', 'SENT', 'FAILED', 'RECEIVED']);
export type EmailMessageStatus = z.infer<typeof emailMessageStatusSchema>;

/** Physical folder of a thread. SENT/DRAFTS are query-only views. */
export const emailFolderSchema = z.enum(['INBOX', 'ARCHIVE', 'TRASH']);
export type EmailFolder = z.infer<typeof emailFolderSchema>;
export const folderViewSchema = z.enum(['INBOX', 'SENT', 'DRAFTS', 'ARCHIVE', 'TRASH']);
export type FolderView = z.infer<typeof folderViewSchema>;

export const emailAttachmentDtoSchema = z.object({
  id: uuidSchema,
  fileName: z.string(),
  contentType: z.string(),
  size: z.number().int(),
});
export type EmailAttachmentDto = z.infer<typeof emailAttachmentDtoSchema>;

export const emailLabelDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
});
export type EmailLabelDto = z.infer<typeof emailLabelDtoSchema>;

export const emailMessageDtoSchema = z.object({
  id: uuidSchema,
  threadId: uuidSchema,
  direction: emailDirectionSchema,
  status: emailMessageStatusSchema,
  fromAddress: z.string(),
  fromName: z.string().nullable(),
  toAddresses: z.array(z.string()),
  ccAddresses: z.array(z.string()),
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().nullable(),
  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  isRead: z.boolean(),
  sentAt: timestampSchema.nullable(),
  receivedAt: timestampSchema.nullable(),
  error: z.string().nullable(),
  attachments: z.array(emailAttachmentDtoSchema),
  createdAt: timestampSchema,
});
export type EmailMessageDto = z.infer<typeof emailMessageDtoSchema>;

export const emailThreadDtoSchema = z.object({
  id: uuidSchema,
  accountId: uuidSchema,
  subject: z.string(),
  snippet: z.string().nullable(),
  folder: emailFolderSchema,
  isStarred: z.boolean(),
  unread: z.boolean(),
  messageCount: z.number().int(),
  lastMessageAt: timestampSchema,
  customerId: uuidSchema.nullable(),
  projectId: uuidSchema.nullable(),
  taskId: uuidSchema.nullable(),
  labels: z.array(emailLabelDtoSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type EmailThreadDto = z.infer<typeof emailThreadDtoSchema>;

export const emailThreadDetailDtoSchema = emailThreadDtoSchema.extend({
  messages: z.array(emailMessageDtoSchema),
});
export type EmailThreadDetailDto = z.infer<typeof emailThreadDetailDtoSchema>;

export const threadListQuerySchema = z.object({
  accountId: uuidSchema.optional(),
  folder: folderViewSchema.optional(),
  labelId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  unread: z.enum(['true', 'false']).optional(),
  starred: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;

export const threadIdParamsSchema = z.object({ threadId: uuidSchema });
export type ThreadIdParams = z.infer<typeof threadIdParamsSchema>;
export const messageIdParamsSchema = z.object({ messageId: uuidSchema });
export type MessageIdParams = z.infer<typeof messageIdParamsSchema>;

// --- Compose / reply / send -------------------------------------------------

export const createMessageBodySchema = z.object({
  accountId: uuidSchema,
  /** When set, the draft is a reply appended to this existing thread. */
  threadId: uuidSchema.optional(),
  to: z.array(emailAddressSchema).min(1).max(50),
  cc: z.array(emailAddressSchema).max(50).default([]),
  subject: z.string().trim().min(1).max(500),
  bodyText: z.string().max(500_000),
  bodyHtml: z.string().max(1_000_000).optional(),
});
export type CreateMessageBody = z.infer<typeof createMessageBodySchema>;

export const updateMessageBodySchema = z
  .object({
    to: z.array(emailAddressSchema).min(1).max(50).optional(),
    cc: z.array(emailAddressSchema).max(50).optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    bodyText: z.string().max(500_000).optional(),
    bodyHtml: z.string().max(1_000_000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateMessageBody = z.infer<typeof updateMessageBodySchema>;

// --- Thread operations ------------------------------------------------------

export const moveThreadBodySchema = z.object({ folder: emailFolderSchema });
export type MoveThreadBody = z.infer<typeof moveThreadBodySchema>;

export const starThreadBodySchema = z.object({ starred: z.boolean() });
export type StarThreadBody = z.infer<typeof starThreadBodySchema>;

export const readThreadBodySchema = z.object({ read: z.boolean() });
export type ReadThreadBody = z.infer<typeof readThreadBodySchema>;

export const linkThreadBodySchema = z
  .object({
    customerId: uuidSchema.nullable().optional(),
    projectId: uuidSchema.nullable().optional(),
    taskId: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to link' });
export type LinkThreadBody = z.infer<typeof linkThreadBodySchema>;

export const emailToTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  assigneeId: uuidSchema.nullable().optional(),
  dueDate: isoDateTimeSchema.nullable().optional(),
});
export type EmailToTaskBody = z.infer<typeof emailToTaskBodySchema>;

// --- Labels -----------------------------------------------------------------

export const createEmailLabelBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color')
    .default('#64748b'),
});
export type CreateEmailLabelBody = z.infer<typeof createEmailLabelBodySchema>;

export const labelIdParamsSchema = z.object({ labelId: uuidSchema });
export type LabelIdParams = z.infer<typeof labelIdParamsSchema>;
export const threadLabelParamsSchema = z.object({ threadId: uuidSchema, labelId: uuidSchema });
export type ThreadLabelParams = z.infer<typeof threadLabelParamsSchema>;
export const addLabelBodySchema = z.object({ labelId: uuidSchema });
export type AddLabelBody = z.infer<typeof addLabelBodySchema>;

// --- Inbound ingestion (provider webhook seam) ------------------------------

export const inboundEmailBodySchema = z.object({
  /** The mailbox address this was delivered to (routes to the EmailAccount). */
  to: emailAddressSchema,
  from: emailAddressSchema,
  fromName: z.string().trim().max(200).optional(),
  cc: z.array(emailAddressSchema).max(50).default([]),
  subject: z.string().max(998).default('(no subject)'),
  text: z.string().max(1_000_000).default(''),
  html: z.string().max(2_000_000).optional(),
  /** RFC 5322 Message-ID — the idempotency key. */
  messageId: z.string().max(998).optional(),
  inReplyTo: z.string().max(998).optional(),
  references: z.array(z.string().max(998)).max(100).default([]),
  receivedAt: isoDateTimeSchema.optional(),
});
export type InboundEmailBody = z.infer<typeof inboundEmailBodySchema>;

export const inboundResultDtoSchema = z.object({
  status: z.enum(['created', 'duplicate', 'unknown_account']),
  threadId: uuidSchema.nullable(),
  messageId: uuidSchema.nullable(),
});
export type InboundResultDto = z.infer<typeof inboundResultDtoSchema>;
