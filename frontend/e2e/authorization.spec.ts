import { expect, test } from '@playwright/test';
import { api, registerViaApi } from './helpers';

test('one user cannot see or reach another user’s workspace', async ({ browser }) => {
  // Two isolated browser contexts = two different people with separate cookies.
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  try {
    const alice = await registerViaApi(aliceCtx.request, 'alice', 'Alice');
    const bob = await registerViaApi(bobCtx.request, 'bob', 'Bob');
    const ws = await (await api(aliceCtx.request, alice.token, 'post', '/workspaces', { name: 'Alice Confidential' })).json();
    const src = await (
      await api(aliceCtx.request, alice.token, 'post', `/workspaces/${ws.id}/sources`, { title: 'Alice Source', source_type: 'report' })
    ).json();

    // API: Bob gets 404 (not 403) for every one of Alice's resources.
    for (const path of [`/workspaces/${ws.id}`, `/workspaces/${ws.id}/sources`, `/sources/${src.id}`, `/sources/${src.id}/documents`]) {
      expect((await api(bobCtx.request, bob.token, 'get', path)).status(), path).toBe(404);
    }
    expect((await api(bobCtx.request, bob.token, 'post', `/workspaces/${ws.id}/sources`, { title: 'x', source_type: 'paper' })).status()).toBe(404);

    // UI: Bob's workspace selector and Sources page never show Alice's data.
    const page = await bobCtx.newPage();
    await page.goto('/app/sources');
    await expect(page.getByText('Create a workspace first')).toBeVisible();
    await expect(page.getByText('Alice Confidential')).toHaveCount(0);
    await expect(page.getByText('Alice Source')).toHaveCount(0);
  } finally {
    await aliceCtx.close();
    await bobCtx.close();
  }
});
