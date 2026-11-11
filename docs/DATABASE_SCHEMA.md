# Database Schema

Migration: `backend/alembic/versions/20261111_0001_initial_schema.py` (revision `0001`). Verified with `alembic upgrade head`, `downgrade base`, `upgrade head` and `alembic check` (no drift) on PostgreSQL 18.6.

## Conventions

- Primary keys: UUID (`uuid4`), column `id`.
- `created_at` / `updated_at`: `timestamptz`, server default `now()`.
- Status fields: `VARCHAR(32)` with a named `CHECK` constraint (non-native enums — values can evolve with a migration, no `ALTER TYPE`).
- JSON columns are `JSONB` on PostgreSQL.
- Constraint names follow a deterministic naming convention (`pk_`, `fk_`, `uq_`, `ck_`, `ix_`).
- Every domain row carries `workspace_id` (tenancy boundary; `ON DELETE CASCADE`).

## Concepts — what each thing is

| Concept | Table | Definition |
|---|---|---|
| **Source** | `sources` | *Where* knowledge comes from: a publication, dataset, report or site, with bibliographic provenance (title, type, authors, URI, citation, date). |
| **Document** | `documents` | A concrete artifact belonging to a source — a file or version — identified by content hash. Processing status tracks the (future) pipeline. |
| **Claim** | `claims` | An assertion *made by a document*. A claim is what a source says, not a fact. Records extraction method (manual / model) and extractor. |
| **Evidence** | `evidence` | The exact span (quote + locator: page/section/offsets) of a document that supports, contradicts or contextualises a claim. |
| **Graph entity** | `graph_entities` | Registry row for a Neo4j node (concept/thing): identity (`graph_key`), type, lifecycle status, first-seen document, merges. |
| **Graph relationship** | `graph_relationships` | Registry row for a Neo4j relationship: endpoints, type, status (`extracted`/`hypothesized`/`verified`/`rejected`), confidence and the **evidence** that justifies it. |
| **Hypothesis** | `hypotheses` | A proposed explanation. `origin` = `human` or `ai_generated`. Starts `unverified`. |
| **Verified discovery** | `hypotheses` with `status='verified'` | A hypothesis accepted by a recorded verifier (`verified_by_id`, `verified_at`, note) with linked evidence (`hypothesis_evidence`). A CHECK constraint makes `verified` impossible without `verified_at`. |

Provenance chain (every important claim is traceable):

```
graph_relationship ──evidence_id──► evidence ──claim_id──► claim ──document_id──► document ──source_id──► source
hypothesis ◄──hypothesis_evidence──► evidence
```

## Tables

### users
`email` (unique), `display_name`, `status` ∈ {active, disabled}. Authentication is not implemented yet.

### workspaces
`owner_id → users` (SET NULL), `name`, `slug` (unique), `description`, `status` ∈ {active, archived}, `settings` JSONB. Index `(status, updated_at)`.

### sources
`workspace_id`, `created_by_id → users`, `title`, `source_type` ∈ {paper, report, dataset, article, document, web, other}, `uri`, `citation`, `authors` JSONB array, `published_on` date, `description`, `status` ∈ {registered, archived}, `attributes` JSONB. Index `(workspace_id, created_at)`.

### documents
`workspace_id`, `source_id → sources` (CASCADE), `title`, `media_type`, `byte_size` (≥ 0), `content_hash` (SHA-256 hex, indexed), `storage_uri`, `version` (≥ 1), `processing_status` ∈ {registered, queued, processing, processed, failed}, `processing_error`.

### claims
`workspace_id`, `document_id → documents`, `statement`, `status` ∈ {extracted, challenged, accepted, rejected}, `extraction_method` ∈ {manual, model}, `extractor`, `confidence` ∈ [0,1].

### evidence
`workspace_id`, `claim_id → claims`, `document_id → documents`, `quote`, `locator` JSONB, `stance` ∈ {supports, contradicts, context}. Index `(claim_id, stance)`.

### graph_entities
`workspace_id`, `graph_key` (unique per workspace), `name`, `entity_type`, `description`, `status` ∈ {proposed, active, merged, retired}, `first_seen_document_id`, `merged_into_id → graph_entities`, `properties` JSONB.

### graph_relationships
`workspace_id`, `graph_key` (unique per workspace), `source_entity_id`, `target_entity_id` (CHECK no self loop), `relation_type`, `status`, `confidence` ∈ [0,1], `evidence_id → evidence` (SET NULL), `properties` JSONB.

### investigations
`workspace_id`, `created_by_id`, `title`, `question`, `summary`, `status` ∈ {draft, active, paused, closed}.

### agent_executions
`workspace_id`, `investigation_id`, `parent_execution_id → agent_executions` (handoff chain), `agent_role` ∈ {inquirer, cartographer, retriever, skeptic, verifier}, `status` ∈ {pending, running, succeeded, failed, cancelled}, `model`, `input`/`output` JSONB, `error`, token counts, `started_at`, `finished_at` (CHECK finished ⇒ started).

### hypotheses / hypothesis_evidence
See concepts above. `generated_by_execution_id → agent_executions` ties AI hypotheses to the run that produced them. `hypothesis_evidence (hypothesis_id, evidence_id, stance)` composite PK.

### simulation_scenarios
`workspace_id`, `investigation_id`, `baseline_scenario_id → simulation_scenarios`, `name`, `description`, `status`, `parameters`/`assumptions`/`results` JSONB, `is_illustrative` (default **true** — real engine output must set false explicitly).

### graph_snapshots
`workspace_id`, `created_by_id`, `label`, `node_count`, `relationship_count`, `checksum`, `storage_uri`, `captured_at`, `details` JSONB.

## Graph model (Neo4j)

Defined in `backend/app/graph/model.py`.

- Labels: `Entity`, `Claim`, `Source`, `Document`, `Hypothesis`.
- Relationship types: `INFLUENCES`, `CORRELATES_WITH`, `PART_OF`, `SUPPORTS`, `CONTRADICTS`, `MENTIONED_IN`, `DERIVED_FROM`, `HYPOTHESIZED`.
- Required properties on every node/relationship: `key`, `workspace_id`; relationships also carry `status` and `evidence_ids`.
- Uniqueness constraints on `(workspace_id, key)` per label are defined (`SCHEMA_STATEMENTS`) and will be applied when the extraction pipeline first writes to the graph (Phase 2).

**Decisions.** Postgres keeps provenance because it needs relational integrity, transactions with the rest of the application data, and auditing. Neo4j keeps topology because multi-hop traversal and path queries are its strength. Writes in Phase 2 will go Postgres-first (registry + evidence) then Neo4j (idempotent `MERGE` on `key`), with a reconciliation job comparing the two by `graph_key`.
