# Testing Strategy & CI

## Layers

| Layer | Tool | Location | Covers |
|---|---|---|---|
| API | pytest + TestClient | `backend/tests/test_health.py`, `test_workspaces.py`, `test_sources.py` | Endpoints, validation envelope, pagination, request ids, CORS, dependency-down reporting |
| Auth | pytest | `backend/tests/test_auth.py` | Argon2id storage, cookie flags, case-insensitive email, weak passwords, generic login errors, rate limit, CSRF header, tampered / `alg=none` / expired / wrong-audience tokens, refresh rotation + reuse detection, logout & logout-all invalidating access tokens immediately |
| Authorization | pytest | `backend/tests/test_authorization.py` | Owner-scoped lists; 404 for every foreign workspace/source/document/download; client-supplied `owner_id` ignored; legacy unowned workspaces hidden; per-owner slugs |
| Storage | pytest + moto | `backend/tests/test_storage.py` | Upload/download round trip, filename sanitisation, type allow-list, content sniffing, size limit, traversal keys, key stability, Windows path length, storage failure → 503, S3 via moto |
| Neo4j | pytest, **real server** | `backend/tests/test_neo4j_integration.py` | Health, wrong password, unreachable timeout, schema idempotency + constraints, node/relationship CRUD, workspace isolation, uniqueness, transaction rollback, Cypher-injection rejection. Skipped unless `ASTRION_TEST_NEO4J_URI` is set — never mocked. |
| AI provider | pytest, fake SDK client | `backend/tests/test_llm_provider.py` | No `fallbacks` sent, refusal raised, explicit fallback recorded, errors not treated as refusals, typed errors keep status/type/cause, model verification |
| Data model | pytest | `backend/tests/test_models.py` | Provenance chain, CHECK constraints, cascades |
| Migrations | Alembic | test fixture (PostgreSQL mode) + CI | `downgrade base` → `upgrade head` every PostgreSQL run; `alembic check` for drift |
| Frontend units | Vitest | `src/lib/api/client.test.ts`, `src/data/sample/*.test.ts`, `src/features/auth/auth.test.ts` | Error envelopes, outage detection, bearer + single refresh-and-retry, session-expiry callback, CSRF header on auth calls, open-redirect protection, sample-data integrity |
| Frontend routes | Vitest + Testing Library | `src/app/routes.test.tsx` | Every environment renders when signed in; anonymous → sign-in; expired-session message; profile shows user; Sources badge says "Backend offline" when the API is down |
| Browser | Playwright (Chromium) | `frontend/e2e/*.spec.ts` | Landing, sidebar navigation, UI registration/sign-out/sign-in with return path, wrong password, protected routes, session restore on reload and loss on cookie clear, workspace creation, source registration with validation, upload + download, disallowed upload, **cross-user rejection (two browser contexts)**, backend-offline handling, mobile drawer + no horizontal scroll |
| Lint / format | ESLint 9 + Prettier 3, Ruff | — | Enforced in CI |

## Running locally

```bash
# Backend
cd backend
ruff check . && ruff format --check .
pytest                                                    # SQLite; Neo4j tests skip
ASTRION_TEST_DATABASE_URL=postgresql+psycopg://astrion:astrion@localhost:5432/astrion_test \
ASTRION_TEST_NEO4J_URI=bolt://localhost:7687 ASTRION_TEST_NEO4J_PASSWORD=<password> pytest

# Frontend
cd frontend
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
npx playwright install chromium
npm run e2e                        # starts backend (needs ASTRION_DATABASE_URL) + Vite
E2E_REUSE_SERVERS=1 npm run e2e    # use servers that are already running
```

The backend-offline browser tests simulate the outage by aborting `/api/v1/*` requests in the browser; the backend process keeps running.

## CI (`.github/workflows/ci.yml`)

| Job | Steps |
|---|---|
| `frontend` | `npm ci`, ESLint, Prettier check, `tsc`, Vitest, production build |
| `backend` | Services: PostgreSQL 16, Neo4j 5.26 Community. Ruff lint + format check, Alembic upgrade → downgrade → upgrade → check, pytest on SQLite, then pytest on PostgreSQL + Neo4j with **no skips allowed** |
| `e2e` | Services: PostgreSQL 16. Migrations, Playwright Chromium; HTML report uploaded on failure |

The workflow has **not yet run on GitHub** (nothing from this branch has been pushed).

## Phase 1.5 results (2026-11-12, local Windows 11)

| Suite | Result |
|---|---|
| Ruff lint / format | pass / pass |
| Backend on SQLite | 102 passed, 15 skipped (the Neo4j integration tests — no server in that mode) |
| Backend on PostgreSQL 18.6 + Neo4j 5.26.0 | **117 passed, 0 skipped** |
| Alembic `0001`→`0002` round trip, `alembic check` | pass, no drift |
| ESLint / Prettier / `tsc` | pass / pass / pass |
| Vitest | 42 passed |
| `vite build` | success; Three.js only in the lazy `HeroScene` chunk |
| Playwright (desktop + mobile Chromium) | 14 passed, twice in a row |

Bugs these suites caught during Phase 1.5 and that were fixed: Neo4j driver rejecting `Query` objects inside transactions (real-server tests); storage paths exceeding the Windows 260-character limit and the resulting unhandled 500 (Playwright upload test); a jsdom/Node `AbortSignal` mismatch in router tests (test-only shim).

## Gaps
- CI unverified until pushed.
- S3 backend tested against moto, not a real bucket.
- Claude model id not checked against the live API (no key available).
- Playwright runs Chromium only.
