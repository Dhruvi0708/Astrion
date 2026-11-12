import type {
  ApiErrorBody,
  AuthTokens,
  DependencyHealth,
  DocumentCreate,
  LoginInput,
  Page,
  RegisterInput,
  ServiceHealth,
  Source,
  SourceCreate,
  SourceDocument,
  User,
  Workspace,
  WorkspaceCreate,
} from './types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';

/** Sent on every cookie-bearing auth call; the API rejects those requests without it (CSRF guard). */
const CLIENT_HEADER = { 'X-Astrion-Client': 'web' };

type ErrorKind = 'network' | 'http';

/** Error raised for any failed API interaction. `kind` lets the UI distinguish outages from validation errors. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ErrorKind;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(opts: { message: string; status: number; code: string; kind: ErrorKind; details?: unknown; requestId?: string }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.kind = opts.kind;
    this.details = opts.details;
    this.requestId = opts.requestId;
  }

  /** True when the backend (or one of its dependencies) is unreachable rather than rejecting the request. */
  get isUnavailable() {
    return this.kind === 'network' || this.status === 502 || this.status === 503 || this.status === 504;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value as ApiErrorBody).error?.message === 'string';
}

/* -------------------------------------------------------------------------- */
/* Auth wiring — the auth store registers these so the client never imports it */
/* -------------------------------------------------------------------------- */

interface AuthHandlers {
  getAccessToken: () => string | null;
  /** Attempts a silent refresh; resolves to the new access token or null. */
  refresh: () => Promise<string | null>;
  /** Called when a request is rejected and refresh can't recover the session. */
  onSessionExpired: () => void;
}

let auth: AuthHandlers = {
  getAccessToken: () => null,
  refresh: async () => null,
  onSessionExpired: () => {},
};

export function configureAuth(handlers: AuthHandlers) {
  auth = handlers;
}

type Query = Record<string, string | number | undefined>;

interface RequestOptions extends RequestInit {
  query?: Query;
  /** Skip the Authorization header and the 401→refresh retry (auth endpoints themselves). */
  anonymous?: boolean;
  raw?: boolean;
}

async function send(path: string, init: RequestOptions, token: string | null): Promise<Response> {
  const { query, anonymous: _anonymous, raw: _raw, ...rest } = init;
  const params = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const isForm = typeof FormData !== 'undefined' && rest.body instanceof FormData;
  try {
    return await fetch(`${BASE_URL}${path}${params ? `?${params}` : ''}`, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(rest.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  } catch (cause) {
    throw new ApiError({ message: 'The ASTRION API could not be reached.', status: 0, code: 'network_error', kind: 'network', details: String(cause) });
  }
}

async function toError(response: Response): Promise<ApiError> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (isErrorBody(body)) {
    return new ApiError({
      message: body.error.message,
      status: response.status,
      code: body.error.code,
      kind: 'http',
      details: body.error.details,
      requestId: body.error.request_id,
    });
  }
  // The ASTRION API always answers with an error envelope. A bare failure means something in
  // between (dev proxy, gateway) could not reach it — treat that as an outage, not an app error.
  return new ApiError({
    message: 'The ASTRION API could not be reached.',
    status: response.status >= 500 ? 502 : response.status,
    code: 'upstream_unavailable',
    kind: response.status >= 500 ? 'network' : 'http',
  });
}

async function fetchWithAuth(path: string, init: RequestOptions): Promise<Response> {
  const token = init.anonymous ? null : auth.getAccessToken();
  let response = await send(path, init, token);
  if (response.status === 401 && !init.anonymous) {
    // The access token expired or was revoked: refresh once, then retry the original request.
    const fresh = await auth.refresh();
    if (fresh) response = await send(path, init, fresh);
    if (response.status === 401) auth.onSessionExpired();
  }
  return response;
}

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const response = await fetchWithAuth(path, init);
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // A dev proxy or static host may answer with HTML when the backend is absent; treat that as an outage.
    throw new ApiError({ message: 'The API returned an unexpected response.', status: 502, code: 'invalid_response', kind: 'http' });
  }
}

/** Downloads a protected file and returns it as a Blob (the Authorization header can't ride on a plain link). */
export async function requestBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetchWithAuth(path, {});
  if (!response.ok) throw await toError(response);
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return { blob: await response.blob(), filename: match ? decodeURIComponent(match[1]) : null };
}

const json = (value: unknown) => JSON.stringify(value);

export const api = {
  health: () => request<ServiceHealth>('/v1/health', { anonymous: true }),
  dependencyHealth: (name: 'postgres' | 'neo4j') => request<DependencyHealth>(`/v1/health/${name}`, { anonymous: true }),

  // Auth — the refresh token travels only as an httpOnly cookie the page can't read.
  register: (body: RegisterInput) => request<AuthTokens>('/v1/auth/register', { method: 'POST', body: json(body), headers: CLIENT_HEADER, anonymous: true }),
  login: (body: LoginInput) => request<AuthTokens>('/v1/auth/login', { method: 'POST', body: json(body), headers: CLIENT_HEADER, anonymous: true }),
  refresh: () => request<AuthTokens>('/v1/auth/refresh', { method: 'POST', headers: CLIENT_HEADER, anonymous: true }),
  logout: (accessToken: string) =>
    request<void>('/v1/auth/logout', { method: 'POST', headers: { ...CLIENT_HEADER, Authorization: `Bearer ${accessToken}` }, anonymous: true }),
  logoutAll: () => request<void>('/v1/auth/logout-all', { method: 'POST', headers: CLIENT_HEADER }),
  me: () => request<User>('/v1/auth/me'),

  listWorkspaces: (query: { limit?: number; offset?: number } = {}) => request<Page<Workspace>>('/v1/workspaces', { query }),
  getWorkspace: (id: string) => request<Workspace>(`/v1/workspaces/${id}`),
  createWorkspace: (body: WorkspaceCreate) => request<Workspace>('/v1/workspaces', { method: 'POST', body: json(body) }),

  listSources: (workspaceId: string, query: { limit?: number; offset?: number } = {}) =>
    request<Page<Source>>(`/v1/workspaces/${workspaceId}/sources`, { query }),
  getSource: (id: string) => request<Source>(`/v1/sources/${id}`),
  createSource: (workspaceId: string, body: SourceCreate) => request<Source>(`/v1/workspaces/${workspaceId}/sources`, { method: 'POST', body: json(body) }),

  listDocuments: (sourceId: string) => request<Page<SourceDocument>>(`/v1/sources/${sourceId}/documents`),
  createDocument: (sourceId: string, body: DocumentCreate) =>
    request<SourceDocument>(`/v1/sources/${sourceId}/documents`, { method: 'POST', body: json(body) }),
  uploadDocument: (sourceId: string, file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    return request<SourceDocument>(`/v1/sources/${sourceId}/documents/upload`, { method: 'POST', body: form });
  },
  downloadDocument: (documentId: string) => requestBlob(`/v1/documents/${documentId}/content`),
};

export const API_BASE_URL = BASE_URL;
