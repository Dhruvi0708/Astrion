# Development Roadmap

## Phase 1 — Foundation *(done)*
Product identity, landing page with 3D universe, app shell and eight environments, workspaces/sources/document-metadata API, full initial schema + migration, Neo4j connection layer, AI provider abstractions, documentation and tests.

## Phase 1.5 — Foundation hardening *(done, branch `foundation-hardening`)*
| Pre-Phase-2 item | Status |
|---|---|
| Authentication & authorization | Done — accounts, Argon2id, rotating refresh sessions, owner-scoped resources, cross-user tests |
| Neo4j verification | Done — repository with CRUD, constraints, transactions; 15 integration tests pass against real Neo4j 5.26 |
| Object storage | Done — local + S3-compatible backends with validation (S3 verified against moto only) |
| CI | Done — `.github/workflows/ci.yml` (not yet run on GitHub: nothing pushed) |
| Docker compose | Still not exercised locally (no Docker); CI uses the same images |
| Browser tests | Done — 14 Playwright tests |
| AI provider integrity | Done — no silent fallback; identity recorded; model check CLI (not run against live API: no key) |

### Remaining before Phase 2
1. Run CI on GitHub once the branch is pushed and fix anything environment-specific.
2. Verify `python -m app.ai.check` with a real `ANTHROPIC_API_KEY`.
3. Verify the S3 backend against a real bucket (MinIO or AWS).
4. Decide on email verification / password reset before inviting external users.
5. Move the login rate limiter to a shared store before running more than one API instance.
6. Assign owners to (or delete) any pre-auth Phase 1 workspaces.

## Phase 2 — Core intelligence engine *(this release, uncommitted on `foundation-hardening`)*
Done: text extraction (PDF, txt, md, csv, json, html); seven agents with typed contracts and Claude structured outputs; a durable orchestrator (parallel steps, retries, timeouts, resume, cancel, restart recovery); evidence-checked claims; entity resolution and graph evolution in PostgreSQL with Neo4j sync and consistency checks; hypotheses with a computed confidence method; contradiction detection; verification; cited reports; investigation history and comparison; the workbench UI with a live execution trace and a 3D knowledge graph; Universe Explorer and Intelligence Network on real data. See [INTELLIGENCE_ENGINE.md](INTELLIGENCE_ENGINE.md).

### Remaining before relying on Phase 2
1. Run one investigation with a real `ANTHROPIC_API_KEY` (not available while building) and review output quality; tune prompts and `effort`.
2. Embeddings and semantic retrieval: Research currently reads every passage in scope, which bounds practical document volume (cost scales with text).
3. `.docx`/`.xlsx` extraction and OCR for scanned PDFs (currently reported as unreadable).
4. Human verification workflow: move hypotheses to `verified`/`refuted`, and edit or reject claims.
5. A shared job queue if more than one API instance runs investigations (the runner is in-process).

## Phase 3 — Discover & Evolve
- Gap analysis over graph coverage, cross-investigation hypothesis tracking, graph snapshots and confidence history.

## Phase 5 — Simulate
- Evidence-grounded scenario models with uncertainty; `simulation_scenarios.is_illustrative=false` only for real engine output.
