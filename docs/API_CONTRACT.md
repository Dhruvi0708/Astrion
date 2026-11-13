# API Contract — v1

Base path: `/api/v1`. JSON only. Interactive docs: `/api/docs` (OpenAPI at `/api/openapi.json`).

## Conventions

- IDs are UUIDs; timestamps are ISO-8601 with timezone.
- Every response carries `X-Request-ID` (client-supplied value is echoed if ≤ 64 printable ASCII chars).
- Pagination: `?limit=1..100` (default 50) and `?offset>=0`; responses are `Page<T> = { items, total, limit, offset }`, newest first.
- **Authentication:** every endpoint except `/health*` and `/auth/{register,login,refresh}` requires `Authorization: Bearer <access_token>`. Missing/invalid/expired → `401` with `WWW-Authenticate: Bearer`.
- **Authorization:** resources are visible only to the owner of their workspace. Anything else is reported as `404` (never `403`) so existence isn't disclosed.
- Errors always use the envelope:

```json
{ "error": { "code": "not_found", "message": "Workspace … was not found.", "details": null, "request_id": "…" } }
```

| Status | `code` | When |
|---|---|---|
| 401 | `unauthorized` | Missing, invalid, expired or revoked credentials |
| 403 | `forbidden` | Cookie-bearing auth call without the `X-Astrion-Client` header |
| 404 | `not_found` | Unknown resource or route, **or a resource owned by another user** |
| 405 | `method_not_allowed` | |
| 409 | `conflict` | Integrity violation |
| 413 | `payload_too_large` | Upload exceeds `ASTRION_STORAGE_MAX_UPLOAD_MB` |
| 415 | `unsupported_media_type` | Upload extension/type not allowed, or content doesn't match |
| 422 | `validation_error` | Body/query/path invalid; `details` = `[{loc, msg, type}]` |
| 429 | `too_many_requests` | Too many failed sign-ins |
| 503 | `database_unavailable` / `service_unavailable` | PostgreSQL or file storage unreachable |
| 500 | `database_error` / `internal_error` | Unexpected failure (no internals leaked) |

## Health

| Method & path | Response |
|---|---|
| `GET /health` | `{ status: "ok", service: "astrion-api", version, environment, timestamp }` |
| `GET /health/postgres` | `{ name: "postgres", status: "ok" \| "unavailable", latency_ms, detail }` |
| `GET /health/neo4j` | `{ name: "neo4j", status: "ok" \| "unavailable" \| "not_configured", latency_ms, detail }` |

## Auth

The refresh token travels only in the httpOnly cookie `astrion_refresh` (path `/api/v1/auth`). Endpoints marked 🍪 read or set it and require the header `X-Astrion-Client: web`.

| Method & path | Body | Response |
|---|---|---|
| 🍪 `POST /auth/register` | `{ email, password (12–256), display_name }` | 201 `TokenResponse` + cookie · 409 if the email exists (case-insensitive) |
| 🍪 `POST /auth/login` | `{ email, password }` | 200 `TokenResponse` + cookie · 401 (same message for unknown email and wrong password) · 429 |
| 🍪 `POST /auth/refresh` | — (cookie) | 200 `TokenResponse` + rotated cookie · 401 (cookie cleared) |
| 🍪 `POST /auth/logout` | — (Bearer) | 204, current session family revoked, cookie cleared |
| 🍪 `POST /auth/logout-all` | — (Bearer) | 204, every session of the user revoked |
| `GET /auth/me` | — (Bearer) | `User` |

```ts
TokenResponse = { access_token, token_type: "bearer", expires_in /* seconds */, user: User }
User = { id, email, display_name, created_at }
```

## Workspaces

### `POST /workspaces` → 201 `Workspace`
```json
{ "name": "Coastal Resilience Review", "description": "optional, ≤ 2000 chars" }
```
`name` is trimmed, 1–120 chars. The owner is always the authenticated user (any `owner_id` in the body is ignored). `slug` is unique **per owner** (`name`, `name-2`, …).

### `GET /workspaces` → `Page<Workspace>` (your workspaces only)
### `GET /workspaces/{id}` → `Workspace` | 404

```ts
Workspace = { id, name, slug, description, status: "active" | "archived", source_count, created_at, updated_at }
```

## Sources

### `POST /workspaces/{workspace_id}/sources` → 201 `Source` | 404
```json
{
  "title": "Regional Flood Assessment",
  "source_type": "paper | report | dataset | article | document | web | other",
  "uri": "https://… (optional, http/https)",
  "citation": "optional, ≤ 2000",
  "authors": ["optional", "…"],
  "published_on": "YYYY-MM-DD (optional)",
  "description": "optional, ≤ 5000"
}
```
### `GET /workspaces/{workspace_id}/sources` → `Page<Source>` | 404
### `GET /sources/{id}` → `Source` | 404

```ts
Source = { id, workspace_id, title, source_type, uri, citation, authors: string[], published_on, description,
           status: "registered" | "archived", document_count, created_at, updated_at }
```

## Documents

