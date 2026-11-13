# ASTRION — The Living Intelligence Engine

ASTRION turns fragmented information into an interconnected, evolving knowledge universe: sources become documents, documents yield claims and evidence, claims connect into a traceable knowledge graph, and agents investigate that graph to surface contradictions, gaps and hypotheses.

**Current state: Phase 2, the core intelligence engine.** Ask a question over your documents and seven agents (Orchestrator, Research, Knowledge, Hypothesis, Contradiction, Verification, Synthesis) produce evidence-checked claims, an evolving knowledge graph (PostgreSQL + Neo4j), hypotheses with a transparent confidence method, contradictions, verification verdicts and a cited report. Every step is recorded and resumable. The engine is in [docs/INTELLIGENCE_ENGINE.md](docs/INTELLIGENCE_ENGINE.md).

> **Not yet verified with real Claude output.** No API key was available while building Phase 2. Tests and the e2e flow use the deterministic *fixture* provider, which the UI always labels "not AI".

| What works today | What is sample / planned |
|---|---|
| Accounts, sessions, per-user workspaces, sources and document files; cross-user access blocked | Discovery Laboratory (sample hypotheses, gaps) |
| Investigations: create, run, cancel, resume after failure or restart, history, comparison | Simulation engine (transparent toy model, clearly labelled) |
| Text extraction (PDF, txt, md, csv, json, html) and verbatim-evidence claims | `.docx`/`.xlsx`, OCR, embeddings/semantic retrieval |
| Knowledge graph with entity dedup, relationship support, change log, Neo4j sync + consistency check | Human verification workflow for hypotheses |
| Workbench: live agent trace, claims, hypotheses, contradictions, 3D knowledge graph, cited report | Email verification, password reset, sharing / roles |

## Repository layout

```
Astrion/
├── frontend/            React 18 + TypeScript + Vite + Tailwind 3.4 + R3F; Vitest + Playwright
├── backend/             FastAPI + SQLAlchemy 2 + Alembic + Neo4j driver + storage; pytest
├── docs/                Product, architecture, security, storage, Neo4j, AI, schema, API, testing, roadmap
├── .github/workflows/   CI (lint, types, unit tests, PostgreSQL + Neo4j integration, migrations, Playwright)
└── docker-compose.yml   Optional PostgreSQL + Neo4j for local development
```

## Prerequisites

- Node.js 20+ (verified with 24.13), npm
- Python 3.11+ (verified with 3.13)
- PostgreSQL 14+ (verified with 18.6)
- Neo4j 5.x — optional (verified with 5.26.0 Community on Java 21). Without it the API reports `neo4j: not_configured`.

## Run it

### 1. Infrastructure
```bash
docker compose up -d postgres neo4j
```
(or point the env vars below at your own PostgreSQL / Neo4j — see [docs/NEO4J.md](docs/NEO4J.md))

### 2. Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows (Git Bash): source .venv/Scripts/activate
pip install -e ".[dev,s3]"
cp .env.example .env                 # then edit — see "Environment variables"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```
API docs: http://127.0.0.1:8000/api/docs · verify the AI model id (no tokens billed): `python -m app.ai.check`

Investigations need `ANTHROPIC_API_KEY`. For offline development without a key, run the API with `ASTRION_LLM_PROVIDER=fixture` (deterministic rules, labelled "not AI", refused outside development/test).

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 and create an account. The dev server proxies `/api` to `http://127.0.0.1:8000`, so the refresh cookie stays same-origin.

