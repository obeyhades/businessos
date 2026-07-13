import type {
  CreditNote,
  CreditNoteLineItem,
  Customer,
  Invoice,
  InvoiceLineItem,
  Payment,
  Product,
  Quote,
  QuoteLineItem,
  User,
} from '@businessos/db';
import { Prisma } from '@businessos/db';
import type {
  CreditNoteDto,
  InvoiceDto,
  LineItemDto,
  PaymentDto,
  PaymentMethod,
  ProductDto,
  QuoteDto,
  QuoteStatus,
  TaxLine,
} from '@businessos/types';

type MiniUser = Pick<User, 'id' | 'name'>;
type MiniCustomer = Pick<Customer, 'id' | 'name'>;
type Decimalish = Prisma.Decimal | number | string;

const n = (value: bigint): number => Number(value);
const dec = (value: Decimalish): number =>
  value instanceof Prisma.Decimal ? value.toNumber() : Number(value);

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toTaxLines(json: Prisma.JsonValue | null): TaxLine[] {
  if (!Array.isArray(json)) return [];
  return json as unknown as TaxLine[];
}

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    sku: product.sku,
    unit: product.unit,
    unitPriceMinor: n(product.unitPriceMinor),
    currency: product.currency,
    taxRatePercent: dec(product.taxRatePercent),
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function toLineItemDto(line: QuoteLineItem | InvoiceLineItem): LineItemDto {
  return {
    id: line.id,
    productId: line.productId,
    description: line.description,
    quantity: dec(line.quantity),
    unitPriceMinor: n(line.unitPriceMinor),
    discountPercent: dec(line.discountPercent),
    taxRatePercent: dec(line.taxRatePercent),
    lineNetMinor: n(line.lineNetMinor),
    lineTaxMinor: n(line.lineTaxMinor),
    lineTotalMinor: n(line.lineTotalMinor),
  };
}

export function toQuoteDto(
  quote: Quote & { customer: MiniCustomer; lineItems: QuoteLineItem[] },
): QuoteDto {
  return {
    id: quote.id,
    number: quote.number,
    status: quote.status as QuoteStatus,
    currency: quote.currency,
    issueDate: isoDate(quote.issueDate) ?? '',
    validUntil: isoDate(quote.validUntil),
    customer: { id: quote.customer.id, name: quote.customer.name },
    customerNotes: quote.customerNotes,
    internalNotes: quote.internalNotes,
    subtotalMinor: n(quote.subtotalMinor),
    discountMinor: n(quote.discountMinor),
    taxMinor: n(quote.taxMinor),
    totalMinor: n(quote.totalMinor),
    taxLines: toTaxLines(quote.taxLines),
    lineItems: [...quote.lineItems].sort((a, b) => a.sortOrder - b.sortOrder).map(toLineItemDto),
    acceptedAt: quote.acceptedAt?.toISOString() ?? null,
    convertedInvoiceId: quote.convertedInvoiceId,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
  };
}

export function toInvoiceDto(
  invoice: Invoice & { customer: MiniCustomer; lineItems: InvoiceLineItem[] },
  now: Date,
): InvoiceDto {
  const amountDueMinor =
    n(invoice.totalMinor) - n(invoice.amountPaidMinor) - n(invoice.creditedMinor);
  const openStatuses = new Set(['OPEN', 'SENT', 'PARTIALLY_PAID', 'OVERDUE']);
  const isOverdue =
    openStatuses.has(invoice.status) &&
    amountDueMinor > 0 &&
    invoice.dueDate.getTime() < now.getTime();
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    issueDate: isoDate(invoice.issueDate) ?? '',
    dueDate: isoDate(invoice.dueDate) ?? '',
    customer: { id: invoice.customer.id, name: invoice.customer.name },
    customerNotes: invoice.customerNotes,
    internalNotes: invoice.internalNotes,
    subtotalMinor: n(invoice.subtotalMinor),
    discountMinor: n(invoice.discountMinor),
    taxMinor: n(invoice.taxMinor),
    totalMinor: n(invoice.totalMinor),
    amountPaidMinor: n(invoice.amountPaidMinor),
    creditedMinor: n(invoice.creditedMinor),
    amountDueMinor,
    taxLines: toTaxLines(invoice.taxLines),
    lineItems: [...invoice.lineItems].sort((a, b) => a.sortOrder - b.sortOrder).map(toLineItemDto),
    isOverdue,
    hasPdf: invoice.pdfStorageKey !== null,
    fromQuoteId: null,
    finalizedAt: invoice.finalizedAt?.toISOString() ?? null,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

export function toPaymentDto(payment: Payment & { createdBy: MiniUser | null }): PaymentDto {
  return {
    id: payment.id,
    amountMinor: n(payment.amountMinor),
    method: payment.method as PaymentMethod,
    reference: payment.reference,
    paidOn: isoDate(payment.paidOn) ?? '',
    note: payment.note,
    createdBy: payment.createdBy
      ? { id: payment.createdBy.id, name: payment.createdBy.name }
      : null,
    createdAt: payment.createdAt.toISOString(),
  };
}

export function toCreditNoteDto(
  creditNote: CreditNote & { lineItems: CreditNoteLineItem[] },
): CreditNoteDto {
  return {
    id: creditNote.id,
    invoiceId: creditNote.invoiceId,
    number: creditNote.number,
    status: creditNote.status,
    currency: creditNote.currency,
    issueDate: isoDate(creditNote.issueDate) ?? '',
    reason: creditNote.reason,
    subtotalMinor: n(creditNote.subtotalMinor),
    taxMinor: n(creditNote.taxMinor),
    totalMinor: n(creditNote.totalMinor),
    taxLines: toTaxLines(creditNote.taxLines),
    lineItems: [...creditNote.lineItems]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        id: line.id,
        description: line.description,
        quantity: dec(line.quantity),
        unitPriceMinor: n(line.unitPriceMinor),
        taxRatePercent: dec(line.taxRatePercent),
        lineNetMinor: n(line.lineNetMinor),
        lineTaxMinor: n(line.lineTaxMinor),
        lineTotalMinor: n(line.lineTotalMinor),
      })),
    issuedAt: creditNote.issuedAt?.toISOString() ?? null,
    createdAt: creditNote.createdAt.toISOString(),
    updatedAt: creditNote.updatedAt.toISOString(),
  };
}
