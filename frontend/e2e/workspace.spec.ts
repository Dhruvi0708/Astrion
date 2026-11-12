import { expect, test } from '@playwright/test';
import { NAV } from './nav';
import { api, registerViaApi } from './helpers';

test('navigates every environment from the sidebar', async ({ page }) => {
  await registerViaApi(page.request, 'nav');
  await page.goto('/app/overview');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const item of NAV) {
    await nav.getByRole('link', { name: item.label }).click();
    await expect(page).toHaveURL(new RegExp(item.to));
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(item.label);
  }
});

test('creates a workspace, registers a source and uploads a document', async ({ page }) => {
  await registerViaApi(page.request, 'flow');
  await page.goto('/app/overview');

  await page.getByRole('button', { name: 'New workspace' }).click();
  const wsDialog = page.getByRole('dialog', { name: 'Create workspace' });
  await wsDialog.getByLabel('Name').fill('E2E Coastal Review');
  await wsDialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Coastal Review' })).toBeVisible();

  await page.goto('/app/sources?new=1');
  await expect(page.getByText('Live data')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Register source' });
  await dialog.getByLabel('Title').fill('E2E Flood Assessment');
  await dialog.getByLabel('URL').fill('not a url');
  await dialog.getByRole('button', { name: 'Register source' }).click();
  await expect(dialog.getByText('Use a full http(s) URL.')).toBeVisible();
  await dialog.getByLabel('URL').fill('https://example.org/flood');
  await dialog.getByRole('button', { name: 'Register source' }).click();
  await expect(page.getByRole('button', { name: 'E2E Flood Assessment' })).toBeVisible();

  await page.getByTestId('document-upload').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('e2e field notes') });
  await expect(page.getByText(/notes\.txt/)).toBeVisible();
  await expect(page.getByText(/stored · registered/)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download notes\.txt/ }).click();
  expect((await download).suggestedFilename()).toBe('notes.txt');
});

test('rejects disallowed file types with a clear message', async ({ page }) => {
  const user = await registerViaApi(page.request, 'upload');
  const ws = await (await api(page.request, user.token, 'post', '/workspaces', { name: 'Upload rules' })).json();
  await api(page.request, user.token, 'post', `/workspaces/${ws.id}/sources`, { title: 'Upload target', source_type: 'paper' });
  await page.goto('/app/sources');
  await page.getByRole('button', { name: 'Upload target' }).click();
  await page.getByTestId('document-upload').setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByRole('alert')).toContainText(/file type not allowed/i);
});
