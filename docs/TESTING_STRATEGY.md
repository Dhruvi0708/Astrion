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
| Intelligence units | pytest | `backend/tests/test_intelligence_units.py` | Strict JSON schemas for every contract, verbatim-quote and orphan filtering, verification gap filling, uncited-finding removal, confidence formula, text extraction/chunking, fixture refused in production, Claude structured-output request/usage/refusal/truncation/schema errors (fake SDK client) |
| Intelligence pipeline | pytest + TestClient, inline runner | `backend/tests/test_intelligence_pipeline.py` | Full run via API with the fixture provider: step order and dependencies, parallel research (barrier), retry with backoff, exhausted retries → failed, non-retryable failure → resume reusing succeeded steps, timeout, cancel, restart recovery, Neo4j failure → failed run, re-run dedup and claim linking, verbatim evidence and report citation chains, no-text documents → honest insufficient evidence, 503 without a provider, lifecycle 409s, cross-user 404 on every route |
| Intelligence + Neo4j | pytest, **real server** | `backend/tests/test_intelligence_neo4j.py` | Investigation synced to Neo4j: consistency report, evidenced claims, idempotent re-sync, workspace isolation |
| Phase 3 engine (**mocked LLM**) | pytest + TestClient | `backend/tests/test_phase3_engine.py` | Adaptive iterations reading exactly the chosen passages; stop when everything is read; budget stops exploration; budget exhaustion fails and resume completes; memory recall into planning and reasoning; hypothesis revision chains; comparison evolution; insights and memory isolation; debate messages and evidence-based consensus; causation guard (simulated over-claiming model); temporal supersession, resolution and timeline; source independence, priors and recency kept out of confidence; ranked, explained next steps; owner-scoped Phase 3 routes |
| Phase 3 units | pytest | `backend/tests/test_phase3_units.py` | BM25, period parsing, temporal resolution, years are not figures, candidate scoring and explanations, sufficiency, confidence v2, planner, challenger and defense validation, insights (unnoticed connection, corroboration, patterns, gaps) |
| Evaluation | pytest | `backend/tests/test_evaluation.py` | Benchmarks are reproducible and labelled as mocked; gold facts exist in the corpus; real-model runs are refused without a key |
| Data model | pytest | `backend/tests/test_models.py` | Provenance chain, CHECK constraints, cascades |
| Migrations | Alembic | test fixture (PostgreSQL mode) + CI | `downgrade base` → `upgrade head` every PostgreSQL run; `alembic check` for drift |
| Frontend units | Vitest | `src/lib/api/client.test.ts`, `src/data/sample/*.test.ts`, `src/features/auth/auth.test.ts` | Error envelopes, outage detection, bearer + single refresh-and-retry, session-expiry callback, CSRF header on auth calls, open-redirect protection, sample-data integrity |
| Phase 3 UI | Vitest + Testing Library | `src/features/workbench/phase3.test.tsx` | Planning tab (stop reason, chosen action, explained candidates, next steps); reasoning type, consensus, falsification, revision; debate thread flags unevidenced rebuttals; temporal resolution; outdated claims; sources table says scores describe sources; Discovery shows real insights with the sample lab one click away |
| Workbench | Vitest + Testing Library | `src/features/workbench/workbench.test.tsx` | 3D layout (deterministic, claims on the back plane, dangling edges ignored); fixture labelled "not AI"; stage states from the server; validation notes visible; cited report; failed run → resume, no report; graph data source + no-WebGL fallback; no fabricated activity before a run; polling only while active |
| Frontend routes | Vitest + Testing Library | `src/app/routes.test.tsx` | Every environment renders when signed in; anonymous → sign-in; expired-session message; profile shows user; Sources badge says "Backend offline" when the API is down |
| Browser | Playwright (Chromium) | `frontend/e2e/*.spec.ts` | **Investigation end to end** (upload → create → start → completed → claims, cited report, 3D graph canvas; another user gets not-found; backend runs `ASTRION_LLM_PROVIDER=fixture`), landing, sidebar navigation, UI registration/sign-out/sign-in with return path, wrong password, protected routes, session restore on reload and loss on cookie clear, workspace creation, source registration with validation, upload + download, disallowed upload, **cross-user rejection (two browser contexts)**, backend-offline handling, mobile drawer + no horizontal scroll |
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

