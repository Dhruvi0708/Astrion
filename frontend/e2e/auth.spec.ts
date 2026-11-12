import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from './helpers';

test('register, sign out, and sign back in through the UI', async ({ page }) => {
  const email = uniqueEmail('ui');
  await page.goto('/register');
  await page.getByLabel('Name').fill('Playwright Researcher');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/app\/overview/);
  await page.getByRole('button', { name: 'Profile menu' }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);

  // Signed out means the protected app is no longer reachable, even after a reload.
  await page.goto('/app/sources');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsources/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/sources/); // returns to where the user was going
});

test('wrong password shows an error without revealing whether the account exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail('nobody'));
  await page.getByLabel('Password', { exact: true }).fill('not the password at all');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(/email or password is incorrect/i);
});

test('protected routes redirect anonymous visitors', async ({ page }) => {
  for (const path of ['/app/overview', '/app/universe', '/app/sources', '/app/settings']) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
  }
});

test('session persists across reloads via the refresh cookie and ends on expiry', async ({ page, context }) => {
  const email = uniqueEmail('reload');
  await page.goto('/register');
  await page.getByLabel('Name').fill('Reload Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app\/overview/);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/overview/);

  // Simulate the refresh session disappearing (expired / revoked elsewhere).
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});
