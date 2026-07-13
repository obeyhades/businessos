import type { Invoice, InvoiceStatus } from '@businessos/db';

/**
 * Recomputes an issued invoice's status from its money position. Pure and
 * deterministic. The "issued base" (OPEN vs SENT) is preserved via sentAt so a
 * partial payment on a sent invoice still knows it was sent.
 */
export function nextInvoiceStatus(
  invoice: Pick<Invoice, 'totalMinor' | 'sentAt'>,
  totalPaidMinor: bigint,
  totalCreditedMinor: bigint,
): { status: InvoiceStatus; paidAt: Date | null } {
  const total = invoice.totalMinor;
  const due = total - totalPaidMinor - totalCreditedMinor;

  if (totalCreditedMinor >= total && total > 0n) {
    return { status: 'CREDITED', paidAt: null };
  }
  if (due <= 0n && total > 0n) {
    return { status: 'PAID', paidAt: new Date() };
  }
  if (totalPaidMinor > 0n) {
    return { status: 'PARTIALLY_PAID', paidAt: null };
  }
  return { status: invoice.sentAt ? 'SENT' : 'OPEN', paidAt: null };
}