Until the fix after Phase 2, **CI never ran**. GitHub rejected the workflow file because the e2e job's job-level `env` used `${{ runner.temp }}`, and the `runner` context is only allowed at step level. Both pushed runs (`5e834b0`, `af67524`) failed with zero jobs. The variable now lives in the Playwright step's `env`. Vitest is scoped to `src/**/*.test.*`; before Phase 2 it also collected the Playwright specs, so `npm test` (and the CI frontend job) failed.

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

## Phase 2 results (2026-11-13, local Windows 11)

| Suite | Result |
|---|---|
| Ruff lint / format | pass / pass |
| Backend on SQLite | 145 passed, 16 skipped (Neo4j integration tests — no server in that mode) |
| Backend on PostgreSQL 18.6 + Neo4j 5.26.0 | **161 passed, 0 skipped** |
| Alembic `0002`→`0003`→`0002`→`0003` round trip, `alembic check` | pass, no drift |
| ESLint / Prettier / `tsc` | pass / pass / pass |
| Vitest | 49 passed |
| `vite build` | success; `KnowledgeGraph3D` is its own lazy chunk (26 kB) |
| Playwright (desktop + mobile Chromium, real PostgreSQL + Neo4j, fixture provider) | 15 passed |

Bugs caught while building Phase 2: re-running an investigation over the same documents left it with no claims, so reasoning was silently skipped (fixed with `investigation_claims`); `strict_json_schema` stripped a *property* named `title`, which would have sent Claude an invalid schema; skipped steps were counted as succeeded in progress; the fixture glued headings onto sentences; Vitest collected Playwright specs.

## Phase 3 results (2026-11-15, local Windows 11)

Every intelligence test uses the deterministic fixture provider: a **mocked LLM**. No test calls a real model.

| Suite | Result |
|---|---|
| Ruff lint / format | pass / pass |
| Backend on SQLite | 176 passed, 17 skipped (Neo4j integration tests: no server in that mode) |
| Backend on PostgreSQL 18.6 + Neo4j 5.26.0 | **193 passed, 0 skipped** |
| Alembic `0003`→`0004`→`0003`→`0004`, `alembic check` | pass, no drift |
| ESLint / Prettier / `tsc` | pass / pass / pass |
| Vitest | 53 passed |
| `vite build` | success |
| Playwright (desktop + mobile, real PostgreSQL + Neo4j, fixture provider) | 15 passed |
| Benchmarks (`python -m app.evaluation`, fixture) | see [EVALUATION.md](EVALUATION.md) |
| GitHub Actions on `4c6b315` | frontend, backend, Playwright: all green (the first CI run that executed any job) |

Bugs caught while building Phase 3:
- The benchmark found orphan entities created for claims that already existed with a different subject.
- A year in a restated sentence was read as a changed figure, so corroboration looked like an update.
- Claim order depended on random UUIDs when timestamps tied, which made agent inputs and evaluations non-reproducible.
- A naive/aware datetime comparison when ordering investigations.
- An absolute BM25 cut-off missed relevant memory in small corpora.

## Final build results (2026-11-24, local Windows 11)

| Suite | Result |
|---|---|
| Backend on SQLite + real Neo4j 5.26, upgraded dependencies | 206 passed, 0 skipped |
| Backend on PostgreSQL + Neo4j, and migrations | Passed in CI on commit 288e378. Not run locally on the final code: the local cluster was damaged |
| Ruff lint and format | pass |
| Vitest / ESLint / `tsc` / build | 57 passed / pass / pass / pass |
| Playwright (API on SQLite + real Neo4j, fixture provider) | 15 passed in one run |
| Restart persistence | Dashboard identical after stopping and restarting the API |
| Screen sweep (15 routes at 1440, 820 and 390 px) | no horizontal overflow, error states or console errors |
| Docker images and compose | not built or run |

No test calls a real model. Explorer, ReportPage and event-stream parsing are covered by Playwright and API tests, not by unit tests.

## Gaps
- **No real Claude run.** No `ANTHROPIC_API_KEY` was available, so agent quality and the live structured-output request are unverified; only the request shape is tested.
- CI unverified until pushed.
- S3 backend tested against moto, not a real bucket.
- Claude model id not checked against the live API (no key available).
- Playwright runs Chromium only.
