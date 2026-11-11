# Testing Strategy

## Layers

| Layer | Tool | Location | What it covers |
|---|---|---|---|
| Backend API | pytest + FastAPI TestClient | `backend/tests/test_health.py`, `test_workspaces.py`, `test_sources.py` | Every endpoint: success, validation (422 envelope), not-found, pagination bounds, request-id propagation, CORS preflight, dependency-down reporting |
| Data model | pytest + SQLAlchemy | `backend/tests/test_models.py` | Full provenance chain, `verified ⇒ verified_at` CHECK, confidence ranges, no self-loops, unique graph keys, enum validation, cascades, execution handoffs, scenario baselines |
| Config & providers | pytest | `backend/tests/test_config_and_providers.py` | Env parsing, secrets not leaked in repr/dump, null providers fail explicitly, Voyage provider (mock transport), graph vocabulary |
| Migrations | Alembic | run by the test fixture in PostgreSQL mode | `downgrade base` → `upgrade head` on every PostgreSQL test run; `alembic check` for drift |
| Frontend units | Vitest | `src/lib/api/client.test.ts`, `src/data/sample/sample-data.test.ts` | Error envelope parsing, outage detection, sample-data integrity (no dangling ids, nothing sample marked verified), deterministic layout, coverage gaps, toy model |
| Frontend routes | Vitest + Testing Library (jsdom) | `src/app/routes.test.tsx` | Every environment renders an `h1` and breadcrumb with the backend offline; sidebar links; landing CTAs; 404; backend-unavailable state |
| Types & build | `tsc -b`, `vite build` | — | Strict TypeScript; production bundle |
| Manual browser | Claude browser pane | — | 3D hero, graph interactions, forms against the live API, mobile layout, offline state |

## Running

```bash
# Backend (SQLite, fast)
cd backend && pytest
# Backend against PostgreSQL (uses real migrations)
ASTRION_TEST_DATABASE_URL=postgresql+psycopg://astrion@127.0.0.1:5432/astrion_test pytest
# Frontend
cd frontend && npm test && npm run typecheck && npm run build
```

The PostgreSQL test database is reset (`downgrade base` + `upgrade head`) at session start and tables are emptied before each test.

## Phase 1 results (2026-11-11)

| Suite | Result |
|---|---|
| Backend on SQLite | 42 passed |
| Backend on PostgreSQL 18.6 (via Alembic) | 42 passed |
| Alembic upgrade → downgrade → upgrade, `alembic check` | OK, no drift |
| Frontend Vitest | 28 passed |
| `tsc` strict | 0 errors |
| `vite build` | success; Three.js isolated in the lazy `HeroScene` chunk |

## Gaps / next steps
- No automated browser (Playwright) tests yet; WebGL rendering verified manually only.
- Neo4j only tested in "not configured" and "unreachable" modes (plus a fake client); add a containerised Neo4j job.
- Add CI and coverage reporting.
