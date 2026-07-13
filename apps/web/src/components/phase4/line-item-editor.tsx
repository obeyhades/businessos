'use client';

import type { LineItemDto, LineItemInput, ProductDto } from '@businessos/types';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { majorToMinor, minorToMajorText, Money } from './money';

/** A line row as edited in the UI. Money is kept as a major-unit string. */
export interface EditorLine {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPriceMajor: string;
  discountPercent: string;
  taxRatePercent: string;
}

const FREE_TEXT = 'FREE_TEXT';

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `line-${keyCounter}`;
}

export function newEditorLine(): EditorLine {
  return {
    key: nextKey(),
    productId: null,
    description: '',
    quantity: '1',
    unitPriceMajor: '0',
    discountPercent: '0',
    taxRatePercent: '25',
  };
}

export function editorLineFromDto(line: LineItemDto): EditorLine {
  return {
    key: nextKey(),
    productId: line.productId,
    description: line.description,
    quantity: line.quantity.toString(),
    unitPriceMajor: minorToMajorText(line.unitPriceMinor),
    discountPercent: line.discountPercent.toString(),
    taxRatePercent: line.taxRatePercent.toString(),
  };
}

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Converts editor rows into the server line-item input shape. */
export function editorLinesToInput(lines: EditorLine[]): LineItemInput[] {
  return lines.map((line) => ({
    productId: line.productId,
    description: line.description.trim(),
    quantity: toNumber(line.quantity),
    unitPriceMinor: majorToMinor(line.unitPriceMajor),
    discountPercent: toNumber(line.discountPercent),
    taxRatePercent: toNumber(line.taxRatePercent),
  }));
}

/**
 * Client-side preview of a single line total in minor units. This is only a UX
 * hint — the server recomputes and returns the authoritative totals on save.
 */
export function previewLineTotalMinor(line: EditorLine): number {
  const qty = toNumber(line.quantity);
  const priceMinor = majorToMinor(line.unitPriceMajor);
  const discount = toNumber(line.discountPercent);
  const vat = toNumber(line.taxRatePercent);
  const net = qty * priceMinor * (1 - discount / 100);
  const total = net * (1 + vat / 100);
  return Math.round(total);
}

/** Client-side preview grand total in minor units. */
export function previewTotalMinor(lines: EditorLine[]): number {
  return lines.reduce((sum, line) => sum + previewLineTotalMinor(line), 0);
}

export function LineItemEditor({
  lines,
  onChange,
  products,
  currency,
  disabled = false,
}: {
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  products: ProductDto[];
  currency: string;
  disabled?: boolean;
}) {
  const t = useTranslations('billing');

  function update(key: string, patch: Partial<EditorLine>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function applyProduct(key: string, productId: string) {
    if (productId === FREE_TEXT) {
      update(key, { productId: null });
      return;
    }
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return;
    update(key, {
      productId: product.id,
      description: product.name,
      unitPriceMajor: minorToMajorText(product.unitPriceMinor),
      taxRatePercent: product.taxRatePercent.toString(),
    });
  }

  function addLine() {
    onChange([...lines, newEditorLine()]);
  }

  function removeLine(key: string) {
    onChange(lines.filter((line) => line.key !== key));
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {lines.map((line, index) => (
          <li key={line.key} className="rounded-lg border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-8">
                <Label htmlFor={`${line.key}-product`}>{t('lineProduct')}</Label>
                <Select
                  value={line.productId ?? FREE_TEXT}
                  onValueChange={(value) => applyProduct(line.key, value)}
                  disabled={disabled}
                >
                  <SelectTrigger id={`${line.key}-product`} aria-label={t('lineProduct')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FREE_TEXT}>{t('lineFreeText')}</SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end justify-end sm:col-span-4">
                {!disabled ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('lineRemove')}
                    onClick={() => removeLine(line.key)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              <div className="space-y-1.5 sm:col-span-12">
                <Label htmlFor={`${line.key}-description`}>{t('lineDescription')}</Label>
                <Input
                  id={`${line.key}-description`}
                  value={line.description}
                  onChange={(event) => update(line.key, { description: event.target.value })}
                  disabled={disabled}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`${line.key}-quantity`}>{t('lineQuantity')}</Label>
                <Input
                  id={`${line.key}-quantity`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => update(line.key, { quantity: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`${line.key}-price`}>{t('lineUnitPrice')}</Label>
                <Input
                  id={`${line.key}-price`}
                  inputMode="decimal"
                  value={line.unitPriceMajor}
                  onChange={(event) => update(line.key, { unitPriceMajor: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`${line.key}-discount`}>{t('lineDiscount')}</Label>
                <Input
                  id={`${line.key}-discount`}
                  inputMode="decimal"
                  value={line.discountPercent}
                  onChange={(event) => update(line.key, { discountPercent: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`${line.key}-vat`}>{t('lineVat')}</Label>
                <Input
                  id={`${line.key}-vat`}
                  inputMode="decimal"
                  value={line.taxRatePercent}
                  onChange={(event) => update(line.key, { taxRatePercent: event.target.value })}
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3 text-sm sm:col-span-12">
                <span className="text-muted-foreground">
                  {t('lineTotalPreview', { line: index + 1 })}
                </span>
                <span className="font-medium">
                  <Money amountMinor={previewLineTotalMinor(line)} currency={currency} />
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!disabled ? (
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus aria-hidden="true" />
          {t('addLine')}
        </Button>
      ) : null}
    </div>
  );
}

/** Read-only rendering of finalized/immutable line items with server totals. */
export function LineItemTable({ lines, currency }: { lines: LineItemDto[]; currency: string }) {
  const t = useTranslations('billing');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t('lineDescription')}</th>
            <th className="py-2 px-3 text-right font-medium">{t('lineQuantity')}</th>
            <th className="py-2 px-3 text-right font-medium">{t('lineUnitPrice')}</th>
            <th className="py-2 px-3 text-right font-medium">{t('lineDiscount')}</th>
            <th className="py-2 px-3 text-right font-medium">{t('lineVat')}</th>
            <th className="py-2 pl-3 text-right font-medium">{t('lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-border last:border-0">
              <td className="py-2 pr-3">{line.description}</td>
              <td className="py-2 px-3 text-right">{line.quantity}</td>
              <td className="py-2 px-3 text-right">
                <Money amountMinor={line.unitPriceMinor} currency={currency} />
              </td>
              <td className="py-2 px-3 text-right">{line.discountPercent}%</td>
              <td className="py-2 px-3 text-right">{line.taxRatePercent}%</td>
              <td className="py-2 pl-3 text-right font-medium">
                <Money amountMinor={line.lineTotalMinor} currency={currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
