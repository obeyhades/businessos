import type {
  Account,
  AccountMapping,
  FiscalPeriod,
  FiscalYear,
  Voucher,
  VoucherLine,
} from '@businessos/db';
import type {
  AccountDto,
  AccountMappingDto,
  FiscalPeriodDto,
  FiscalYearDto,
  VoucherDto,
  VoucherLineDto,
} from '@businessos/types';

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const n = (value: bigint): number => Number(value);

export function toAccountDto(a: Account): AccountDto {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    description: a.description,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toFiscalPeriodDto(p: FiscalPeriod): FiscalPeriodDto {
  return {
    id: p.id,
    fiscalYearId: p.fiscalYearId,
    name: p.name,
    startDate: isoDate(p.startDate),
    endDate: isoDate(p.endDate),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toFiscalYearDto(y: FiscalYear & { periods: FiscalPeriod[] }): FiscalYearDto {
  return {
    id: y.id,
    name: y.name,
    startDate: isoDate(y.startDate),
    endDate: isoDate(y.endDate),
    status: y.status,
    periods: y.periods.map(toFiscalPeriodDto),
    createdAt: y.createdAt.toISOString(),
    updatedAt: y.updatedAt.toISOString(),
  };
}

type VoucherLineWithAccount = VoucherLine & { account: { code: string; name: string } };
export type VoucherWithRelations = Voucher & {
  lines: VoucherLineWithAccount[];
  reversedBy: { id: string } | null;
};

export function toVoucherLineDto(l: VoucherLineWithAccount): VoucherLineDto {
  return {
    id: l.id,
    accountId: l.accountId,
    accountCode: l.account.code,
    accountName: l.account.name,
    description: l.description,
    debitMinor: n(l.debitMinor),
    creditMinor: n(l.creditMinor),
    sortOrder: l.sortOrder,
  };
}

export function toVoucherDto(v: VoucherWithRelations): VoucherDto {
  const totalDebitMinor = n(v.totalDebitMinor);
  const totalCreditMinor = n(v.totalCreditMinor);
  return {
    id: v.id,
    number: v.number,
    date: isoDate(v.date),
    description: v.description,
    status: v.status,
    source: v.source,
    sourceType: v.sourceType,
    sourceId: v.sourceId,
    fiscalPeriodId: v.fiscalPeriodId,
    totalDebitMinor,
    totalCreditMinor,
    isBalanced: totalDebitMinor === totalCreditMinor && totalDebitMinor > 0,
    reversesVoucherId: v.reversesVoucherId,
    reversedByVoucherId: v.reversedBy?.id ?? null,
    reconciledAt: v.reconciledAt?.toISOString() ?? null,
    postedAt: v.postedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    lines: v.lines.map(toVoucherLineDto),
  };
}

export function toAccountMappingDto(m: AccountMapping | null): AccountMappingDto {
  return {
    salesAccountId: m?.salesAccountId ?? null,
    outputVatAccountId: m?.outputVatAccountId ?? null,
    receivableAccountId: m?.receivableAccountId ?? null,
    bankAccountId: m?.bankAccountId ?? null,
    updatedAt: m?.updatedAt.toISOString() ?? null,
  };
}