> Workspaces created in Phase 1 (before accounts existed) have no owner and are hidden. See [docs/SECURITY_AND_AUTH.md](docs/SECURITY_AND_AUTH.md#authorization) to assign them.

## Environment variables

All backend variables are documented in [`backend/.env.example`](backend/.env.example). The important ones:

| Variable | Default | Purpose |
|---|---|---|
| `ASTRION_ENVIRONMENT` | `development` | `development`, `test`, `staging`, `production` |
| `ASTRION_DATABASE_URL` | `postgresql+psycopg://astrion:astrion@localhost:5432/astrion` | PostgreSQL |
| `ASTRION_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Browser origins allowed (with credentials) |
| `ASTRION_JWT_SECRET` | random per process in dev | **Required (≥ 32 chars) outside development** |
| `ASTRION_COOKIE_SECURE` | `false` | **Must be `true` outside development** |
| `ASTRION_ACCESS_TOKEN_TTL_MINUTES` / `ASTRION_REFRESH_TOKEN_TTL_DAYS` | `15` / `14` | Token lifetimes |
| `ASTRION_NEO4J_URI` / `_USER` / `_PASSWORD` / `_DATABASE` | empty / `neo4j` / — / `neo4j` | Neo4j (empty URI = not configured) |
| `ASTRION_NEO4J_TIMEOUT_SECONDS` / `ASTRION_NEO4J_QUERY_TIMEOUT_SECONDS` | `3` / `10` | Connect and transaction timeouts |
| `ASTRION_STORAGE_BACKEND` | `local` | `local` or `s3` |
| `ASTRION_STORAGE_LOCAL_ROOT` | `./var/storage` | Local storage directory |
| `ASTRION_STORAGE_MAX_UPLOAD_MB` | `50` | Upload size limit |
| `ASTRION_S3_BUCKET` / `_ENDPOINT_URL` / `_REGION` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | — | S3-compatible storage |
| `ANTHROPIC_API_KEY` / `ASTRION_LLM_MODEL` | — / `claude-opus-5-5` | Claude provider (server-side only) |
| `ASTRION_LLM_FALLBACK_MODELS` | empty | Explicit fallback after refusals only; empty = never |
| `ASTRION_LLM_PROVIDER` | `anthropic` | `fixture` = deterministic rules for development/test (not AI) |
| `ASTRION_AGENT_*`, `ASTRION_MAX_*` | see `.env.example` | Retries, timeouts, parallelism and limits for investigations |
| `VOYAGE_API_KEY` / `ASTRION_EMBEDDING_MODEL` | — / `voyage-3.5` | Embeddings |

Frontend (`frontend/.env.example`): `VITE_API_BASE_URL` (default `/api`) and `ASTRION_API_PROXY_TARGET` (dev proxy target). No secrets are read by, or bundled into, the frontend.

## Tests

```bash
# Backend — fast (SQLite)
cd backend && pytest
# Backend — against real PostgreSQL (via Alembic migrations) and real Neo4j
ASTRION_TEST_DATABASE_URL=postgresql+psycopg://astrion:astrion@localhost:5432/astrion_test \
ASTRION_TEST_NEO4J_URI=bolt://localhost:7687 ASTRION_TEST_NEO4J_PASSWORD=<password> pytest
# Backend lint/format
ruff check . && ruff format --check .

# Frontend
cd frontend && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
# Browser tests (starts backend + frontend unless E2E_REUSE_SERVERS=1)
npx playwright install chromium
npm run e2e
```

Details: [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) · CI: [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Documentation

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md) · [Development roadmap](docs/DEVELOPMENT_ROADMAP.md)
- [System architecture](docs/SYSTEM_ARCHITECTURE.md) · [Frontend architecture](docs/FRONTEND_ARCHITECTURE.md) · [Design system](docs/DESIGN_SYSTEM.md)
- [Authentication, authorization & security](docs/SECURITY_AND_AUTH.md)
- [Intelligence engine](docs/INTELLIGENCE_ENGINE.md) · [Document storage](docs/STORAGE.md) · [Neo4j](docs/NEO4J.md) · [AI providers](docs/AI_PROVIDERS.md)
- [Database schema](docs/DATABASE_SCHEMA.md) · [API contract](docs/API_CONTRACT.md)
- [Testing strategy & CI](docs/TESTING_STRATEGY.md)
