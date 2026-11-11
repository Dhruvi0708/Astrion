"""Graph data model vocabulary (labels and relationship types) — see docs/DATABASE_SCHEMA.md §Graph model.

Every node and relationship written to Neo4j carries:
  * ``key``           — stable id, mirrored in Postgres ``graph_entities.graph_key`` / ``graph_relationships.graph_key``
  * ``workspace_id``  — tenancy boundary; every query must filter on it
Relationships additionally carry ``status`` and ``evidence_ids`` so traversal results remain traceable.
"""

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


# Constraints to apply when the graph schema is initialised (Phase 2, with the extraction pipeline).
SCHEMA_STATEMENTS: tuple[str, ...] = tuple(
    f"CREATE CONSTRAINT {label.value.lower()}_key IF NOT EXISTS FOR (n:{label.value}) REQUIRE (n.workspace_id, n.key) IS UNIQUE"
    for label in NodeLabel
)
