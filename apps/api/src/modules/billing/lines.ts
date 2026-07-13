import { Prisma } from '@businessos/db';
import type { LineItemInput } from '@businessos/types';
import { computeDocument, type DocumentTotals, type LineInput } from '../../lib/money.js';

export interface BuiltLine {
  organizationId: string;
  productId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPriceMinor: bigint;
  discountPercent: Prisma.Decimal;
  taxRatePercent: Prisma.Decimal;
  lineNetMinor: bigint;
  lineTaxMinor: bigint;
  lineTotalMinor: bigint;
  sortOrder: number;
}

export interface BuiltDocument {
  lines: BuiltLine[];
  totals: DocumentTotals;
  header: {
    subtotalMinor: bigint;
    discountMinor: bigint;
    taxMinor: bigint;
    totalMinor: bigint;
    taxLines: Prisma.InputJsonValue;
  };
}

function toMoneyInput(input: LineItemInput): LineInput {
  return {
    quantity: input.quantity,
    unitPriceMinor: input.unitPriceMinor,
    discountPercent: input.discountPercent,
    taxRatePercent: input.taxRatePercent,
  };
}

/**
 * Computes deterministic money for a set of line inputs and produces the DB
 * rows plus header totals. The computed per-line amounts are stored so a
 * finalized document's figures never change, even if the compute logic evolves.
 */
export function buildDocument(organizationId: string, inputs: LineItemInput[]): BuiltDocument {
  const { lines, totals } = computeDocument(inputs.map(toMoneyInput));
  const built: BuiltLine[] = inputs.map((input, i) => {
    const computed = lines[i]!;
    return {
      organizationId,
      productId: input.productId ?? null,
      description: input.description,
      quantity: new Prisma.Decimal(input.quantity),
      unitPriceMinor: BigInt(input.unitPriceMinor),
      discountPercent: new Prisma.Decimal(input.discountPercent),
      taxRatePercent: new Prisma.Decimal(input.taxRatePercent),
      lineNetMinor: BigInt(computed.lineNetMinor),
      lineTaxMinor: BigInt(computed.lineTaxMinor),
      lineTotalMinor: BigInt(computed.lineTotalMinor),
      sortOrder: i,
    };
  });
  return {
    lines: built,
    totals,
    header: {
      subtotalMinor: BigInt(totals.subtotalMinor),
      discountMinor: BigInt(totals.discountMinor),
      taxMinor: BigInt(totals.taxMinor),
      totalMinor: BigInt(totals.totalMinor),
      taxLines: totals.taxLines as unknown as Prisma.InputJsonValue,
    },
  };
}