### `POST /sources/{source_id}/documents` → 201 `Document` | 404
```json
{ "title": "flood-assessment.pdf", "media_type": "application/pdf", "byte_size": 2048, "content_hash": "<sha256 hex>", "storage_uri": "optional" }
```
### `POST /sources/{source_id}/documents/upload` → 201 `Document` | 404 | 413 | 415 | 503
`multipart/form-data` with `file` (required) and `title` (optional). Validated, hashed and stored — **not parsed**. See [STORAGE.md](STORAGE.md).

### `GET /documents/{id}/content` → file stream | 404
Owner-only download. `Content-Disposition: attachment`, `nosniff`, sandbox CSP. 404 for metadata-only documents.

### `GET /sources/{source_id}/documents` → `Page<Document>` | 404
### `GET /documents/{id}` → `Document` | 404

```ts
Document = { id, workspace_id, source_id, title, media_type, byte_size, content_hash, storage_uri,
             original_filename, storage_backend, has_file /* true when ASTRION stores the file */,
             processing_status: "registered" | "queued" | "processing" | "processed" | "failed", created_at, updated_at }
```
`processing_status` moves to `processed` (or `failed` with a reason) when an investigation extracts the document's text. The internal `storage_key` is never returned.

### `GET /workspaces/{workspace_id}/documents` → `Page<Document>` | 404
All documents in a workspace (used to choose an investigation's scope).

## Intelligence (Phase 2)

All routes are owner-scoped: another user's investigation, workspace or entity is a 404. See [INTELLIGENCE_ENGINE.md](INTELLIGENCE_ENGINE.md) for semantics. Types are mirrored in `frontend/src/lib/api/intelligence-types.ts`.

| Method & path | Result |
|---|---|
| `GET /intelligence/status` | `{configured, provider, model, is_fixture, neo4j_configured, detail}`. Which provider would run investigations. |
| `POST /workspaces/{ws}/investigations` | 201 `Investigation`. Body `{title, question (≥10 chars), document_ids[]}`; empty `document_ids` = all workspace documents; documents from other workspaces → 404. |
| `GET /workspaces/{ws}/investigations` | `Page<Investigation>`, newest first. |
| `GET /workspaces/{ws}/investigations/compare?ids=a,b` | Side-by-side status, answer status, hypotheses and shared entities (2–5 ids). |
| `GET /investigations/{id}` · `/status` | `InvestigationDetail`: the investigation plus `plan`, per-stage `progress` for the current run, `counts`, `can_start`/`can_resume`/`can_cancel`. Poll `/status` while `queued`/`running`/`cancelling`. |
| `POST /investigations/{id}/start` | 202. Starts a new run (from draft, completed, failed, cancelled or interrupted). 409 while active; **503 `llm_unavailable`** when no provider is configured. |
| `POST /investigations/{id}/resume` | 202. Continues the current run from `failed`/`interrupted`, reusing succeeded steps. 409 otherwise. |
| `POST /investigations/{id}/cancel` | 202. Queued → `cancelled`; running → `cancelling` → `cancelled` at the next step boundary. 409 when nothing is running. |
| `GET /investigations/{id}/executions` | Every agent execution (all runs and attempts): step key, role, status, attempt, parent, `depends_on`, input, output (`result`, `notes`), provider, requested/served model, request id, tokens, estimated cost, duration, error. |
| `GET /investigations/{id}/claims` | Claims found by this investigation, each with subject entity, document, source and evidence (`quote`, chunk `locator`). |
| `GET /investigations/{id}/hypotheses` | Statement, rationale, test plan, status, confidence + `confidence_method` (inputs and components), supporting/opposing claim ids, latest verification. |
| `GET /investigations/{id}/contradictions` | Both claims with evidence, kind, genuine?, severity, explanation, verification. |
| `GET /investigations/{id}/verifications` | Verdict, reasoning, issues, missing evidence per hypothesis/contradiction. |
| `GET /investigations/{id}/reports` | One report per completed run, newest first. `content` includes findings citing claim refs and `citations[ref]` = claim → evidence → document → source, plus `generated_by.is_fixture`. |
| `GET /investigations/{id}/graph-changes` | The knowledge-graph change log written by this investigation. |
| `GET /workspaces/{ws}/graph?investigation_id&include_claims&limit` | `{source: "neo4j" \| "postgres", fallback_reason, nodes[], edges[]}`. Read from Neo4j when available, otherwise from the PostgreSQL registry (and says so). |
| `GET /workspaces/{ws}/graph/entities/{entity_id}` | Entity with aliases, mentions, claims (with evidence and source) and relationships (with supporting claim ids). |
| `GET /workspaces/{ws}/graph/consistency` | PostgreSQL vs Neo4j: counts and missing/orphaned keys, `consistent`. |

## Not in v1 (intentionally)

No endpoints exist for simulations, human verification of hypotheses, or editing extracted knowledge. They will be added with their features rather than as placeholder endpoints.

The TypeScript mirror of this contract is `frontend/src/lib/api/types.ts`.
