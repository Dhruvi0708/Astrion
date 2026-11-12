import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = 'e2e orbital lattice 2026';
const CLIENT = { 'X-Astrion-Client': 'web' };

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Registers through the API. The refresh cookie lands in the page's context, so the next
 * navigation restores the session exactly as a returning user would.
 */
export async function registerViaApi(request: APIRequestContext, tag: string, name = 'E2E Researcher') {
  const email = uniqueEmail(tag);
  const res = await request.post('/api/v1/auth/register', { data: { email, password: PASSWORD, display_name: name }, headers: CLIENT });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { email, token: body.access_token as string, userId: body.user.id as string };
}

export async function api(request: APIRequestContext, token: string, method: 'get' | 'post', path: string, data?: unknown) {
  return request[method](`/api/v1${path}`, { data, headers: { Authorization: `Bearer ${token}` } });
}

export async function signedIn(page: Page, tag: string) {
  const user = await registerViaApi(page.request, tag);
  return user;
}
