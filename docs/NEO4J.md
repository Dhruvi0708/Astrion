# Neo4j Integration

## Setup

Any Neo4j 5.x (Community is enough). Options:

```bash
docker compose up -d neo4j                      # uses docker-compose.yml
# or: download Neo4j 5 Community + Java 21, then
neo4j-admin dbms set-initial-password '<password>'
neo4j console
```

Configure the API:

```
ASTRION_NEO4J_URI=bolt://localhost:7687
ASTRION_NEO4J_USER=neo4j
ASTRION_NEO4J_PASSWORD=<password>
ASTRION_NEO4J_DATABASE=neo4j
ASTRION_NEO4J_TIMEOUT_SECONDS=3          # connect + pool acquisition
ASTRION_NEO4J_QUERY_TIMEOUT_SECONDS=10   # per transaction (server-enforced)
```

`GET /api/v1/health/neo4j` reports `ok`, `unavailable` (unreachable, or `AuthError: authentication failed` for bad credentials) or `not_configured` (empty URI).

## Code

| File | Role |
|---|---|
| `app/graph/client.py` | `Neo4jGraphClient`: driver lifecycle, connect/acquire timeouts, health check, `repository()` |
| `app/graph/repository.py` | `GraphRepository`: node + relationship CRUD, neighbours, counts, `ensure_schema()`, explicit `transaction()` |
| `app/graph/model.py` | Labels, relationship types, schema statements, PostgreSQL ↔ Neo4j key mapping |

Transactions: single operations use managed transactions (`execute_write` / `execute_read`, automatic retry of transient errors for up to 5 s) with a server-side timeout. `with repo.transaction() as tx:` groups several operations; any exception rolls back.

Errors are translated: `AuthError` / unreachable → `GraphUnavailableError`; missing endpoints → `GraphNotFoundError`; invalid labels, keys or properties → `GraphValidationError`.

## Safety
- Labels and relationship types can't be Cypher parameters, so they are accepted only from the `NodeLabel` / `RelType` enums before interpolation. Injection attempts are tested.
- Every query is scoped by `workspace_id`; relationships can only connect nodes in the same workspace.
- `key`, `workspace_id`, `created_at`, `updated_at` can't be overwritten through properties; property values must be primitives or lists of primitives.

## Schema (`ensure_schema()`, idempotent)
- Uniqueness constraint on `(workspace_id, key)` for each label: `Entity`, `Claim`, `Source`, `Document`, `Hypothesis`, `Investigation`.
- Index on `workspace_id` per label.
- Index on `(workspace_id, key)` per relationship type.

## Identifier mapping
PostgreSQL is the identity authority. Graph keys are `<prefix>:<postgres uuid>`:

| Prefix | PostgreSQL row | Neo4j |
|---|---|---|
| `ent` | `graph_entities.id` | `(:Entity)` |
| `clm` | `claims.id` | `(:Claim)` |
| `src` | `sources.id` | `(:Source)` |
| `doc` | `documents.id` | `(:Document)` |
| `hyp` | `hypotheses.id` | `(:Hypothesis)` |
| `inv` | `investigations.id` | `(:Investigation)` |
| `rel` | `graph_relationships.id` | entity relationship |
| uuid5 | `link_key(type, from, to)` | provenance edges (`ABOUT`, `EVIDENCED_BY`, …), stable across re-syncs |

The same string is stored in `graph_entities.graph_key` / `graph_relationships.graph_key`. ## How investigations write the graph
`sync_investigation_graph()` (`app/intelligence/knowledge_store.py`) projects one investigation in a single managed transaction: Investigation, Source and Document nodes, Entity and Claim nodes (`FOUND`, `ABOUT`), `EVIDENCED_BY {quote}` to the document, entity predicate edges with `support_count` and `claim_ids`, hypotheses (`PROPOSED`, `SUPPORTED_BY`, `OPPOSED_BY`) and `CONTRADICTS`. Everything is `MERGE`d on keys, so re-running is idempotent. When Neo4j is configured but fails, the sync step fails the run (resumable) and PostgreSQL keeps the knowledge. Reads (`GET /workspaces/{id}/graph`) use Neo4j when available and fall back to the PostgreSQL registry, saying so in `source` and `fallback_reason`.

## Verification
`backend/tests/test_neo4j_integration.py` runs against a **real** server when `ASTRION_TEST_NEO4J_URI` is set (skipped otherwise — never mocked). In Phase 1.5 it was run locally against Neo4j 5.26.0 Community on Java 21 (15/15 passed), and CI runs it against the `neo4j:5.26-community` service container. Phase 2 adds `tests/test_intelligence_neo4j.py`: a full investigation synced to a real server, checked for a consistent registry, evidenced claims, idempotent re-sync and cross-workspace isolation (passed against Neo4j 5.26.0).
