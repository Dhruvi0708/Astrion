import { expect, test } from '@playwright/test';
import { api, registerViaApi } from './helpers';

/**
 * Full investigation through the real UI and API. The backend runs with ASTRION_LLM_PROVIDER=fixture
 * (see playwright.config.ts), so agents are deterministic rules, and the UI must say so.
 */
const SURVEY = `Coral Reef Survey 2023
Ocean warming increases coral bleaching across the northern reef. Surveys recorded bleaching at 61 percent of sites in 2023.
Marine heatwaves cause coral bleaching when temperatures stay above the seasonal maximum for several weeks.`;
const REVIEW = `Independent Reef Review
Ocean warming does not increase coral bleaching at the southern sites, where cooler upwelling persisted through 2023.
Marine heatwaves cause coral bleaching in shallow lagoons, according to the review team.`;

test('create, run and inspect an investigation; other users cannot open it', async ({ page, browser }) => {
  const { token } = await registerViaApi(page.request, 'inv');
  const ws = await (await api(page.request, token, 'post', '/workspaces', { name: 'E2E Reef' })).json();
  const src = await (await api(page.request, token, 'post', `/workspaces/${ws.id}/sources`, { title: 'Reef monitoring', source_type: 'report' })).json();
  for (const [name, body] of [
    ['survey.txt', SURVEY],
    ['review.txt', REVIEW],
  ]) {
    const r = await page.request.post(`/api/v1/sources/${src.id}/documents/upload`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name, mimeType: 'text/plain', buffer: Buffer.from(body) } },
    });
    expect(r.status()).toBe(201);
  }

  await page.goto('/app/investigations');
  await expect(page.getByText(/Fixture provider — not AI/)).toBeVisible();
  await page.getByRole('button', { name: 'New investigation' }).first().click();
  await page.getByLabel('Title').fill('Warming and bleaching');
  await page.getByLabel('Research question').fill('Does ocean warming increase coral bleaching on the reef?');
  await page.getByRole('button', { name: 'Create investigation' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Warming and bleaching' })).toBeVisible();
  await expect(page.getByTestId('investigation-status')).toHaveText('Draft');
  await expect(page.getByText(/No agent has run yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Start investigation' }).click();
  await expect(page.getByTestId('investigation-status')).toHaveText('Completed', { timeout: 30_000 });

  // Every stage's state comes from the server.
  await expect(page.locator('[data-stage="synthesis"]')).toHaveAttribute('data-status', 'succeeded');
  await expect(page.getByTestId('execution').first()).toBeVisible();

  await page.getByRole('radio', { name: /^Claims/ }).click();
  await expect(page.getByTestId('claim').first()).toBeVisible();

  await page.getByRole('radio', { name: 'Report' }).click();
  const report = page.getByTestId('report');
  await expect(report).toContainText('rule-based fixture, not AI');
  await expect(report).toContainText('survey.txt');

  await page.getByRole('radio', { name: 'Knowledge graph' }).click();
  await expect(page.getByTestId('knowledge-graph').locator('canvas')).toBeVisible();
  await expect(page.getByText('PostgreSQL registry').or(page.getByText('Neo4j', { exact: true }))).toBeVisible();

  // Workspace isolation: another user gets "not found" for the same URL.
  const url = page.url();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await registerViaApi(otherPage.request, 'inv-other');
  await otherPage.goto(url);
  await expect(otherPage.getByText(/not found/i).first()).toBeVisible();
  await other.close();
});
