import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Phase 5 bookkeeping happy path against the real API + database as the demo
 * owner (who holds accounting.post): open the journal, build a balanced manual
 * voucher with two lines (Dr 1930 / Cr 3001, 100.00 each), confirm the live
 * balance indicator, save the draft, then post it — which assigns a V- number,
 * flips the status to Posted, and locks the entry (the line editor disappears).
 *
 * The seeded demo org already has a chart of accounts and a current-year fiscal
 * year with OPEN monthly periods, so a voucher dated today is postable.
 */
test('voucher lifecycle: build a balanced draft, then post it', async ({ page }) => {
  const description = `E2E voucher ${randomUUID().slice(0, 8)}`;
  const today = new Date().toISOString().slice(0, 10);

  // Log in as the demo owner (English UI).
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.businessos.local');
  await page.getByLabel('Password').fill('OwnerDemo123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');

  // Open the journal and start a new voucher.
  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  await page.waitForURL('**/accounting/vouchers');
  await page
    .getByRole('button', { name: 'New voucher' })
    .or(page.getByRole('link', { name: 'New voucher' }))
    .first()
    .click();
  await page.waitForURL('**/accounting/vouchers/new');

  // Header fields (the first Description is the voucher description, not a line).
  await page.getByLabel('Date').fill(today);
  await page.getByLabel('Description').first().fill(description);

  const accounts = page.getByRole('combobox', { name: 'Account' });
  const sides = page.getByRole('combobox', { name: 'Side' });
  const amounts = page.getByLabel('Amount');

  // Line 1 — debit 1930 (bank) 100.00.
  await accounts.nth(0).click();
  await page.getByRole('option', { name: /^1930/ }).click();
  await sides.nth(0).click();
  await page.getByRole('option', { name: 'Debit', exact: true }).click();
  await amounts.nth(0).fill('100');

  // Line 2 — credit 3001 (sales) 100.00.
  await accounts.nth(1).click();
  await page.getByRole('option', { name: /^3001/ }).click();
  await sides.nth(1).click();
  await page.getByRole('option', { name: 'Credit', exact: true }).click();
  await amounts.nth(1).fill('100');

  // The live balance indicator confirms debit == credit before posting.
  await expect(page.getByText('Balanced', { exact: true }).first()).toBeVisible();

  // Save the draft; the app navigates to the voucher detail page.
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft voucher created')).toBeVisible();

  // Post it (permanent + immutable) via the confirmation dialog.
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Voucher posted')).toBeVisible();

  // A real voucher number (V-#####) appears, status is Posted, and the entry is
  // now immutable — the line editor's "Add line" control is gone.
  await expect(page.getByText(/V-\d{5}/).first()).toBeVisible();
  await expect(page.getByText('Posted').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add line' })).toHaveCount(0);
});
