import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Phase 4 billing happy path against the real API + database as the demo owner
 * (who holds invoices.manage): create a product, build a draft invoice with two
 * line items, verify the displayed total, finalize it (number assigned, editor
 * gone), then register two payments to walk DRAFT → OPEN → PARTIALLY_PAID → PAID.
 *
 * All amounts are SEK. Prices are typed in major units; the server computes the
 * authoritative totals from raw inputs, so the assertions below use the exact
 * localized currency strings the UI renders via formatMinor.
 */
test('invoice lifecycle: create, finalize, partial then full payment', async ({ page }) => {
  const unique = randomUUID().slice(0, 8);
  const productName = `Consulting ${unique}`;

  // The two line items: 2 × 1000.00 (25% VAT) and 1 × 500.00 (25% VAT).
  // Net 2500.00, VAT 625.00, total 3125.00 SEK.
  const expectedTotal = 'SEK 3,125.00';
  const partialAmount = '1000';
  const expectedDueAfterPartial = 'SEK 2,125.00';

  // Log in as the demo owner (English UI).
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.businessos.local');
  await page.getByLabel('Password').fill('OwnerDemo123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');

  // Create a product in the catalogue.
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.waitForURL('**/products');
  await page.getByRole('button', { name: 'New product' }).click();
  const productDialog = page.getByRole('dialog');
  await productDialog.getByLabel('Name').fill(productName);
  await productDialog.getByLabel('Unit price').fill('1000');
  await productDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(productName)).toBeVisible();

  // Create a draft invoice for the first seeded customer.
  await page.getByRole('link', { name: 'Invoices', exact: true }).click();
  await page.waitForURL('**/invoices');
  await page.getByRole('button', { name: 'New invoice' }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option').first().click();
  await createDialog.getByRole('button', { name: 'Create and edit' }).click();

  // Land on the invoice editor.
  await page.waitForURL(/\/invoices\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Draft' })).toBeVisible();

  // First line: pick the product (prefills price 1000.00), quantity 2.
  const firstProduct = page.getByLabel('Product').first();
  await firstProduct.click();
  await page.getByRole('option', { name: productName }).click();
  await page.getByLabel('Quantity').first().fill('2');

  // Second line: free text, 1 × 500.00 at 25% VAT.
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByLabel('Description').last().fill('Extra work');
  await page.getByLabel('Quantity').last().fill('1');
  await page.getByLabel('Unit price').last().fill('500');
  await page.getByLabel('VAT %').last().fill('25');

  // Save the draft; the server returns authoritative totals.
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Invoice saved')).toBeVisible();

  // The totals block shows the server-computed grand total.
  await expect(page.getByText(expectedTotal).first()).toBeVisible();

  // Finalize: assigns a number, locks the invoice, generates a PDF.
  await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  const finalizeDialog = page.getByRole('dialog');
  await finalizeDialog.getByRole('button', { name: 'Finalize', exact: true }).click();
  await expect(page.getByText('Invoice finalized')).toBeVisible();

  // Status becomes OPEN and a real invoice number appears (INV-...).
  await expect(page.getByText('Open').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /INV-/ })).toBeVisible();

  // The line-item editor is gone (no "Add line" once finalized).
  await expect(page.getByRole('button', { name: 'Add line' })).toHaveCount(0);

  // The Download PDF action is available.
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();

  // Register a partial payment of 1000.00; status → PARTIALLY_PAID, due drops.
  await page.getByRole('button', { name: 'Register payment' }).click();
  const paymentDialog = page.getByRole('dialog');
  await paymentDialog.getByLabel('Amount').fill(partialAmount);
  await paymentDialog.getByRole('button', { name: 'Register payment' }).click();
  await expect(page.getByText('Payment registered')).toBeVisible();
  await expect(page.getByText('Partially paid').first()).toBeVisible();
  await expect(page.getByText(expectedDueAfterPartial)).toBeVisible();

  // Register the remaining amount (defaults to the amount due); status → PAID.
  await page.getByRole('button', { name: 'Register payment' }).click();
  const paymentDialog2 = page.getByRole('dialog');
  await paymentDialog2.getByRole('button', { name: 'Register payment' }).click();
  await expect(page.getByText('Payment registered')).toBeVisible();
  await expect(page.getByText('Paid').first()).toBeVisible();
});
