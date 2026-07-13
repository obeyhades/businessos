import { Decimal } from 'decimal.js';

/**
 * Deterministic monetary calculations for quotes, invoices and credit notes.
 *
 * All amounts are INTEGER MINOR UNITS (e.g. öre / cents) — never floating
 * point. Intermediate math uses decimal.js and rounds HALF-UP to whole minor
 * units at the LINE level; document totals are exact sums of the rounded line
 * amounts, so totals never drift from what a customer sees per line.
 */

const ROUND = Decimal.ROUND_HALF_UP;

function roundMinor(value: Decimal): number {
  return value.toDecimalPlaces(0, ROUND).toNumber();
}

export interface LineInput {
  /** Decimal string or number, e.g. "2.5" hours. */
  quantity: string | number;
  /** Unit price in integer minor units. */
  unitPriceMinor: number;
  /** 0–100. */
  discountPercent: string | number;
  /** 0–100. */
  taxRatePercent: string | number;
}

export interface ComputedLine {
  lineNetMinor: number;
  lineTaxMinor: number;
  lineTotalMinor: number;
  lineDiscountMinor: number;
}

export function computeLine(input: LineInput): ComputedLine {
  const quantity = new Decimal(input.quantity);
  const unitPrice = new Decimal(input.unitPriceMinor);
  const discountPercent = new Decimal(input.discountPercent);
  const taxRatePercent = new Decimal(input.taxRatePercent);

  const grossMinor = roundMinor(quantity.times(unitPrice));
  const lineDiscountMinor = roundMinor(
    new Decimal(grossMinor).times(discountPercent).dividedBy(100),
  );
  const lineNetMinor = grossMinor - lineDiscountMinor;
  const lineTaxMinor = roundMinor(new Decimal(lineNetMinor).times(taxRatePercent).dividedBy(100));
  const lineTotalMinor = lineNetMinor + lineTaxMinor;

  return { lineNetMinor, lineTaxMinor, lineTotalMinor, lineDiscountMinor };
}

export interface TaxLine {
  ratePercent: string;
  baseMinor: number;
  taxMinor: number;
}

export interface DocumentTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxLines: TaxLine[];
}

export interface ComputedLineWithRate extends ComputedLine {
  taxRatePercent: string | number;
}

/**
 * Sums pre-computed lines into document totals plus a per-rate VAT breakdown.
 * subtotal = net (post-discount, pre-tax); total = subtotal + tax.
 */
export function computeTotals(lines: ComputedLineWithRate[]): DocumentTotals {
  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;
  const byRate = new Map<string, { baseMinor: number; taxMinor: number }>();

  for (const line of lines) {
    subtotalMinor += line.lineNetMinor;
    discountMinor += line.lineDiscountMinor;
    taxMinor += line.lineTaxMinor;
    const rate = new Decimal(line.taxRatePercent).toFixed(2);
    const bucket = byRate.get(rate) ?? { baseMinor: 0, taxMinor: 0 };
    bucket.baseMinor += line.lineNetMinor;
    bucket.taxMinor += line.lineTaxMinor;
    byRate.set(rate, bucket);
  }

  const taxLines: TaxLine[] = [...byRate.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([ratePercent, v]) => ({ ratePercent, baseMinor: v.baseMinor, taxMinor: v.taxMinor }));

  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
    taxLines,
  };
}

/** Convenience: compute every line and the document totals in one pass. */
export function computeDocument(inputs: LineInput[]): {
  lines: ComputedLine[];
  totals: DocumentTotals;
} {
  const lines = inputs.map(computeLine);
  const withRate: ComputedLineWithRate[] = lines.map((line, i) => ({
    ...line,
    taxRatePercent: inputs[i]!.taxRatePercent,
  }));
  return { lines, totals: computeTotals(withRate) };
}
