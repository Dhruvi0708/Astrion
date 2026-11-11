# System Architecture

## Overview

```
 Browser ──────────────────────────────────────────────────────────────┐
 │ React SPA (Vite)                                                    │
 │  ├─ Landing (R3F 3D hero, lazy)                                     │
 │  ├─ App shell + 8 environments                                       │
 │  └─ Typed API client ── TanStack Query                               │
 └──────────────┬───────────────────────────────────────────────────────┘
                │  HTTPS  /api/v1/*  (JSON, error envelope, X-Request-ID)
 ┌──────────────▼───────────────────────────────────────────────────────┐
 │ FastAPI                                                              │
 │  middleware: request-id + structured access log, CORS                │
 │  api/v1 ── routers (health, workspaces, sources)                     │
 │  services ── use-cases (no HTTP concerns)                            │
 │  models ── SQLAlchemy 2 ORM          graph ── GraphClient protocol   │
 │  ai ── LLMProvider / EmbeddingProvider protocols                     │
 └───────┬───────────────────────────────┬──────────────────┬───────────┘
         │ psycopg 3                     │ bolt              │ HTTPS (future)
 ┌───────▼────────┐             ┌────────▼───────┐   ┌──────▼──────────────┐
 │ PostgreSQL     │             │ Neo4j          │   │ Anthropic (Claude)   │
 │ app + metadata │◄─graph_key─►│ graph topology │   │ Voyage (embeddings)  │
 │ + provenance   │             │ + traversal    │   └──────────────────────┘
 └────────────────┘             └────────────────┘
```

## Responsibilities

| Store | Source of truth for |
|---|---|
| **PostgreSQL** | Users, workspaces, sources, documents, claims, evidence, investigations, hypotheses, agent executions, scenarios, snapshots — and the *registry* of graph elements (identity, status, provenance). |
| **Neo4j** | Graph topology: which entities exist as nodes and how they relate; traversal, path finding, neighbourhood queries. |

The two are joined by `graph_key`: every Neo4j node/relationship has a `key` property that equals `graph_entities.graph_key` / `graph_relationships.graph_key` within a workspace. Postgres answers "*why* do we believe this edge exists?" (evidence → claim → document → source). Neo4j answers "*what* is connected to what?".

## Backend modules

| Module | Contents |
|---|---|
| `app/core/config.py` | Typed settings from env (`pydantic-settings`); secrets as `SecretStr`. |
| `app/core/logging.py`, `middleware.py` | JSON logs with request id; access log per request; `X-Request-ID` echoed. |
| `app/core/errors.py` | `AppError` hierarchy and handlers producing one error envelope for validation, HTTP, DB and unhandled errors. |
| `app/db` | Declarative base with naming conventions, UUID PKs, timestamps; engine/session factory. |
| `app/models` | ORM models (see DATABASE_SCHEMA.md). |
| `app/schemas` | Pydantic request/response models. |
| `app/services` | Use-cases; raise `AppError`s; no FastAPI imports. |
| `app/api/v1` | Thin routers; versioned under `/api/v1`. |
| `app/graph` | `GraphClient` protocol, `Neo4jGraphClient`, `UnconfiguredGraphClient`; label/relationship vocabulary. |
| `app/ai` | `LLMProvider` (Claude via the Anthropic SDK, adaptive thinking, streaming, server-side fallback) and `EmbeddingProvider` (Voyage over HTTP), plus `Null*` providers that fail explicitly when unconfigured. |

## Request lifecycle

1. `RequestContextMiddleware` assigns/propagates a request id (ContextVar) and times the request.
2. Router validates input (Pydantic) → service performs the use-case in a session from `get_db`.
3. Errors become `{"error": {code, message, details, request_id}}` with the right status (404, 409, 422, 503, 500).
4. Access log line: `{"msg":"request","method","path","status","duration_ms","request_id"}`.

## Health model

| Endpoint | Meaning |
|---|---|
| `GET /api/v1/health` | Process is up. Does not touch dependencies. |
| `GET /api/v1/health/postgres` | Executes `SELECT 1`; returns `ok` + latency or `unavailable`. |
| `GET /api/v1/health/neo4j` | `not_configured` when no URI; otherwise verifies connectivity and runs `RETURN 1`. |

Dependency health endpoints always return 200 with a status field so dashboards can distinguish "API down" from "dependency down". Internal error text is never returned.

## AI integration (foundation only)

- Credentials are read from server environment variables only. The frontend never sees them.
- The Claude provider uses model `claude-opus-5-5` (configurable), adaptive thinking with an explicit `effort`, streams responses, checks `stop_reason == "refusal"`, and opts into the server-side fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).
- Nothing in Phase 1 calls either provider; they exist so Phase 2 extraction can depend on interfaces, not SDKs.

## Frontend

See FRONTEND_ARCHITECTURE.md. Key decisions: route-level code splitting; the Three.js bundle is loaded only by the hero; graph rendering uses Canvas 2D with a precomputed d3-force layout and an on-demand animation loop.

## Security notes (Phase 1)

- No authentication yet — the API must not be exposed publicly in this state.
- CORS restricted to configured origins; no credentials.
- No secrets in the client bundle; `.env` files are git-ignored.
