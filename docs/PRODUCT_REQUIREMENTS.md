# Product Requirements — ASTRION

## Vision

ASTRION — *The Living Intelligence Engine* — transforms fragmented information into an interconnected, evolving knowledge universe. Users bring research papers, reports, datasets and articles; ASTRION extracts knowledge, connects it in a traceable graph, investigates it with collaborating agents, surfaces contradictions, gaps and hypotheses, and lets users explore what-if scenarios.

## Principles (non-negotiable)

1. **Traceability.** Every claim, relationship and discovery links back to the evidence span and source that produced it.
2. **Epistemic honesty.** AI-generated hypotheses are always distinguishable from verified findings. Sample and planned content is labelled everywhere it appears.
3. **Explainability.** Every automated conclusion records what produced it (agent execution, model, inputs).
4. **Evolution.** Knowledge is versioned; new evidence updates confidence and snapshots record change.

## Users

- **Researchers / analysts** investigating a domain across many sources.
- **Research leads** reviewing findings and verifying hypotheses.

## The six-stage system

| Stage | Purpose | Phase |
|---|---|---|
| Ingest | Register sources; store documents | Metadata in Phase 1; files in Phase 2 |
| Understand | Extract entities, claims, evidence | Phase 2 |
| Connect | Build the Neo4j knowledge graph | Connection layer in Phase 1; graph building Phase 2 |
| Investigate | Multi-agent investigation | Phase 3 |
| Discover | Contradictions, gaps, hypotheses | Phase 4 |
| Evolve | Snapshots, confidence history | Phase 4–5 |

## Phase 1 scope (this release)

### Delivered
- Landing page: cinematic hero with a real interactive 3D knowledge universe; sections for the problem, the architecture loop, an interactive graph preview, the intelligence network, discovery, and a closing CTA.
- Application shell: sidebar, workspace selector (live), command launcher (⌘/Ctrl-K), notifications, profile, breadcrumbs, mobile navigation.
- Environments: Overview, Universe Explorer, Investigation Room, Intelligence Network, Discovery Laboratory, Simulation Laboratory, Sources, Settings.
- API: health (service, PostgreSQL, Neo4j), workspaces (create/list/get), sources (create/list/get), document metadata (create/list/get).
- Data model and migration for users, workspaces, sources, documents, claims, evidence, graph entities, graph relationships, investigations, hypotheses (+ evidence links), agent executions, simulation scenarios, graph snapshots.
- Provider abstractions for Claude (LLM) and Voyage (embeddings) — server-side, not yet called.

### Explicitly out of scope for Phase 1
File upload/storage, parsing, extraction, writing to Neo4j, agent execution, discovery algorithms, real simulation, authentication/authorisation, multi-user collaboration.

## Labelling rules

| Label | Meaning |
|---|---|
| **Sample** (amber) | Illustrative, hand-written content. Never a result. |
| **Planned** (dashed) | Capability not yet implemented. |
| **Live** (green) | Data from the running API. |
| **Unverified / Conditional / Verified / Refuted** | Verification status of a claim or hypothesis. |
| **Hypothesis** (violet) | Proposed explanation; never presented as fact. |

## Success criteria for Phase 1
- All routes render, all navigation and CTAs work, no dead buttons.
- API endpoints validated by automated tests against PostgreSQL.
- Frontend communicates with the backend and degrades gracefully when it is unavailable.
- Documentation reflects what is implemented.
