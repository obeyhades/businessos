import { describe, expect, it } from 'vitest';
import { computeDocument, computeLine } from './money.js';

describe('computeLine (integer minor units, HALF_UP)', () => {
  it('computes a whole-quantity line', () => {
    expect(
      computeLine({ quantity: 1, unitPriceMinor: 10000, discountPercent: 0, taxRatePercent: 25 }),
    ).toEqual({
      lineNetMinor: 10000,
      lineTaxMinor: 2500,
      lineTotalMinor: 12500,
      lineDiscountMinor: 0,
    });
  });

  it('applies a fractional quantity and a discount deterministically', () => {
    // 2.5 × 100.00 = 250.00; −10% = 225.00 net; +25% VAT = 56.25; total 281.25.
    expect(
      computeLine({
        quantity: 2.5,
        unitPriceMinor: 10000,
        discountPercent: 10,
        taxRatePercent: 25,
      }),
    ).toEqual({
      lineNetMinor: 22500,
      lineTaxMinor: 5625,
      lineTotalMinor: 28125,
      lineDiscountMinor: 2500,
    });
  });

  it('rounds tax half-up to the nearest minor unit', () => {
    // gross 3 × 333 = 999; VAT 25% = 249.75 → 250.
    const line = computeLine({
      quantity: 3,
      unitPriceMinor: 333,
      discountPercent: 0,
      taxRatePercent: 25,
    });
    expect(line.lineNetMinor).toBe(999);
    expect(line.lineTaxMinor).toBe(250);
    expect(line.lineTotalMinor).toBe(1249);
  });
});

describe('computeDocument totals + VAT breakdown', () => {
  it('sums rounded lines and groups tax by rate', () => {
    const { totals } = computeDocument([
      { quantity: 2, unitPriceMinor: 10000, discountPercent: 0, taxRatePercent: 25 },
      { quantity: 1, unitPriceMinor: 5000, discountPercent: 0, taxRatePercent: 12 },
    ]);
    // line1: net 20000, tax 5000 | line2: net 5000, tax 600
    expect(totals.subtotalMinor).toBe(25000);
    expect(totals.taxMinor).toBe(5600);
    expect(totals.totalMinor).toBe(30600);
    expect(totals.taxLines).toEqual([
      { ratePercent: '12.00', baseMinor: 5000, taxMinor: 600 },
      { ratePercent: '25.00', baseMinor: 20000, taxMinor: 5000 },
    ]);
  });

  it('is deterministic — repeated runs give identical results', () => {
    const inputs = [
      { quantity: 1.333, unitPriceMinor: 12345, discountPercent: 7.5, taxRatePercent: 25 },
    ];
    const a = computeDocument(inputs);
    const b = computeDocument(inputs);
    expect(a).toEqual(b);
  });
});
