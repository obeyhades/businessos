import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import { isoDateSchema, nonNegativeMoneyMinorSchema } from './billing-common.js';

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export const accountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export type AccountType = z.infer<typeof accountTypeSchema>;

/** Account types whose normal (increasing) balance is a debit. */
export const DEBIT_NORMAL_TYPES: AccountType[] = ['ASSET', 'EXPENSE'];

export const accountDtoSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type AccountDto = z.infer<typeof accountDtoSchema>;

export const createAccountBodySchema = z.object({
  // Account number, e.g. "1930". Immutable after creation (it is the identity).
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, 'Only letters, digits, dot, dash, underscore'),
  name: z.string().trim().min(1).max(200),
  type: accountTypeSchema,
  description: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  isActive: z.boolean().default(true),
});
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

export const updateAccountBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    type: accountTypeSchema.optional(),
    description: z
      .string()
      .trim()
      .max(1000)
      .transform((v) => (v.length === 0 ? null : v))
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

export const accountListQuerySchema = z.object({
  type: accountTypeSchema.optional(),
  active: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});
export type AccountListQuery = z.infer<typeof accountListQuerySchema>;

export const accountIdParamsSchema = z.object({ accountId: uuidSchema });
export type AccountIdParams = z.infer<typeof accountIdParamsSchema>;

// ---------------------------------------------------------------------------
// Fiscal years & periods
// ---------------------------------------------------------------------------

export const fiscalPeriodStatusSchema = z.enum(['OPEN', 'LOCKED', 'CLOSED']);
export type FiscalPeriodStatus = z.infer<typeof fiscalPeriodStatusSchema>;

export const fiscalPeriodDtoSchema = z.object({
  id: uuidSchema,
  fiscalYearId: uuidSchema,
  name: z.string(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  status: fiscalPeriodStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type FiscalPeriodDto = z.infer<typeof fiscalPeriodDtoSchema>;

export const fiscalYearDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  status: fiscalPeriodStatusSchema,
  periods: z.array(fiscalPeriodDtoSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type FiscalYearDto = z.infer<typeof fiscalYearDtoSchema>;

export const createFiscalYearBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    /** Auto-generate one OPEN monthly period spanning start→end. */
    generateMonthlyPeriods: z.boolean().default(true),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['endDate'],
  });
export type CreateFiscalYearBody = z.infer<typeof createFiscalYearBodySchema>;

export const createFiscalPeriodBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['endDate'],
  });
export type CreateFiscalPeriodBody = z.infer<typeof createFiscalPeriodBodySchema>;

export const updateFiscalPeriodStatusBodySchema = z.object({
  status: fiscalPeriodStatusSchema,
});
export type UpdateFiscalPeriodStatusBody = z.infer<typeof updateFiscalPeriodStatusBodySchema>;

export const fiscalYearIdParamsSchema = z.object({ fiscalYearId: uuidSchema });
export type FiscalYearIdParams = z.infer<typeof fiscalYearIdParamsSchema>;
export const fiscalPeriodIdParamsSchema = z.object({ periodId: uuidSchema });
export type FiscalPeriodIdParams = z.infer<typeof fiscalPeriodIdParamsSchema>;

// ---------------------------------------------------------------------------
// Vouchers (journal entries)
// ---------------------------------------------------------------------------

export const voucherStatusSchema = z.enum(['DRAFT', 'POSTED', 'REVERSED']);
export type VoucherStatus = z.infer<typeof voucherStatusSchema>;

export const voucherSourceSchema = z.enum(['MANUAL', 'INVOICE', 'PAYMENT', 'OPENING_BALANCE']);
export type VoucherSource = z.infer<typeof voucherSourceSchema>;

export const voucherLineDtoSchema = z.object({
  id: uuidSchema,
  accountId: uuidSchema,
  accountCode: z.string(),
  accountName: z.string(),
  description: z.string().nullable(),
  debitMinor: z.number().int(),
  creditMinor: z.number().int(),
  sortOrder: z.number().int(),
});
export type VoucherLineDto = z.infer<typeof voucherLineDtoSchema>;

/** A line is EITHER a debit or a credit — exactly one side must be positive. */
export const voucherLineInputSchema = z
  .object({
    accountId: uuidSchema,
    description: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v.length === 0 ? null : v))
      .nullable()
      .optional(),
    debitMinor: nonNegativeMoneyMinorSchema.default(0),
    creditMinor: nonNegativeMoneyMinorSchema.default(0),
  })
  .refine((l) => (l.debitMinor > 0) !== (l.creditMinor > 0), {
    message: 'Each line must be either a debit or a credit, not both or neither',
  });
export type VoucherLineInput = z.infer<typeof voucherLineInputSchema>;

export const voucherDtoSchema = z.object({
  id: uuidSchema,
  number: z.string().nullable(),
  date: isoDateSchema,
  description: z.string(),
  status: voucherStatusSchema,
  source: voucherSourceSchema,
  sourceType: z.string().nullable(),
  sourceId: uuidSchema.nullable(),
  fiscalPeriodId: uuidSchema.nullable(),
  totalDebitMinor: z.number().int(),
  totalCreditMinor: z.number().int(),
  isBalanced: z.boolean(),
  reversesVoucherId: uuidSchema.nullable(),
  reversedByVoucherId: uuidSchema.nullable(),
  reconciledAt: timestampSchema.nullable(),
  postedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lines: z.array(voucherLineDtoSchema),
});
export type VoucherDto = z.infer<typeof voucherDtoSchema>;

