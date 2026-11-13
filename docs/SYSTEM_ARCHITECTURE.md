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
 │  middleware: request-id + structured access log, CORS (credentials)  │
 │  api/v1 ── routers (health, auth, workspaces, sources/documents)     │
 │  deps ── get_current_user: Bearer JWT → live session → user           │
 │  services ── owner-scoped use-cases (no HTTP concerns)                │
 │  models ── SQLAlchemy 2 ORM     graph ── client + GraphRepository     │
 │  storage ── StorageBackend (local | S3)                               │
 │  ai ── LLMProvider / EmbeddingProvider (no silent fallback)           │
 └───────┬───────────────────────────────┬──────────────────┬───────────┘
         │ psycopg 3                     │ bolt              │ HTTPS (future)
         │   + files → local disk / S3   │                   │
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
| `app/core/security.py` | Argon2id hashing, JWT issue/verify (HS256 pinned), refresh-token generation and hashing. |
| `app/services/auth.py` | Register, login (rate-limited, timing-equalised), refresh rotation with reuse detection, logout / logout-all, session resolution. |
| `app/storage` | `StorageBackend` protocol, `LocalStorage`, `S3Storage`, upload validation. See [STORAGE.md](STORAGE.md). |
| `app/core/errors.py` | `AppError` hierarchy and handlers producing one error envelope for validation, HTTP, DB and unhandled errors. |
| `app/db` | Declarative base with naming conventions, UUID PKs, timestamps; engine/session factory. |
| `app/models` | ORM models (see DATABASE_SCHEMA.md). |
| `app/schemas` | Pydantic request/response models. |
| `app/services` | Use-cases; raise `AppError`s; no FastAPI imports. |
| `app/api/v1` | Thin routers; versioned under `/api/v1`. |
| `app/graph` | `Neo4jGraphClient` (driver, timeouts, health), `GraphRepository` (CRUD, constraints, transactions), vocabulary and PostgreSQL ↔ Neo4j key mapping. See [NEO4J.md](NEO4J.md). |
| `app/intelligence` | The Phase 2 engine: agent contracts and agents, structured-output LLM (`ClaudeStructuredLLM`, labelled `FixtureLLM`), text extraction, knowledge store and Neo4j sync, orchestrator, background runner. See [INTELLIGENCE_ENGINE.md](INTELLIGENCE_ENGINE.md). |
| `app/ai` | `LLMProvider` (Claude via the Anthropic SDK, adaptive thinking, streaming, **no silent fallback**, typed errors, recorded identity) and `EmbeddingProvider` (Voyage). See [AI_PROVIDERS.md](AI_PROVIDERS.md). |

## Request lifecycle

1. `RequestContextMiddleware` assigns/propagates a request id (ContextVar) and times the request.
2. `get_current_user` verifies the Bearer token and that its session is still live (protected routes).
3. Router validates input (Pydantic) → service performs the owner-scoped use-case in a session from `get_db`.
4. Errors become `{"error": {code, message, details, request_id}}` with the right status (404, 409, 422, 503, 500).
5. Access log line: `{"msg":"request","method","path","status","duration_ms","request_id"}`.

## Health model

| Endpoint | Meaning |
|---|---|
| `GET /api/v1/health` | Process is up. Does not touch dependencies. |
| `GET /api/v1/health/postgres` | Executes `SELECT 1`; returns `ok` + latency or `unavailable`. |
| `GET /api/v1/health/neo4j` | `not_configured` when no URI; otherwise verifies connectivity and runs `RETURN 1`. |

Dependency health endpoints always return 200 with a status field so dashboards can distinguish "API down" from "dependency down". Internal error text is never returned.

## AI integration

- Credentials are read from server environment variables only. The frontend never sees them.
- Agents call Claude (`claude-opus-5-5`, configurable) through `ClaudeStructuredLLM`, which uses streaming, adaptive thinking, an explicit `effort`, and JSON-schema structured outputs re-validated with Pydantic. There is no server-side fallback and no SDK retries. Refusals and truncation raise typed errors.
- Investigations run in a bounded thread pool inside the API process. State lives in PostgreSQL, so a restart marks in-flight runs `interrupted` and they can be resumed. Lifecycle, agents and guarantees: [INTELLIGENCE_ENGINE.md](INTELLIGENCE_ENGINE.md).

## Frontend

See FRONTEND_ARCHITECTURE.md. Key decisions: route-level code splitting. Three.js is loaded only by the landing hero and by the lazily imported investigation knowledge graph (`KnowledgeGraph3D`). The sample universe uses Canvas 2D with a precomputed d3-force layout. Running investigations are shown by polling their recorded state; the UI never animates activity that the server didn't record.

## Security

Authentication, authorization, CSRF protection and session handling are described in [SECURITY_AND_AUTH.md](SECURITY_AND_AUTH.md). CORS allows credentials only for `ASTRION_CORS_ORIGINS`; no secrets are in the client bundle; `.env` files are git-ignored.
