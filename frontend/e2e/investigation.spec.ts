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
Marine heatwaves cause coral bleaching in shallow lagoons, according to the review team.
Ocean Warming increases Coral Bleaching on shallow reef flats.`;

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

  // Phase 3: the run explains how it planned itself, and the workspace shows cross-investigation insights.
  await page.getByRole('radio', { name: 'Planning & next steps' }).click();
  await expect(page.getByTestId('stop-reason')).toContainText('Stopped because');
  await expect(page.getByTestId('next-step').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Sources' }).click();
  await expect(page.getByTestId('sources')).toContainText('These scores describe sources, not claims');
  const workbench = page.url();
  await page.goto('/app/discovery');
  await expect(page.getByTestId('insights')).toBeVisible();
  await page.goto(workbench);

  // Cockpit: one card per agent, from recorded executions.
  await page.getByRole('radio', { name: /^Agent activity/ }).click();
  await expect(page.locator('[data-testid="agent-card"][data-role="synthesis"]')).toHaveAttribute('data-status', 'succeeded');

  // Full report and Markdown export.
  await page.goto(`${workbench}/report`);
  await expect(page.getByRole('heading', { name: /Conclusions/ })).toBeVisible();
  await expect(page.getByTestId('report-relationships')).toContainText('Ocean Warming — influences → Coral Bleaching');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown' }).click();
  expect((await download).suggestedFilename()).toBe('astrion-warming-and-bleaching-run1.md');

  // Dashboard numbers, explorer, and a deep link from an entity into the graph.
  await page.goto('/app/overview');
  await expect(page.getByTestId('stat-Completed')).toContainText('1');
  await page.goto('/app/explorer?tab=evidence');
  await expect(page.getByTestId('explorer-evidence').filter({ hasText: 'survey.txt' }).first()).toBeVisible();
  await page.goto('/app/explorer');
  await page.getByTestId('entities-table').getByRole('link').first().click();
  await expect(page.getByTestId('entity-inspector')).toContainText('Claims and evidence');
  await page.getByRole('button', { name: 'Expand connections', exact: true }).first().click();
  await page.goto(workbench);

  // Workspace isolation: another user gets "not found" for the same URL.
  const url = page.url();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await registerViaApi(otherPage.request, 'inv-other');
  await otherPage.goto(url);
  await expect(otherPage.getByText(/not found/i).first()).toBeVisible();
  await other.close();
});
