# Intelligence Engine (Phase 2)

The intelligence engine turns a research question plus a set of workspace documents into a cited, verifiable investigation. It runs seven agents in a fixed, durable pipeline. Every step is recorded in PostgreSQL. Knowledge is merged into the workspace graph, which is mirrored into Neo4j.

Code: `backend/app/intelligence/`. API: `backend/app/api/v1/investigations.py`. UI: `frontend/src/features/workbench/`.

## Design rules

| Rule | How it is enforced |
|---|---|
| Agents are pure functions | `Agent.run(payload, llm)` takes a typed input and returns a typed output. Agents never touch the database. The orchestrator is the only writer, so parallel agent calls are thread-safe. |
| Typed contracts | Every input and output is a Pydantic model (`contracts.py`, `extra="forbid"`). Claude is constrained by JSON schema (structured outputs), and the result is re-validated with Pydantic. A mismatch raises `SchemaValidationError`, which is retryable. |
| Provenance is checked in code, not trusted | Research quotes must appear verbatim (after whitespace normalisation) in the passage they cite. Otherwise the evidence is dropped, then any claim left without evidence, then relationships without a surviving claim, then orphan entities. Later agents can only cite refs (`C3`, `H1`, `X2`) they were shown. Unknown refs are removed, and every removal is written to the step's `notes`. |
| Never report success for a failed run | A failed step fails the investigation (status `failed`, with the error stored). No report is written for failed or cancelled runs. A skipped step (e.g. Neo4j not configured) is recorded as `skipped`, never counted as succeeded. |
| No silent fallback | The configured model answers or the step fails. SDK retries are off (`max_retries=0`); retries happen in the orchestrator and every attempt is its own `agent_executions` row. |
| Fixture ≠ AI | `ASTRION_LLM_PROVIDER=fixture` selects deterministic keyword rules for development and tests. It is refused outside `development`/`test`. Its results carry `provider="fixture"`, and the UI and reports label them "not AI". |

## Agents

