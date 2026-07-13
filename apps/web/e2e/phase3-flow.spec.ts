import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Phase 3 personnel happy path against the real API + database as the demo
 * owner (who holds personnel.read_sensitive): create an employee with a
 * sensitive personal ID → verify the Sensitive information card → apply the
 * seeded onboarding template → add a certification → find via global search.
 */
test('employee lifecycle: sensitive data, onboarding, certification, search', async ({ page }) => {
  const unique = randomUUID().slice(0, 8);
  const firstName = `Evelina${unique}`;
  const lastName = `Testsson${unique}`;
  const fullName = `${firstName} ${lastName}`;
  const personalId = `19900101-${unique.slice(0, 4)}`;
  const certName = `Hot Work Permit ${unique}`;
  const soonDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Log in as the demo owner (English UI).
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.businessos.local');
  await page.getByLabel('Password').fill('OwnerDemo123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');

  // Open the personnel directory and create an employee with a sensitive field.
  await page.getByRole('link', { name: 'Personnel', exact: true }).click();
  await page.waitForURL('**/employees');
  await page.getByRole('button', { name: 'New employee' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill(firstName);
  await dialog.getByLabel('Last name').fill(lastName);
  await dialog.getByLabel('Personal ID number').fill(personalId);
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  // Saving navigates to the detail page.
  await page.waitForURL(/\/employees\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: fullName })).toBeVisible();

  // The owner can read sensitive data, so the personal ID is shown.
  await expect(page.getByText(personalId)).toBeVisible();

  // Apply the seeded onboarding template and assert the created-task count toast.
  await page.getByRole('button', { name: 'Apply onboarding template' }).click();
  await page.getByRole('combobox', { name: 'Template' }).click();
  await page.getByRole('option', { name: 'Field employee onboarding' }).click();
  await page.getByRole('button', { name: 'Apply template', exact: true }).click();
  await expect(page.getByText(/tasks? created/)).toBeVisible();

  // Add a certification with a near expiry and assert it appears.
  await page.getByRole('button', { name: 'Add certification' }).click();
  const certDialog = page.getByRole('dialog');
  await certDialog.getByLabel('Name').fill(certName);
  await certDialog.getByLabel('Expiry date').fill(soonDate);
  await certDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(certName)).toBeVisible();
  await expect(page.getByText('Expires soon').first()).toBeVisible();

  // Find the employee through global search and open the detail page.
  await page.getByRole('button', { name: 'Search' }).first().click();
  await page.getByRole('combobox').fill(firstName);
  await page.getByRole('option', { name: new RegExp(fullName) }).click();
  await page.waitForURL(/\/employees\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
});

/**
 * An accountant has no personnel permission, so the directory renders an
 * access-restricted notice instead of the employee table.
 */
test('personnel directory is access-gated for users without permission', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@demo.businessos.local');
  await page.getByLabel('Password').fill('AccountantDemo123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');

  // The Personnel nav item is hidden; navigate directly and expect the notice.
  await page.goto('/employees');
  await expect(page.getByText('You do not have permission to view personnel.')).toBeVisible();
});
