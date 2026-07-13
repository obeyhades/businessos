import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Phase 2 happy path against the real API + database as the demo owner:
 * customer → contact → comment → task (linked) → complete → activity → search.
 */
test('customer, contact, comment, task lifecycle and search', async ({ page }) => {
  const unique = randomUUID().slice(0, 8);
  const customerName = `E2E Customer ${unique}`;
  const contactName = `Contact ${unique}`;
  const commentBody = `Kickoff note ${unique}`;
  const taskTitle = `E2E Task ${unique}`;

  // Log in as the demo owner (English UI).
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.businessos.local');
  await page.getByLabel('Password').fill('OwnerDemo123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');

  // Go to customers and create one with a unique name.
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.waitForURL('**/customers');
  await page.getByRole('button', { name: 'New customer' }).click();
  const customerDialog = page.getByRole('dialog');
  await customerDialog.getByLabel('Name').fill(customerName);
  await customerDialog.getByRole('button', { name: 'Save changes' }).click();

  // Lands on the customer detail page.
  await page.waitForURL(/\/customers\/[0-9a-f-]+$/);
  const customerUrl = page.url();
  await expect(page.getByRole('heading', { name: customerName })).toBeVisible();

  // Add a contact.
  await page.getByRole('button', { name: 'Add contact' }).click();
  const contactDialog = page.getByRole('dialog');
  await contactDialog.getByLabel('Name').fill(contactName);
  await contactDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(contactName)).toBeVisible();

  // Add a comment.
  await page.getByPlaceholder(/Write a comment/).fill(commentBody);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText(commentBody)).toBeVisible();

  // Create a task linked to this customer from the tasks hub.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.waitForURL('**/tasks');
  await page.getByRole('button', { name: 'New task' }).click();
  const taskDialog = page.getByRole('dialog');
  await taskDialog.getByLabel('Title').fill(taskTitle);
  await taskDialog.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option', { name: customerName }).click();
  await taskDialog.getByRole('button', { name: 'Save changes' }).click();

  // Task shows up in the hub; open its detail page.
  await expect(page.getByRole('link', { name: taskTitle })).toBeVisible();
  await page.getByRole('link', { name: taskTitle }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible();

  // Mark the task DONE via the status select and confirm it reflects immediately.
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Done' }).click();
  await expect(page.getByText('Completed', { exact: false })).toBeVisible();

  // The customer's activity timeline shows the created + completed events.
  await page.goto(customerUrl);
  await expect(page.getByRole('heading', { name: customerName })).toBeVisible();
  await expect(page.getByText('created this customer')).toBeVisible();
  await expect(page.getByText('completed this task')).toBeVisible();

  // Global search finds the customer by name.
  await page.keyboard.press('Control+k');
  const searchDialog = page.getByRole('dialog');
  await searchDialog.getByRole('combobox').fill(customerName);
  const result = searchDialog.getByRole('option', { name: customerName });
  await expect(result).toBeVisible();
  await result.click();
  await page.waitForURL(/\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: customerName })).toBeVisible();
});
