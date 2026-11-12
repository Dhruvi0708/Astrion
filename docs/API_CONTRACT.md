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
`processing_status` stays `registered` — there is no processing pipeline yet. The internal `storage_key` is never returned.

## Not in v1 (intentionally)

No endpoints exist for parsing/extraction, claims, graph queries, investigations, agents, hypotheses or simulations. The UI for those areas uses labelled sample data. They will be added with their engines (see DEVELOPMENT_ROADMAP.md) rather than as placeholder endpoints.

The TypeScript mirror of this contract is `frontend/src/lib/api/types.ts`.
