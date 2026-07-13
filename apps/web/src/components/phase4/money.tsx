'use client';

import { formatMinor, MINOR_UNITS_PER_MAJOR } from '@businessos/types';
import { Input, Label } from '@businessos/ui';
import { useLocale } from 'next-intl';
import type { ComponentProps } from 'react';
import { useCallback } from 'react';

/** Hook returning a locale-aware money formatter for minor-unit amounts. */
export function useFormatMoney(): (amountMinor: number, currency: string) => string {
  const locale = useLocale();
  return useCallback(
    (amountMinor: number, currency: string) => formatMinor(amountMinor, currency, locale),
    [locale],
  );
}

/** Inline money display (integer minor units → localized currency string). */
export function Money({ amountMinor, currency }: { amountMinor: number; currency: string }) {
  const format = useFormatMoney();
  return <>{format(amountMinor, currency)}</>;
}

/**
 * Converts a major-unit text value (what the user types, e.g. "1200.50") into
 * integer minor units (öre). Empty/invalid input yields 0. Rounds to avoid
 * floating-point drift.
 */
export function majorToMinor(value: string): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * MINOR_UNITS_PER_MAJOR);
}

/** Renders minor units as a plain major-unit string for editing (no currency symbol). */
export function minorToMajorText(amountMinor: number): string {
  return (amountMinor / MINOR_UNITS_PER_MAJOR).toString();
}

interface MoneyFieldProps extends Omit<ComponentProps<typeof Input>, 'type'> {
  id: string;
  label: string;
  error?: string;
}

/**
 * Text field for entering money in MAJOR units. The caller reads the raw string
 * and converts to minor units with majorToMinor before sending to the server.
 */
export function MoneyField({ id, label, error, className, ...props }: MoneyFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={className}
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
