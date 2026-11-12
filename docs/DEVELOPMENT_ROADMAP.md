# Development Roadmap

## Phase 1 — Foundation *(done)*
Product identity, landing page with 3D universe, app shell and eight environments, workspaces/sources/document-metadata API, full initial schema + migration, Neo4j connection layer, AI provider abstractions, documentation and tests.

## Phase 1.5 — Foundation hardening *(this release, branch `foundation-hardening`)*
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

## Phase 2 — Ingest, Understand, Connect
- Parsing of stored files (PDF, HTML, CSV) → `documents.processing_status` lifecycle (upload + storage already exist).
- Claim and evidence extraction with Claude (structured outputs), recording `extraction_method='model'` and `extractor`.
- Entity resolution; write registry rows then `MERGE` into Neo4j by `graph_key`; reconciliation job.
- Embeddings for evidence spans; semantic search.
- Universe Explorer reads the live workspace graph (sample graph remains as a demo).

## Phase 3 — Investigate
- Investigation API; agent engine (Inquirer, Cartographer, Retriever, Skeptic, Verifier) writing `agent_executions` with parent handoffs.
- Live activity timeline and execution history in the Intelligence Network and Investigation Room.
- Human-in-the-loop verification workflow.

## Phase 4 — Discover & Evolve
- Contradiction detection, gap analysis over graph coverage, hypothesis generation (always `ai_generated` + `unverified`).
- Graph snapshots, confidence history, change log.

## Phase 5 — Simulate
- Evidence-grounded scenario models with uncertainty; `simulation_scenarios.is_illustrative=false` only for real engine output.
