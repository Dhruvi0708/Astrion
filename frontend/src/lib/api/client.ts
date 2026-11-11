import type {
  ApiErrorBody,
  DependencyHealth,
  DocumentCreate,
  Page,
  ServiceHealth,
  Source,
  SourceCreate,
  SourceDocument,
  Workspace,
  WorkspaceCreate,
} from './types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';

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
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string'
  );
}

type Query = Record<string, string | number | undefined>;

export async function request<T>(path: string, init: RequestInit & { query?: Query } = {}): Promise<T> {
  const { query, ...rest } = init;
  const params = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const url = `${BASE_URL}${path}${params ? `?${params}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
    });
  } catch (cause) {
    throw new ApiError({
      message: 'The ASTRION API could not be reached.',
      status: 0,
      code: 'network_error',
      kind: 'network',
      details: String(cause),
    });
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new ApiError({
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
    throw new ApiError({
      message: 'The ASTRION API could not be reached.',
      status: response.status >= 500 ? 502 : response.status,
      code: 'upstream_unavailable',
      kind: response.status >= 500 ? 'network' : 'http',
    });
  }

  // A dev proxy or static host may answer with HTML when the backend is absent; treat that as an outage.
  if (text && typeof body === 'string') {
    throw new ApiError({ message: 'The API returned an unexpected response.', status: 502, code: 'invalid_response', kind: 'http' });
  }
  return body as T;
}

const json = (value: unknown) => JSON.stringify(value);

export const api = {
  health: () => request<ServiceHealth>('/v1/health'),
  dependencyHealth: (name: 'postgres' | 'neo4j') => request<DependencyHealth>(`/v1/health/${name}`),

  listWorkspaces: (query: { limit?: number; offset?: number } = {}) => request<Page<Workspace>>('/v1/workspaces', { query }),
  getWorkspace: (id: string) => request<Workspace>(`/v1/workspaces/${id}`),
  createWorkspace: (body: WorkspaceCreate) => request<Workspace>('/v1/workspaces', { method: 'POST', body: json(body) }),

  listSources: (workspaceId: string, query: { limit?: number; offset?: number } = {}) =>
    request<Page<Source>>(`/v1/workspaces/${workspaceId}/sources`, { query }),
  getSource: (id: string) => request<Source>(`/v1/sources/${id}`),
  createSource: (workspaceId: string, body: SourceCreate) =>
    request<Source>(`/v1/workspaces/${workspaceId}/sources`, { method: 'POST', body: json(body) }),

  listDocuments: (sourceId: string) => request<Page<SourceDocument>>(`/v1/sources/${sourceId}/documents`),
  createDocument: (sourceId: string, body: DocumentCreate) =>
    request<SourceDocument>(`/v1/sources/${sourceId}/documents`, { method: 'POST', body: json(body) }),
};

export const API_BASE_URL = BASE_URL;
