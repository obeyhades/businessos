import { expect, test } from '@playwright/test';

/**
 * Phase 7 email happy path against the real API + database as the demo owner
 * (who holds email.read + email.send): open the Mail inbox, confirm it lists the
 * seeded inbound conversation, open it, and read the message body in the reading
 * pane. The compose→send write path is covered by the integration suite + the
 * worker send-status inline check; this proves the inbox UI is wired to the API.
 *
 * The seeded demo org has a shared "Support" mailbox with an inbound thread
 * "Question about my quote", so no email setup is needed.
 */
test('mail: the inbox lists conversations and opens the reading pane', async ({ page }) => {
  // Log in as the demo owner (English UI).
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.businessos.local');
  await page.getByLabel('Password').fill('OwnerDemo123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');

  // Open the Mail module.
  await page.getByRole('link', { name: 'Mail', exact: true }).click();
  await page.waitForURL('**/mail');
  await expect(page.getByText('Compose')).toBeVisible();

  // The seeded inbound conversation is listed in the inbox.
  const thread = page.getByText('Question about my quote').first();
  await expect(thread).toBeVisible();

  // Opening it shows the message body in the reading pane.
  await thread.click();
  await expect(page.getByText(/clarify the delivery time/i)).toBeVisible();
});
