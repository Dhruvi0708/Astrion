# Evaluation

ASTRION includes a reproducible benchmark harness (`backend/app/evaluation/`). It runs each dataset's investigations through the **real orchestrator** in an isolated in-memory database, then scores the stored results against the dataset's gold annotations.

```bash
cd backend
python -m app.evaluation                                # all datasets, fixture provider (free, deterministic)
python -m app.evaluation --dataset reef_v1 --provider anthropic   # real model: needs ANTHROPIC_API_KEY, costs money
```

Each report is written to `backend/evaluation/results/<dataset>.<provider>.json`. Every report carries:
- the dataset name, version and SHA-256
- the provider and model
- `is_real_model`
- a label such as `MOCKED LLM (deterministic fixture): measures the engine, not reasoning quality`

The CLI refuses a real-model run without an API key, so a report can never claim to be a real-model result when it isn't.

## Datasets (`backend/evaluation/datasets/`)

| Dataset | What it exercises |
|---|---|
| `reef_v1` | Coral reef monitoring. It includes an updated figure (30% → 61%), a conflict about different periods, two sources sharing an author and host, an independent outlet restating a finding, and a follow-up question that needs different passages. |
| `grid_v1` | Grid and solar power. It includes entity aliases (solar PV / photovoltaic), a revised capacity figure, conflicting curtailment figures from different years, and a stated causal mechanism. |

Documents are padded with neutral filler so that each paragraph becomes its own passage, which exercises chunking and targeted research. Gold facts are exact sentences from the corpus; a test enforces this.

## Metrics (`app/evaluation/metrics.py`)

| Metric | Definition |
|---|---|
| Evidence coverage | Share of gold facts captured by an extracted claim (token Jaccard ≥ 0.6). |
| Claim support | Share of claims whose every evidence quote appears verbatim in its document. |
| Entity resolution | Gold concepts found; fragmentation (a concept split across entities); exact duplicate entities. |
| Contradiction detection | Recall against gold conflict pairs; precision among conflicts judged genuine; correct temporal resolution. |
| Temporal | Recall of gold supersessions (old figure → new figure); number of dated claims. |
| Hypothesis quality (structural) | Share with support; share with falsification conditions; reasoning-type mix; downgrades by the reasoning guard; causal hypotheses backed by causal claims; consensus mix; mean confidence. |
| Graph consistency | Relationships with supporting claims, orphan entities, claims with evidence, overall consistency. |
| Agent reliability | Per role: executions, outcomes, retries, validation notes, success rate. |
| Investigation quality | Status, answer status, findings and the share fully cited, open questions, iterations, stop reason, usage, recommendations. |

## Results (2026-11-15, fixture provider: engine only, not reasoning quality)

| Metric | reef_v1 | grid_v1 |
|---|---|---|
| Evidence coverage | 1.0 (7/7) | 1.0 (6/6) |
| Claim support (verbatim) | 1.0 | 1.0 |
| Exact duplicate entities | 0 | 0 |
| Contradiction recall | 0.5 | 0.0 |
| Temporal resolution accuracy | 1.0 | n/a |
| Supersession recall | 1.0 | 1.0 |
| Graph consistent | yes | yes |
| Agent success rate (every role) | 1.0 | 1.0 |

Contradiction recall is low because the fixture detects conflicts only through negation words. That is a limit of the mock, not a measurement of Claude.

The first run of this harness caught a real engine bug, which is now fixed. A new entity was created for a claim that already existed with a different subject, which left an orphan node in the graph.

**Not yet measured:** real-model quality. Run `--provider anthropic` once a key is available, then review the hypotheses and reports by hand. The structural metrics cannot judge whether a hypothesis is insightful.
