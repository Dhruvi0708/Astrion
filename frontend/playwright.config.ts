import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run a real browser against the real frontend and backend.
 *
 * The backend needs PostgreSQL (ASTRION_DATABASE_URL) with migrations applied. By default Playwright
 * starts both servers; set E2E_REUSE_SERVERS=1 to use servers you already have running.
 */
const PYTHON = process.env.E2E_PYTHON ?? 'python';
const reuse = !process.env.CI || process.env.E2E_REUSE_SERVERS === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    {
      command: `${PYTHON} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: '../backend',
      url: 'http://127.0.0.1:8000/api/v1/health',
      reuseExistingServer: reuse,
      timeout: 60_000,
      env: { ASTRION_LOG_JSON: 'false', ASTRION_LOGIN_MAX_FAILURES: '50' },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
  ],
});
