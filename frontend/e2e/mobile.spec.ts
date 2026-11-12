import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers';

test('mobile navigation drawer opens, navigates and closes', async ({ page }) => {
  await registerViaApi(page.request, 'mobile');
  await page.goto('/app/overview');
  const noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHorizontalScroll).toBe(true);

  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Discovery Laboratory' }).click();
  await expect(page).toHaveURL(/\/app\/discovery/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Discovery Laboratory' })).toBeVisible();
});

test('landing page fits a phone screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /knowledge is not static/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
