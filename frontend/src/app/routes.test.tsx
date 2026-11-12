import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes, routerFuture } from './router';
import { NAV_ITEMS } from './navigation';
import { useAuth } from '@/features/auth/store';

const USER = { id: 'u1', email: 'alice@example.org', display_name: 'Alice Example', created_at: '2026-01-01T00:00:00Z' };
const signIn = () => useAuth.setState({ status: 'authenticated', user: USER, accessToken: 'test-token', expiresAt: Date.now() + 60_000 });
const signOut = (status: 'anonymous' | 'expired' = 'anonymous') => useAuth.setState({ status, user: null, accessToken: null, expiresAt: null });

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Backend offline: every route must still render (with error states, not crashes).
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  signIn();
});

describe('routes', () => {
  it.each(NAV_ITEMS.map((i) => [i.to, i.label]))('%s renders its environment', async (path, label) => {
    renderAt(path);
    const heading = await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    expect(heading).toBeInTheDocument();
    // Breadcrumb reflects the active environment.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(label);
  });

  it('sidebar links every environment', async () => {
    renderAt('/app/overview');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    for (const item of NAV_ITEMS) expect(nav.querySelector(`a[href="${item.to}"]`)).not.toBeNull();
  });

  it('landing page renders headline and CTAs', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: /knowledge is not static/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /enter the universe/i })[0]).toHaveAttribute('href', '/app/universe');
    expect(screen.getByRole('link', { name: /explore the intelligence/i })).toHaveAttribute('href', '#architecture');
  });

  it('redirects anonymous visitors from protected routes to sign-in', async () => {
    signOut();
    renderAt('/app/sources');
    expect(await screen.findByRole('heading', { level: 1, name: /sign in/i }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('explains an expired session on the sign-in page', async () => {
    signOut('expired');
    renderAt('/app/universe');
    expect(await screen.findByText(/your session expired/i, undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows the signed-in user in the profile menu', async () => {
    renderAt('/app/overview');
    expect(await screen.findByRole('button', { name: /profile menu/i }, { timeout: 5000 })).toHaveTextContent('AE');
  });

  it('marks Sources data as offline when the backend is down', { timeout: 20000 }, async () => {
    renderAt('/app/sources');
    // The health check retries once before failing, so wait for the page's own error state first.
    await screen.findByText('Backend unavailable', undefined, { timeout: 8000 });
    const badge = await screen.findByTitle(/ASTRION API is unreachable/i, undefined, { timeout: 8000 });
    expect(badge).toHaveTextContent('Backend offline');
    expect(screen.queryByText('Live data')).not.toBeInTheDocument();
  });

  it('unknown routes show the 404 page', async () => {
    renderAt('/nowhere');
    expect(await screen.findByText(/hasn’t been mapped/i)).toBeInTheDocument();
  });

  it('shows backend-unavailable state when the API is down', async () => {
    renderAt('/app/sources');
    expect(await screen.findByText('Backend unavailable', undefined, { timeout: 5000 })).toBeInTheDocument();
  });
});
