"""Claims, evidence, graph registry and graph snapshots.

Neo4j is the source of truth for graph topology and traversal. The ``graph_entities`` and
``graph_relationships`` tables are a relational *registry*: they hold identity (``graph_key``,
matching the Neo4j node/relationship key), lifecycle status and — most importantly — provenance
links to the evidence that justified each element. See docs/DATABASE_SCHEMA.md.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey
from app.models.enums import ClaimKind, ClaimStatus, EntityStatus, EvidenceStance, ExtractionMethod, RelationshipStatus, db_enum


class Claim(UUIDPrimaryKey, Timestamps, Base):
    """An assertion made by a document. A claim is not a fact — it is what a source says."""

    __tablename__ = "claims"
    __table_args__ = (
        Index("ix_claims_workspace_status", "workspace_id", "status"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="confidence_range"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ClaimStatus] = mapped_column(db_enum(ClaimStatus, "claim_status"), default=ClaimStatus.extracted, nullable=False)
    extraction_method: Mapped[ExtractionMethod] = mapped_column(db_enum(ExtractionMethod, "extraction_method"), nullable=False)
    extractor: Mapped[str | None] = mapped_column(String(120))  # model id or user reference
    confidence: Mapped[float | None] = mapped_column(Float)
    kind: Mapped[ClaimKind] = mapped_column(db_enum(ClaimKind, "claim_kind"), default=ClaimKind.explicit, nullable=False)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="SET NULL"), index=True)
    extraction_execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))
    subject_entity_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("graph_entities.id", ondelete="SET NULL"))
    # Time the claim refers to, as stated in the evidence (free text such as 2019-2021); not parsed.
    temporal_scope: Mapped[str | None] = mapped_column(String(120))
    normalized_statement: Mapped[str | None] = mapped_column(String(600), index=True)
    graph_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Evidence(UUIDPrimaryKey, Timestamps, Base):
    """The exact span of a document that supports, contradicts or contextualises a claim."""

    __tablename__ = "evidence"
    __table_args__ = (Index("ix_evidence_claim_stance", "claim_id", "stance"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    claim_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    locator: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)  # page / section / char offsets
    stance: Mapped[EvidenceStance] = mapped_column(db_enum(EvidenceStance, "evidence_stance"), nullable=False)


class GraphEntity(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "graph_entities"
    __table_args__ = (
        UniqueConstraint("workspace_id", "graph_key", name="uq_graph_entities_workspace_key"),
        UniqueConstraint("workspace_id", "entity_type", "normalized_name", name="uq_graph_entities_dedup"),
        Index("ix_graph_entities_workspace_type", "workspace_id", "entity_type"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    graph_key: Mapped[str] = mapped_column(String(128), nullable=False)  # Neo4j node key
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[EntityStatus] = mapped_column(db_enum(EntityStatus, "entity_status"), default=EntityStatus.proposed, nullable=False)
    first_seen_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("graph_entities.id", ondelete="SET NULL"))
    properties: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    # Deduplication key: lower-cased, punctuation-free, whitespace-collapsed name.
    normalized_name: Mapped[str | None] = mapped_column(String(500))
    aliases: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    mention_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    graph_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GraphRelationship(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "graph_relationships"
    __table_args__ = (
        UniqueConstraint("workspace_id", "graph_key", name="uq_graph_relationships_workspace_key"),
        UniqueConstraint("workspace_id", "source_entity_id", "target_entity_id", "relation_type", name="uq_graph_relationships_triple"),
        Index("ix_graph_relationships_source", "source_entity_id"),
        Index("ix_graph_relationships_target", "target_entity_id"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="confidence_range"),
        CheckConstraint("source_entity_id <> target_entity_id", name="no_self_loop"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    graph_key: Mapped[str] = mapped_column(String(128), nullable=False)  # Neo4j relationship key
    source_entity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False)
    target_entity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[RelationshipStatus] = mapped_column(db_enum(RelationshipStatus, "relationship_status"), default=RelationshipStatus.extracted, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("evidence.id", ondelete="SET NULL"), index=True)
    properties: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    support_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    graph_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RelationshipClaim(Base):
    """Every claim that supports a relationship. A relationship with no claims has no provenance."""

    __tablename__ = "relationship_claims"

    relationship_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_relationships.id", ondelete="CASCADE"), primary_key=True)
    claim_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), primary_key=True)


class InvestigationClaim(Base):
    """Which investigations found a claim. A claim is stored once per document (``Claim.investigation_id``
    is the run that first extracted it); every later investigation that finds it again links to it here."""

    __tablename__ = "investigation_claims"

    investigation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), primary_key=True)
    claim_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), primary_key=True, index=True)


def investigation_claim_ids(investigation_id: uuid.UUID):  # noqa: ANN201
    """Subquery of claim ids an investigation found (new or already known)."""
    from sqlalchemy import select

    return select(InvestigationClaim.claim_id).where(InvestigationClaim.investigation_id == investigation_id)


class GraphSnapshot(UUIDPrimaryKey, Timestamps, Base):
    """A point-in-time record of a workspace graph, used to track how knowledge evolves."""

    __tablename__ = "graph_snapshots"
    __table_args__ = (
        Index("ix_graph_snapshots_workspace_captured", "workspace_id", "captured_at"),
        CheckConstraint("node_count >= 0 AND relationship_count >= 0", name="counts_non_negative"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    node_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    relationship_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64))
    storage_uri: Mapped[str | None] = mapped_column(String(2048))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    details: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
