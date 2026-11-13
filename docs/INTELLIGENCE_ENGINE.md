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

Costs shown are **estimates** from a static per-model price table (`PRICING_PER_MTOK`). Unknown models show no cost rather than a guess.

## What is and isn't verified

- Verified by tests: orchestration order, parallelism, retries, timeouts, failure, resume, cancel, recovery, persistence, dedup, provenance, authorization, Neo4j sync against a real Neo4j 5.26, and the Claude request shape (with a fake SDK client).
- **Not verified:** real Claude output quality and the live API request. No `ANTHROPIC_API_KEY` was available while building this phase. Before trusting results, set the key, run `python -m app.ai.check`, and run one investigation on known documents.
