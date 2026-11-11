# ASTRION — The Living Intelligence Engine

ASTRION turns fragmented information into an interconnected, evolving knowledge universe: sources become documents, documents yield claims and evidence, claims connect into a traceable knowledge graph, and agents investigate that graph to surface contradictions, gaps and hypotheses.

**This repository is Phase 1: the product foundation.** It ships the full visual product (landing page, 3D universe, eight app environments), a real API for workspaces, sources and document metadata, and the data model the later phases need. It does **not** yet ingest files, extract knowledge, run agents or simulate. Every screen labels sample content and planned features as such.

| What works today | What is sample / planned |
|---|---|
| Workspaces — create, list, select (PostgreSQL) | Knowledge graph contents (sample “Coastal Resilience” graph) |
| Sources + document metadata — register, list, inspect | File upload, parsing, claim/evidence extraction |
| Live health checks: API, PostgreSQL, Neo4j | Multi-agent investigations (UI + data model only) |
| Interactive 3D hero, interactive graph explorer | Discovery engine (sample hypotheses, contradictions, gaps) |
| Command launcher, workspace selector, responsive shell | Simulation engine (transparent toy model, clearly labelled) |
| LLM + embedding provider abstractions (server-side) | Authentication (single-user dev mode) |

## Repository layout

```
Astrion/
├── frontend/          React 18 + TypeScript + Vite + Tailwind 3.4 + R3F
├── backend/           FastAPI + SQLAlchemy 2 + Alembic + Neo4j driver
├── docs/              Product, architecture, schema, design, API, roadmap, testing
└── docker-compose.yml Optional PostgreSQL + Neo4j for local development
```

## Prerequisites

- Node.js 20+ (verified with 24.13) and npm
- Python 3.11+ (verified with 3.13)
- PostgreSQL 14+ (verified with 18.6). Neo4j 5 is optional — without it the API reports `neo4j: not_configured` / `unavailable`.

## Quick start

### 1. Database

Use any PostgreSQL instance, or the compose file:

```bash
docker compose up -d postgres neo4j
```

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows (bash: source .venv/Scripts/activate) — macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # edit ASTRION_DATABASE_URL etc.
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API docs: http://127.0.0.1:8000/api/docs

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to `http://127.0.0.1:8000`.

## Environment variables

Backend (`backend/.env`, see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `ASTRION_ENVIRONMENT` | `development` | `development`, `test`, `staging`, `production` |
| `ASTRION_LOG_LEVEL` / `ASTRION_LOG_JSON` | `INFO` / `true` | Structured JSON logs to stdout |
| `ASTRION_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed origins |
| `ASTRION_DATABASE_URL` | `postgresql+psycopg://astrion:astrion@localhost:5432/astrion` | PostgreSQL (SQLAlchemy URL) |
| `ASTRION_NEO4J_URI` | *(empty = not configured)* | e.g. `bolt://localhost:7687` |
| `ASTRION_NEO4J_USER` / `ASTRION_NEO4J_PASSWORD` / `ASTRION_NEO4J_DATABASE` | `neo4j` / — / `neo4j` | Neo4j credentials |
| `ANTHROPIC_API_KEY` | — | Enables the Claude provider (server-side only) |
| `ASTRION_LLM_MODEL` | `claude-opus-5-5` | Model id for the LLM provider |
| `VOYAGE_API_KEY` / `ASTRION_EMBEDDING_MODEL` | — / `voyage-3.5` | Embedding provider |

Frontend (`frontend/.env`, see `frontend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | API base path or absolute URL |
| `ASTRION_API_PROXY_TARGET` | `http://127.0.0.1:8000` | Dev-server proxy target (never shipped to the browser) |

No secrets are read by, or bundled into, the frontend.

## Tests

```bash
cd backend && pytest                                   # SQLite, from model metadata
ASTRION_TEST_DATABASE_URL=postgresql+psycopg://astrion@127.0.0.1:5432/astrion_test pytest   # PostgreSQL via Alembic migrations
cd frontend && npm test && npm run typecheck && npm run build
```

See [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md).

## Documentation

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [System architecture](docs/SYSTEM_ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Frontend architecture](docs/FRONTEND_ARCHITECTURE.md)
- [API contract](docs/API_CONTRACT.md)
- [Development roadmap](docs/DEVELOPMENT_ROADMAP.md)
- [Testing strategy](docs/TESTING_STRATEGY.md)
