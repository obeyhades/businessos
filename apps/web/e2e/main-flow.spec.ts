import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Full Phase 1 happy path against the real API + database:
 * register → create org → dashboard → invite → revoke → logout → login.
 */
test('register, onboard, invite, revoke, logout, login', async ({ page }) => {
  const unique = randomUUID().slice(0, 8);
  const email = `e2e-${unique}@example.com`;
  const password = 'E2eDemo123!pass';
  const orgName = `E2E Org ${unique}`;

  // Register a fresh account.
  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // No org yet → onboarding.
  await page.waitForURL('**/onboarding');
  await page.getByLabel('Organization name').fill(orgName);
  await page.getByRole('button', { name: 'Create organization' }).click();

  // Dashboard shows the new organization.
  await page.waitForURL('**/dashboard');
  await expect(page.getByText(orgName).first()).toBeVisible();

  // Invite a colleague as EMPLOYEE (the invite form default role).
  await page.getByRole('link', { name: 'Members', exact: true }).click();
  await page.waitForURL('**/members');
  await page.getByLabel('Email').fill('colleague@example.com');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  // Pending invitation is listed.
  const invitationCell = page.getByRole('cell', { name: 'colleague@example.com' });
  await expect(invitationCell).toBeVisible();

  // Revoke it (confirm dialog).
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(invitationCell).toHaveCount(0);
  await expect(page.getByText('No pending invitations.')).toBeVisible();

  // Logout via the user menu.
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.waitForURL('**/login');

  // Login again and land on the dashboard.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByText(orgName).first()).toBeVisible();
});
