import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Phase 6 calendar happy path against the real API + database as the demo owner
 * (who holds calendar.manage): open the calendar, create an event dated today
 * via the editor dialog (default Team calendar, organizer auto-added), and see
 * it render in the month grid. Then open My agenda and confirm it lists items.
 *
 * The seeded demo org already has a default Team calendar, so the editor's
 * calendar defaults to it and no calendar setup is needed.
 */
test('calendar: create an event and see it on the grid + agenda', async ({ page }) => {
  const title = `E2E meeting ${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // Log in as the demo owner (English UI).
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.businessos.local');
  await page.getByLabel('Password').fill('OwnerDemo123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');

  // Open the calendar; the seeded "Customer kickoff" event proves it renders.
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await page.waitForURL('**/calendar');
  await expect(page.getByRole('button', { name: 'Month' })).toBeVisible();

  // Create a new event dated today.
  await page.getByRole('button', { name: 'New event' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Starts').fill(`${day}T09:15`);
  await dialog.getByLabel('Ends').fill(`${day}T10:15`);
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  // The dialog closes and the new event appears on the grid (events render as
  // buttons labeled by their title).
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: title })).toBeVisible();

  // My agenda lists items (the new event + any due tasks).
  await page.getByRole('link', { name: 'My agenda' }).click();
  await page.waitForURL('**/calendar/agenda');
  await expect(page.getByText(title)).toBeVisible();
});
