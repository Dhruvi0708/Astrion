import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

const respond = (status: number, body: unknown, raw = false) =>
  vi.fn().mockImplementation(async () => new Response(raw ? (body as string) : JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', respond(200, { status: 'ok', service: 'astrion-api' }));
    await expect(api.health()).resolves.toMatchObject({ status: 'ok' });
  });

  it('surfaces the error envelope', async () => {
    vi.stubGlobal('fetch', respond(404, { error: { code: 'not_found', message: 'Workspace x was not found.', request_id: 'r1' } }));
    const err = (await api.getWorkspace('x').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('not_found');
    expect(err.requestId).toBe('r1');
    expect(err.isUnavailable).toBe(false);
  });

  it('treats network failures as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = (await api.health().catch((e) => e)) as ApiError;
    expect(err.kind).toBe('network');
    expect(err.isUnavailable).toBe(true);
  });

  it('treats a bare proxy 500 as unavailable', async () => {
    vi.stubGlobal('fetch', respond(500, '', true));
    const err = (await api.listWorkspaces().catch((e) => e)) as ApiError;
    expect(err.isUnavailable).toBe(true);
  });

  it('treats HTML success responses as invalid', async () => {
    vi.stubGlobal('fetch', respond(200, '<!doctype html>', true));
    await expect(api.health()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('sends JSON bodies and query parameters', async () => {
    const fetchMock = respond(201, { id: '1' });
    vi.stubGlobal('fetch', fetchMock);
    await api.createWorkspace({ name: 'W' });
    await api.listSources('ws', { limit: 5 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ name: 'W' }) });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/workspaces/ws/sources?limit=5');
  });
});
