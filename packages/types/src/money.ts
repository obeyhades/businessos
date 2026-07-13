/**
 * Display helpers for money. Amounts are INTEGER MINOR UNITS everywhere on the
 * wire; the UI converts to major units only for formatting. All supported
 * currencies are assumed to have 2 decimal places (documented limitation).
 */
export const MINOR_UNITS_PER_MAJOR = 100;

export function minorToMajor(amountMinor: number): number {
  return amountMinor / MINOR_UNITS_PER_MAJOR;
}

export function formatMinor(amountMinor: number, currency: string, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minorToMajor(amountMinor),
  );
}