export const createVoucherBodySchema = z.object({
  date: isoDateSchema,
  description: z.string().trim().min(1).max(500),
  // Double entry always has ≥2 lines. Balance is NOT required here: a draft may
  // be saved unbalanced and corrected before posting.
  lines: z.array(voucherLineInputSchema).min(2),
});
export type CreateVoucherBody = z.infer<typeof createVoucherBodySchema>;

export const updateVoucherBodySchema = z
  .object({
    date: isoDateSchema.optional(),
    description: z.string().trim().min(1).max(500).optional(),
    // When present, replaces all lines wholesale.
    lines: z.array(voucherLineInputSchema).min(2).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateVoucherBody = z.infer<typeof updateVoucherBodySchema>;

export const reverseVoucherBodySchema = z.object({
  /** Date of the reversing voucher; defaults to today server-side. */
  date: isoDateSchema.optional(),
  description: z.string().trim().min(1).max(500).optional(),
});
export type ReverseVoucherBody = z.infer<typeof reverseVoucherBodySchema>;

export const reconcileVoucherBodySchema = z.object({ reconciled: z.boolean() });
export type ReconcileVoucherBody = z.infer<typeof reconcileVoucherBodySchema>;

export const voucherListQuerySchema = z.object({
  status: voucherStatusSchema.optional(),
  source: voucherSourceSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: uuidSchema.optional(),
  reconciled: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type VoucherListQuery = z.infer<typeof voucherListQuerySchema>;

export const voucherIdParamsSchema = z.object({ voucherId: uuidSchema });
export type VoucherIdParams = z.infer<typeof voucherIdParamsSchema>;

// ---------------------------------------------------------------------------
// Voucher attachments (receipts)
// ---------------------------------------------------------------------------

export const voucherAttachmentDtoSchema = z.object({
  id: uuidSchema,
  voucherId: uuidSchema,
  fileName: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  uploadedByName: z.string().nullable(),
  createdAt: timestampSchema,
});
export type VoucherAttachmentDto = z.infer<typeof voucherAttachmentDtoSchema>;

export const voucherAttachmentIdParamsSchema = z.object({
  voucherId: uuidSchema,
  attachmentId: uuidSchema,
});
export type VoucherAttachmentIdParams = z.infer<typeof voucherAttachmentIdParamsSchema>;

// ---------------------------------------------------------------------------
// Account mapping (configurable rules for auto-generated draft vouchers)
// ---------------------------------------------------------------------------

export const accountMappingDtoSchema = z.object({
  salesAccountId: uuidSchema.nullable(),
  outputVatAccountId: uuidSchema.nullable(),
  receivableAccountId: uuidSchema.nullable(),
  bankAccountId: uuidSchema.nullable(),
  updatedAt: timestampSchema.nullable(),
});
export type AccountMappingDto = z.infer<typeof accountMappingDtoSchema>;

export const updateAccountMappingBodySchema = z
  .object({
    salesAccountId: uuidSchema.nullable().optional(),
    outputVatAccountId: uuidSchema.nullable().optional(),
    receivableAccountId: uuidSchema.nullable().optional(),
    bankAccountId: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateAccountMappingBody = z.infer<typeof updateAccountMappingBodySchema>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Include DRAFT vouchers in figures (default false = posted only). */
  includeDrafts: z.enum(['true', 'false']).optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const trialBalanceRowSchema = z.object({
  accountId: uuidSchema,
  code: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  debitMinor: z.number().int(),
  creditMinor: z.number().int(),
  /** Signed net (debit − credit); positive = net debit balance. */
  balanceMinor: z.number().int(),
});
export type TrialBalanceRow = z.infer<typeof trialBalanceRowSchema>;

export const trialBalanceDtoSchema = z.object({
  rows: z.array(trialBalanceRowSchema),
  totalDebitMinor: z.number().int(),
  totalCreditMinor: z.number().int(),
  isBalanced: z.boolean(),
  from: isoDateSchema.nullable(),
  to: isoDateSchema.nullable(),
  includeDrafts: z.boolean(),
});
export type TrialBalanceDto = z.infer<typeof trialBalanceDtoSchema>;

export const generalLedgerQuerySchema = z.object({
  accountId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  includeDrafts: z.enum(['true', 'false']).optional(),
});
export type GeneralLedgerQuery = z.infer<typeof generalLedgerQuerySchema>;

export const generalLedgerEntrySchema = z.object({
  voucherId: uuidSchema,
  voucherNumber: z.string().nullable(),
  date: isoDateSchema,
  description: z.string(),
  debitMinor: z.number().int(),
  creditMinor: z.number().int(),
  /** Running signed balance for the account (debit-positive). */
  runningBalanceMinor: z.number().int(),
});
export type GeneralLedgerEntry = z.infer<typeof generalLedgerEntrySchema>;

export const generalLedgerAccountSchema = z.object({
  accountId: uuidSchema,
  code: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  openingBalanceMinor: z.number().int(),
  closingBalanceMinor: z.number().int(),
  entries: z.array(generalLedgerEntrySchema),
});
export type GeneralLedgerAccount = z.infer<typeof generalLedgerAccountSchema>;

export const generalLedgerDtoSchema = z.object({
  accounts: z.array(generalLedgerAccountSchema),
  from: isoDateSchema.nullable(),
  to: isoDateSchema.nullable(),
  includeDrafts: z.boolean(),
});
export type GeneralLedgerDto = z.infer<typeof generalLedgerDtoSchema>;
