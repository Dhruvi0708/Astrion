import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers';

/**
 * Backend-offline behaviour. The outage is simulated by aborting /api requests in the browser
 * (the backend process keeps running), which is what the frontend sees when the API is unreachable.
 */
test('sign-in page explains when the API is unreachable', async ({ page }) => {
  // Match API calls only — a glob like **/api/** would also block Vite's /src/lib/api/*.ts modules.
  await page.route(/\/api\/v1\//, (route) => route.abort('connectionrefused'));
  await page.goto('/app/overview');
  await expect(page).toHaveURL(/\/login\?next=.*reason=offline/);
  await expect(page.getByRole('status')).toContainText(/api is currently unreachable/i);
});

test('signed-in pages degrade gracefully and the Sources badge reports offline', async ({ page }) => {
  await registerViaApi(page.request, 'offline');
  await page.goto('/app/sources');
  await expect(page.getByText('Live data')).toBeVisible();

  // Keep the session (refresh still works) but take the data API away.
  await page.route(/\/api\/v1\/(workspaces|sources|documents|health)/, (route) => route.abort('connectionrefused'));
  await page.reload();
  await expect(page.getByText('Backend unavailable').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTitle(/ASTRION API is unreachable/)).toHaveText('Backend offline');
  await expect(page.getByText('Live data')).toHaveCount(0);
});
