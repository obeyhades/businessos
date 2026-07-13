import PDFDocument from 'pdfkit';
import { formatMinor } from '@businessos/types';

export interface InvoicePdfData {
  organizationName: string;
  number: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  customerName: string;
  customerNotes: string | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceMinor: number;
    taxRatePercent: number;
    lineNetMinor: number;
  }>;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** Renders a simple, self-contained invoice PDF to a Buffer. */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const money = (minor: number) => formatMinor(minor, data.currency, 'en');

    doc.fontSize(20).text(data.organizationName, { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(16).text(`Invoice ${data.number}`);
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .text(`Issue date: ${data.issueDate}`)
      .text(`Due date: ${data.dueDate}`)
      .moveDown(0.5)
      .text(`Bill to: ${data.customerName}`)
      .moveDown(1);

    // Line-item table header.
    const top = doc.y;
    doc.fontSize(10).text('Description', 50, top);
    doc.text('Qty', 300, top, { width: 40, align: 'right' });
    doc.text('Unit', 345, top, { width: 70, align: 'right' });
    doc.text('VAT', 415, top, { width: 40, align: 'right' });
    doc.text('Net', 460, top, { width: 90, align: 'right' });
    doc
      .moveTo(50, doc.y + 2)
      .lineTo(545, doc.y + 2)
      .stroke();
    doc.moveDown(0.5);

    for (const line of data.lineItems) {
      const y = doc.y;
      doc.text(line.description, 50, y, { width: 240 });
      const rowY = y;
      doc.text(String(line.quantity), 300, rowY, { width: 40, align: 'right' });
      doc.text(money(line.unitPriceMinor), 345, rowY, { width: 70, align: 'right' });
      doc.text(`${line.taxRatePercent}%`, 415, rowY, { width: 40, align: 'right' });
      doc.text(money(line.lineNetMinor), 460, rowY, { width: 90, align: 'right' });
      doc.moveDown(0.5);
    }

    doc
      .moveTo(50, doc.y + 2)
      .lineTo(545, doc.y + 2)
      .stroke();
    doc.moveDown(0.5);
    doc.text(`Subtotal: ${money(data.subtotalMinor)}`, 355, doc.y, { width: 195, align: 'right' });
    doc.text(`VAT: ${money(data.taxMinor)}`, 355, doc.y, { width: 195, align: 'right' });
    doc.fontSize(12).text(`Total: ${money(data.totalMinor)}`, 355, doc.y, {
      width: 195,
      align: 'right',
    });

    if (data.customerNotes) {
      doc.moveDown(2).fontSize(10).text(data.customerNotes, 50, doc.y, { width: 495 });
    }

    doc.end();
  });
}
