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
    INVESTIGATION = "Investigation"


class RelType(StrEnum):
    # Entity -> Entity predicates. Extraction may only emit these (see ENTITY_PREDICATES).
    INFLUENCES = "INFLUENCES"
    CAUSES = "CAUSES"
    CORRELATES_WITH = "CORRELATES_WITH"
    PART_OF = "PART_OF"
    ASSOCIATED_WITH = "ASSOCIATED_WITH"
    PRECEDES = "PRECEDES"
    LOCATED_IN = "LOCATED_IN"
    MEASURES = "MEASURES"
    # Provenance and reasoning edges.
    ABOUT = "ABOUT"  # Claim -> Entity
    EVIDENCED_BY = "EVIDENCED_BY"  # Claim -> Document (quote + locator on the edge)
    FROM_SOURCE = "FROM_SOURCE"  # Document -> Source
    CONTRADICTS = "CONTRADICTS"  # Claim -> Claim
    SUPPORTED_BY = "SUPPORTED_BY"  # Hypothesis -> Claim
    OPPOSED_BY = "OPPOSED_BY"  # Hypothesis -> Claim
    FOUND = "FOUND"  # Investigation -> Claim
    PROPOSED = "PROPOSED"  # Investigation -> Hypothesis
    # Phase 1 vocabulary, kept for compatibility.
    SUPPORTS = "SUPPORTS"
    MENTIONED_IN = "MENTIONED_IN"
    DERIVED_FROM = "DERIVED_FROM"
    HYPOTHESIZED = "HYPOTHESIZED"


ENTITY_PREDICATES: tuple[RelType, ...] = (
    RelType.INFLUENCES,
    RelType.CAUSES,
    RelType.CORRELATES_WITH,
    RelType.PART_OF,
    RelType.ASSOCIATED_WITH,
    RelType.PRECEDES,
    RelType.LOCATED_IN,
    RelType.MEASURES,
)


KEY_PREFIX: dict[NodeLabel, str] = {
    NodeLabel.ENTITY: "ent",
    NodeLabel.CLAIM: "clm",
    NodeLabel.SOURCE: "src",
    NodeLabel.DOCUMENT: "doc",
    NodeLabel.HYPOTHESIS: "hyp",
    NodeLabel.INVESTIGATION: "inv",
}
RELATIONSHIP_PREFIX = "rel"
# Namespace for deterministic keys of link edges that have no PostgreSQL row of their own
# (e.g. Claim -ABOUT-> Entity). uuid5(namespace, "<type>|<from>|<to>") is stable across re-syncs.
LINK_NAMESPACE = uuid.UUID("6f1b9c52-3d0a-4e7e-9a35-0c6f4a2d8b11")
_KEY_RE = re.compile(r"^(ent|clm|src|doc|hyp|inv|rel):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def node_key(label: NodeLabel, postgres_id: uuid.UUID) -> str:
    return f"{KEY_PREFIX[label]}:{postgres_id}"


def relationship_key(postgres_id: uuid.UUID) -> str:
    return f"{RELATIONSHIP_PREFIX}:{postgres_id}"


def link_key(rel_type: RelType, from_key: str, to_key: str) -> str:
    """Deterministic key for a link edge, so re-syncing never creates duplicates."""
    return f"{RELATIONSHIP_PREFIX}:{uuid.uuid5(LINK_NAMESPACE, f'{rel_type.value}|{from_key}|{to_key}')}"


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