| # | Agent | Input → output | Effort | Post-validation |
|---|---|---|---|---|
| 1 | **Orchestrator** | question + document list → objective, sub-questions (Q#), key terms, evidence needs | high | — |
| 2 | **Research** (one call per document part, in parallel) | passages (P#) → entities (E#), claims with `{passage_ref, quote}` evidence, relationships with a fixed predicate vocabulary | high | verbatim-quote check, orphan removal |
| 3 | **Knowledge** | ambiguous duplicate pairs (D#) → same/different decisions | low | only asked about pairs the deterministic matcher can't decide (similarity ≥ 0.86 or containment) |
| 4 | **Hypothesis** | claims (C#) + relationship lines → testable hypotheses with supporting/opposing refs, test plan, assumptions, plausibility | high | unknown refs removed; hypotheses without support dropped |
| 5 | **Contradiction** | claims → conflicting pairs, kind (direct/temporal/contextual), genuine?, severity | high | unknown or self pairs dropped |
| 6 | **Verification** | hypotheses (H#) and contradictions (X#) with their claims and quotes → verdict per item | high | missing reviews filled as `insufficient_evidence` |
| 7 | **Synthesis** | everything above → report: answer status, findings (each citing C#), assessments, open questions, limitations | high | uncited findings removed; no findings → `insufficient_evidence` |

Hypothesis status follows the verdict, but **an agent can never mark a hypothesis `verified`** (that is a human decision). The mapping is `supported` → `in_review`, `partially_supported` → `conditional`, `contradicted` → `refuted`, and anything else → `unverified`.

Hypothesis confidence is computed, not asked of the model (`confidence.py`, method `astrion-evidence-v1`). Explicit claims weigh 1 and inferred claims 0.5. `balance = support / (support + opposition + 1)`. `diversity = min(1, 0.5 + 0.25 × (distinct sources − 1))`. The score is `balance × diversity × verification factor` (supported 1.0, partially 0.75, insufficient 0.5, unsupported 0.25, contradicted 0.1). All inputs and components are stored with the hypothesis and shown in the UI.

## Pipeline and lifecycle

```
draft ──start──▶ queued ──▶ running ──▶ completed
                   │           ├──(step fails)──▶ failed ──resume──▶ queued
                   │           ├──cancel──▶ cancelling ──▶ cancelled
                   └──cancel──▶ cancelled
server restart: running/queued ──▶ interrupted ──resume──▶ queued
```

Steps of one run (step keys are `r{run}:{name}`):

1. `ingest` (system): extract text (PDF via pypdf, txt/md/csv/json/html) into `document_chunks` of about 1,400 characters. Documents without a stored file or with unsupported formats are reported, not guessed at.
2. `orchestrator`: stores the plan on the investigation.
3. `research:{doc}:{part}`: parallel (`ASTRION_AGENT_MAX_PARALLEL`). Documents are split into parts of at most `ASTRION_RESEARCH_CHARS_PER_CALL` characters.
4. `knowledge:resolve` (only if there are ambiguous pairs), then `knowledge` (system): deterministic merge into the registry.
5. `graph_sync:knowledge` (system): one Neo4j transaction. It is `skipped` when Neo4j isn't configured and **fails the run** when Neo4j is configured but errors. The knowledge is still saved in PostgreSQL, and resume retries the sync.
6. `hypothesis` ∥ `contradiction`: run in parallel over this investigation's claims plus up to ¼ of `ASTRION_MAX_CLAIMS_FOR_REASONING` earlier workspace claims about the same entities.
7. `verification`: writes `verification_results` and updates hypothesis status and confidence.
8. `synthesis`: writes `investigation_reports` (one per run), with a citation chain for every cited claim: claim → evidence (quote + chunk locator) → document → source.
9. `graph_sync:final`: hypotheses and contradictions into Neo4j.

**Retries:** `ProviderRateLimitError`, `ProviderUnavailableError` (including truncated output) and `SchemaValidationError` are retried up to `ASTRION_AGENT_MAX_ATTEMPTS`, with exponential backoff from `ASTRION_AGENT_RETRY_BACKOFF_SECONDS`. Auth, permission, bad-request and refusal errors are not retried.

**Timeouts:** each attempt is bounded by `ASTRION_AGENT_TIMEOUT_SECONDS`. A timed-out attempt is recorded as failed.

**Resume:** steps that succeeded in the current run are reused (their stored output is re-validated), so a resumed run never repeats paid model calls. Persistence steps are idempotent: hypotheses are keyed by the execution that generated them, and contradictions by `(investigation, claim_a, claim_b)`.

**Cancellation:** a flag checked before every step and while parallel steps run. In-flight calls are abandoned, their rows are marked `cancelled`, and pending rows are closed.

**Execution:** a bounded thread pool inside the API process (`ASTRION_MAX_CONCURRENT_INVESTIGATIONS`). There is no broker. State is durable, and on startup `InvestigationRunner.recover()` marks in-flight runs `interrupted`.

**Traceability:** each `agent_executions` row stores the step key, attempt, `depends_on`, parent execution, the full input, the output (`result` + validation `notes`), provider, requested and served model, provider request id, tokens, estimated cost, duration and error. Investigation totals (tokens, cost) are summed from these rows.

## Knowledge graph evolution

PostgreSQL is the system of record and Neo4j is a projection rebuilt from it by stable keys.

- **Entity dedup:** by `(workspace, entity_type, normalized_name)` (unique constraint). Near matches go to the Knowledge agent, and merges keep aliases. Re-mentions increment `mention_count` and update `last_seen_at`.
- **Claim dedup:** per document, by normalised statement. A claim found again by a later investigation is **linked**, not copied (`investigation_claims`), so every investigation sees, and reasons over, everything it found.
- **Relationships:** unique per `(workspace, source, target, predicate)`. Each supporting claim is linked in `relationship_claims`, and `support_count` grows with evidence. A relationship with no claim is never written.
- **Change log:** every creation, reuse or merge is a `graph_changes` row tied to the investigation.
- **Neo4j shape:** `(:Investigation)-[:FOUND]->(:Claim)-[:ABOUT]->(:Entity)`, `(:Claim)-[:EVIDENCED_BY {quote}]->(:Document)-[:FROM_SOURCE]->(:Source)`, `(:Entity)-[:CAUSES|INFLUENCES|…]->(:Entity)`, `(:Investigation)-[:PROPOSED]->(:Hypothesis)-[:SUPPORTED_BY|OPPOSED_BY]->(:Claim)`, `(:Claim)-[:CONTRADICTS]->(:Claim)`. Every node carries `workspace_id`, and every query filters on it.
- **Consistency:** `GET /workspaces/{id}/graph/consistency` compares the PostgreSQL registry with Neo4j (missing and orphaned keys).

## Phase 3 — autonomous intelligence

Phase 3 extends the same pipeline; nothing from Phase 2 was replaced. The new behaviour lives in `adaptive.py` (mixed into the orchestrator), `memory.py`, `active_learning.py`, `temporal.py`, `source_intel.py`, `insights.py` and `retrieval.py`.

```
ingest ─► memory ─► orchestrator ─► research ─► knowledge ─► graph_sync ─► assess ─┬─(choice)─► planner ─► research … (bounded loop)
                                                                                   └─(stop)───► temporal ─► sources ─► hypothesis ∥ contradiction
   ─► debate: challenge ─► defense ─► verification (+ consensus) ─► synthesis ─► graph_sync:final ─► next_steps
```

### Adaptive planning and budgets

- **Initial evidence.** If the documents in scope fit `ASTRION_RESEARCH_INITIAL_CHARS`, everything is read (Phase 2 behaviour). Otherwise the passages most relevant to the question and sub-questions are read first, ranked by BM25.
- **Assessment after each iteration** (system step `assess:N`). It computes coverage per sub-question from the sub-questions each claim answered, and scores candidate actions over unread passages:
  - research an under-covered sub-question
  - seek evidence that resolves an open contradiction from memory
  - establish how two co-mentioned entities relate
- **Stopping rules, in code.** Exploration stops when:
  - every sub-question has at least `ASTRION_MIN_CLAIMS_PER_SUBQUESTION` claims and the best candidate scores below 0.35
  - nothing unread is relevant
  - the iteration limit is reached
  - the budget would not leave room for the mandatory steps
- **Planner agent** (`planner:N`). It is called only when there is a real choice. It sees coverage, the scored candidates with explanations, recent claims and budget use. It may choose up to 3 listed actions, add up to 2 sub-questions, or declare sufficiency; it cannot invent actions. The plan revisions are stored in `investigation_runs.plan_history`.
- **Budgets** (`ASTRION_RUN_MAX_LLM_CALLS`, `_TOKENS`, `_COST_USD`, `ASTRION_MAX_ITERATIONS`) are checked before every model call and every retry. Optional work (more exploration, the debate) is skipped while there is still headroom for the mandatory steps. A mandatory step that would exceed the budget fails the run with "Run budget exhausted" (resumable after raising the limit). Usage, the stop reason and the iterations are recorded per run in `investigation_runs`.

### Persistent memory

`memory` (system step) recalls workspace knowledge relevant to the question, using BM25 with at least two shared terms:
- prior claims (marked when superseded)
- known entities
- open (not refuted) hypotheses from other investigations
- unresolved genuine contradictions involving the recalled claims
- the outcomes of earlier investigations that touched them

Where the recall goes:
- The Orchestrator sees it as `prior_knowledge`.
- Recalled claims join the claim index (flagged `from_memory`), so new reasoning builds on them.
- Prior hypotheses are offered to the Hypothesis agent (`PH#`). Re-evaluating one sets `revises_hypothesis_id` instead of creating an unrelated duplicate.

Memory never crosses workspaces.

### Agent collaboration: debate and consensus

Each of these agents has a distinct responsibility and contract:

| Agent | Role in the debate |
|---|---|
| Hypothesis (author) | Proposes hypotheses with `reasoning_type`, assumptions and `falsification_conditions`. |
| **Challenger** (`challenger`) | Independently attacks up to `ASTRION_MAX_DEBATED_HYPOTHESES` hypotheses, the most uncertain first: alternative explanations, confounders, insufficient or inferred-only evidence, temporal mismatch, scope, counter-evidence (which must cite claims), and an overstated reasoning type. |
| Hypothesis (defense, `debate:defense`) | Answers each objection: rebut (with cited claims), concede, or revise (new statement and an honest reasoning type). |
| Verification | Independent adjudicator. Sees the full transcript and is told to weigh only evidence-cited arguments. |

**Consensus** is computed in code from the verdict and the debate:

| Consensus | When |
|---|---|
| `rejected` | Verdict is unsupported or contradicted. |
| `agreed` | Supported or partially supported, and every objection was answered *with evidence*. |
| `contested` | At least one objection stands. |
| `insufficient` | Insufficient evidence and no objection stands. |
| `unchallenged` | The hypothesis was not debated. |

A rebuttal that cites no claim never counts as an answer. Every turn is stored in `agent_messages` (challenge, rebuttal, concession, revision, verdict) with the claims it cites.

### Hypothesis reasoning

Every hypothesis stores:
- statement, rationale, and supporting and opposing evidence
- confidence method (`astrion-evidence-v2`)
- verification status and consensus
- unresolved assumptions and falsification conditions
- reasoning type: **causation** (cited claims assert a causal mechanism), **correlation** (things co-occur), **inference** (reasoning beyond the claims) or **speculation** (no direct support)

A code guard enforces the label:
- "causation" without a cited claim linked to a `CAUSES` or `INFLUENCES` relationship is downgraded to correlation.
- Causation or correlation resting only on inferred claims becomes inference.
- A hypothesis without support is speculation.

The downgrade is recorded (`debate.reasoning_check`).

Confidence v2 changes two things:
- Diversity counts *independent source groups* (sources sharing a web host, an author or identical content count once).
- Superseded supporting claims weigh half.

### Temporal intelligence

Step `temporal`:
- Parses the years a claim speaks about (ranges, "since", "until", single years) into `valid_from_year` / `valid_to_year`.
- Detects outdated claims: same subject, same statement apart from figures, different figures, different years (stated, or the source's publication year). The older claim is marked `superseded_by_id`, and the update is written to the change log.
- Years are never treated as changed figures: an outlet restating a finding "in 2024" corroborates it rather than updating it.

Conflicts between claims about non-overlapping periods are resolved as *temporal* ("both can hold at their own time"); conflicts the verifier finds unsupported are resolved by *verification*. `GET …/graph/entities/{id}/timeline` shows an entity's claims in time order, with supersessions.

### Source intelligence

Step `sources` writes one `source_assessments` row per source used:

| Score | Basis |
|---|---|
| Relevance | Share of the investigation's claims. |
| Credibility | A *prior by source type*, labelled as such: paper 0.8, dataset 0.75, report 0.7, article 0.55, document 0.5, web/other 0.4. |
| Recency | Linear decay over 10 years from publication; unknown dates stay unknown. |
| Independence | 1 / size of the source's origin group. |
| Corroboration | Share of its claims also stated by an independent group. |

These scores describe sources and **never** enter claim or hypothesis confidence. Only claim-level corroboration, meaning how many independent groups state a claim, is shown to the agents.

### Active learning

Candidates and recommendations share one documented scoring method (`astrion-active-v1`):

```
score = 0.30·uncertainty + 0.25·relevance + 0.25·information_gain + 0.10·weak_evidence + 0.10·contradiction
```

Each factor is in [0, 1], and the explanation names the factors at or above 0.4. After a run, `next_steps` stores up to 15 ranked recommendations:
- find evidence for under-covered sub-questions
- corroborate single-source claims the report relies on
- refresh outdated claims
- resolve open conflicts
- test contested or mid-confidence hypotheses through their falsification conditions
- establish missing relationships

### Cross-investigation intelligence

`GET /workspaces/{id}/insights` returns the following for one workspace, all deterministic and computed from stored records:
- entities several investigations reached
- relationships corroborated by claims from several investigations
- **unnoticed connections**: entities first found by different investigations, linked through a shared entity but never directly
- recurring (type —predicate→ type) patterns
- how hypotheses evolved (revisions and restatements, with confidence and status changes)
- knowledge gaps: single-claim entities, weakly supported relationships, open hypotheses, unresolved contradictions, unanswered sub-questions

Connections that touch the current investigation are also given to the Hypothesis agent as `cross_links`. Comparison (`…/investigations/compare`) adds an `evolution` diff for consecutive investigations: shared and new entities, new relationships, changed hypotheses, resolved contradictions, new conflicts and change-log totals.

### Reliability

- Every new step is a recorded, resumable execution; resume reuses succeeded steps, including planner decisions and assessments.
- Retries are bounded, and each retry is re-checked against the budget.
- Ordering is deterministic: claims sort by statement on timestamp ties, and investigations by run start. The same inputs therefore give the same agent inputs, which makes evaluations reproducible.
- `investigation_runs` keeps model, token and cost provenance per run.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables real investigations (server-side only). |
| `ASTRION_LLM_MODEL` | `claude-opus-5-5` | The model every agent uses. |
| `ASTRION_LLM_PROVIDER` | `anthropic` | `fixture` = deterministic rules (development/test only). |
| `ASTRION_AGENT_MAX_ATTEMPTS` | 3 | Attempts per step for retryable errors. |
| `ASTRION_AGENT_RETRY_BACKOFF_SECONDS` | 2 | Base of the exponential backoff. |
| `ASTRION_AGENT_TIMEOUT_SECONDS` | 300 | Per-attempt timeout. |
| `ASTRION_AGENT_MAX_PARALLEL` | 4 | Parallel agent calls within a step group. |
| `ASTRION_RESEARCH_CHARS_PER_CALL` | 24000 | Passage text per Research call. |
| `ASTRION_MAX_CLAIMS_FOR_REASONING` | 80 | Claims shown to reasoning agents. |
| `ASTRION_MAX_CONCURRENT_INVESTIGATIONS` | 2 | Runs executing at once per API process. |
| `ASTRION_MAX_ITERATIONS` | 3 | Research iterations per run (including the first). |
| `ASTRION_RESEARCH_INITIAL_CHARS` | 120000 | Text read in the first iteration before targeting begins. |
| `ASTRION_RESEARCH_ITERATION_CHARS` | 24000 | Passage text per chosen action in later iterations. |
| `ASTRION_MIN_CLAIMS_PER_SUBQUESTION` | 2 | Coverage needed before a sub-question counts as answered. |
| `ASTRION_RUN_MAX_LLM_CALLS` | 40 | Hard limit on model calls per run (retries included). |
| `ASTRION_RUN_MAX_TOKENS` | 2000000 | Hard limit on tokens per run. |
| `ASTRION_RUN_MAX_COST_USD` | 20 | Hard limit on estimated cost per run. |
| `ASTRION_MAX_DEBATED_HYPOTHESES` | 3 | Hypotheses debated per run (0 disables the debate). |
| `ASTRION_MEMORY_CLAIMS` | 20 | Prior claims recalled per investigation. |

Costs shown are **estimates** from a static per-model price table (`PRICING_PER_MTOK`). Unknown models show no cost rather than a guess.

## What is and isn't verified

- Verified by tests: orchestration order, parallelism, retries, timeouts, failure, resume, cancel, recovery, persistence, dedup, provenance, authorization, Neo4j sync against a real Neo4j 5.26, and the Claude request shape (with a fake SDK client).
- Phase 3, verified with the deterministic fixture provider (a mocked LLM), on real PostgreSQL and Neo4j: adaptive iterations and planner choices, budget stops and budget failure followed by resume, memory recall and hypothesis revision, debate records and consensus rules, the reasoning-type guard, temporal supersession and resolution, source independence, recommendations, cross-investigation insights, comparison and workspace isolation. Benchmarks: [EVALUATION.md](EVALUATION.md).
- **Not verified:** real Claude output quality and the live API request. No `ANTHROPIC_API_KEY` was available while building this phase. Before trusting results, set the key, run `python -m app.ai.check`, and run one investigation on known documents.
