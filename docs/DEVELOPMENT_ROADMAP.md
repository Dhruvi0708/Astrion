# Development Roadmap

## Phase 1 — Foundation *(this release)*
Product identity, landing page with 3D universe, app shell and eight environments, workspaces/sources/document-metadata API, full initial schema + migration, Neo4j connection layer, AI provider abstractions, documentation and tests.

### Must address before Phase 2
1. **Authentication & authorisation** — users exist in the schema but nothing authenticates; add auth and scope every query by membership before exposing the API.
2. **Neo4j verification** — the driver integration was verified only against an unreachable server (reports `unavailable` correctly). Run against a real Neo4j 5 instance and apply `SCHEMA_STATEMENTS`.
3. **Object storage** — choose a store (S3-compatible) for document files; `documents.storage_uri` is ready.
4. **CI** — wire `pytest` (with PostgreSQL), `npm test`, `npm run typecheck`, `npm run build` into CI.
5. **Docker compose** — provided but not exercised (Docker was unavailable during Phase 1).
6. **End-to-end browser tests** — manual browser verification was done; add Playwright.

## Phase 2 — Ingest, Understand, Connect
- File upload → storage → parsing (PDF, HTML, CSV) → `documents.processing_status` lifecycle.
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
