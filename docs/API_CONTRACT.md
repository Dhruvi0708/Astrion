# API Contract — v1

Base path: `/api/v1`. JSON only. Interactive docs: `/api/docs` (OpenAPI at `/api/openapi.json`).

## Conventions

- IDs are UUIDs; timestamps are ISO-8601 with timezone.
- Every response carries `X-Request-ID` (client-supplied value is echoed if ≤ 64 printable ASCII chars).
- Pagination: `?limit=1..100` (default 50) and `?offset>=0`; responses are `Page<T> = { items, total, limit, offset }`, newest first.
- Errors always use the envelope:

```json
{ "error": { "code": "not_found", "message": "Workspace … was not found.", "details": null, "request_id": "…" } }
```

| Status | `code` | When |
|---|---|---|
| 404 | `not_found` | Unknown resource or route |
| 405 | `method_not_allowed` | |
| 409 | `conflict` | Integrity violation |
| 422 | `validation_error` | Body/query/path invalid; `details` = `[{loc, msg, type}]` |
| 503 | `database_unavailable` | PostgreSQL unreachable during a request |
| 500 | `database_error` / `internal_error` | Unexpected failure (no internals leaked) |

## Health

| Method & path | Response |
|---|---|
| `GET /health` | `{ status: "ok", service: "astrion-api", version, environment, timestamp }` |
| `GET /health/postgres` | `{ name: "postgres", status: "ok" \| "unavailable", latency_ms, detail }` |
| `GET /health/neo4j` | `{ name: "neo4j", status: "ok" \| "unavailable" \| "not_configured", latency_ms, detail }` |

## Workspaces

### `POST /workspaces` → 201 `Workspace`
```json
{ "name": "Coastal Resilience Review", "description": "optional, ≤ 2000 chars" }
```
`name` is trimmed, 1–120 chars. `slug` is generated and made unique (`name`, `name-2`, …).

### `GET /workspaces` → `Page<Workspace>`
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

## Documents (metadata only in Phase 1)

### `POST /sources/{source_id}/documents` → 201 `Document` | 404
```json
{ "title": "flood-assessment.pdf", "media_type": "application/pdf", "byte_size": 2048, "content_hash": "<sha256 hex>", "storage_uri": "optional" }
```
### `GET /sources/{source_id}/documents` → `Page<Document>` | 404
### `GET /documents/{id}` → `Document` | 404

```ts
Document = { id, workspace_id, source_id, title, media_type, byte_size, content_hash, storage_uri,
             processing_status: "registered" | "queued" | "processing" | "processed" | "failed", created_at, updated_at }
```
Phase 1 never changes `processing_status` from `registered` — there is no processing pipeline yet.

## Not in v1 (intentionally)

No endpoints exist for upload, extraction, claims, graph queries, investigations, agents, hypotheses or simulations. The UI for those areas uses labelled sample data. They will be added with their engines (see DEVELOPMENT_ROADMAP.md) rather than as placeholder endpoints.

The TypeScript mirror of this contract is `frontend/src/lib/api/types.ts`.
