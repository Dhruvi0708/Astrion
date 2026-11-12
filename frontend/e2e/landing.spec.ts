import { expect, test } from '@playwright/test';

test('landing page presents the product and its CTAs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /knowledge is not static/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore the Intelligence' })).toHaveAttribute('href', '#architecture');
  for (const id of ['problem', 'architecture', 'explore', 'intelligence', 'discovery']) {
    await expect(page.locator(`section#${id}`)).toBeAttached();
  }
  // The 3D scene (or its SVG fallback) renders inside the hero.
  await expect(page.locator('section#top canvas, section#top svg').first()).toBeAttached({ timeout: 15_000 });
});

test('Enter the Universe sends anonymous visitors to sign in, then back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Enter the Universe' }).first().click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Funiverse/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});
