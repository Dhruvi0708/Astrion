"""Graph data model vocabulary and PostgreSQL ↔ Neo4j identifier mapping.

Every node and relationship written to Neo4j carries:
  * ``key``           — stable id derived from the PostgreSQL row that owns the element (see below)
  * ``workspace_id``  — tenancy boundary; every query filters on it
Relationships additionally carry ``status`` and ``evidence_ids`` so traversal results stay traceable.

Identifier mapping
------------------
PostgreSQL is the identity authority. A graph key is ``<prefix>:<postgres uuid>``:

    ent:<graph_entities.id>        → (:Entity)
    clm:<claims.id>                → (:Claim)
    src:<sources.id>               → (:Source)
    doc:<documents.id>             → (:Document)
    hyp:<hypotheses.id>            → (:Hypothesis)
    rel:<graph_relationships.id>   → [:<RelType>]

The same string is stored in ``graph_entities.graph_key`` / ``graph_relationships.graph_key``, so either
store can be reconciled against the other. Keys are never derived from names or other user text.
"""

import re
import uuid
from enum import StrEnum


class NodeLabel(StrEnum):
    ENTITY = "Entity"  # concept / thing extracted from documents
    CLAIM = "Claim"
    SOURCE = "Source"
    DOCUMENT = "Document"
    HYPOTHESIS = "Hypothesis"


class RelType(StrEnum):
    INFLUENCES = "INFLUENCES"
    CORRELATES_WITH = "CORRELATES_WITH"
    PART_OF = "PART_OF"
    SUPPORTS = "SUPPORTS"
    CONTRADICTS = "CONTRADICTS"
    MENTIONED_IN = "MENTIONED_IN"
    DERIVED_FROM = "DERIVED_FROM"  # document -> source
    HYPOTHESIZED = "HYPOTHESIZED"


KEY_PREFIX: dict[NodeLabel, str] = {
    NodeLabel.ENTITY: "ent",
    NodeLabel.CLAIM: "clm",
    NodeLabel.SOURCE: "src",
    NodeLabel.DOCUMENT: "doc",
    NodeLabel.HYPOTHESIS: "hyp",
}
RELATIONSHIP_PREFIX = "rel"
_KEY_RE = re.compile(r"^(ent|clm|src|doc|hyp|rel):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def node_key(label: NodeLabel, postgres_id: uuid.UUID) -> str:
    return f"{KEY_PREFIX[label]}:{postgres_id}"


def relationship_key(postgres_id: uuid.UUID) -> str:
    return f"{RELATIONSHIP_PREFIX}:{postgres_id}"


def parse_key(key: str) -> tuple[str, uuid.UUID]:
    if not _KEY_RE.fullmatch(key):
        raise ValueError(f"Invalid graph key: {key!r}")
    prefix, raw = key.split(":", 1)
    return prefix, uuid.UUID(raw)


def is_valid_key(key: str) -> bool:
    return bool(_KEY_RE.fullmatch(key))


# Applied by GraphRepository.ensure_schema(). All statements are idempotent.
SCHEMA_STATEMENTS: tuple[str, ...] = (
    *(
        f"CREATE CONSTRAINT {label.value.lower()}_workspace_key IF NOT EXISTS " f"FOR (n:{label.value}) REQUIRE (n.workspace_id, n.key) IS UNIQUE"
        for label in NodeLabel
    ),
    *(f"CREATE INDEX {label.value.lower()}_workspace IF NOT EXISTS FOR (n:{label.value}) ON (n.workspace_id)" for label in NodeLabel),
    *(f"CREATE INDEX rel_{rel.value.lower()}_workspace_key IF NOT EXISTS FOR ()-[r:{rel.value}]-() ON (r.workspace_id, r.key)" for rel in RelType),
)
