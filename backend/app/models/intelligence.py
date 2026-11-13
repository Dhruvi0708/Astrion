"""Phase 2 intelligence records: document passages, contradictions, verification results, reports and
the graph change log. PostgreSQL is the system of record for all of them."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey
from app.models.enums import ContradictionKind, GraphChangeType, VerificationVerdict, db_enum


class DocumentChunk(UUIDPrimaryKey, Timestamps, Base):
    """A passage of extracted document text. Evidence quotes must be found verbatim in a chunk."""

    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_document_chunks_position"),
        CheckConstraint("char_end >= char_start", name="span_ordered"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)  # offsets into the extracted text
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    page: Mapped[int | None] = mapped_column(Integer)  # 1-based, PDFs only


class Contradiction(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "contradictions"
    __table_args__ = (
        UniqueConstraint("investigation_id", "claim_a_id", "claim_b_id", name="uq_contradictions_pair"),
        CheckConstraint("claim_a_id <> claim_b_id", name="distinct_claims"),
        Index("ix_contradictions_workspace", "workspace_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    investigation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False, index=True)
    execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))
    claim_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    claim_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[ContradictionKind] = mapped_column(db_enum(ContradictionKind, "contradiction_kind"), nullable=False)
    # False when the agent concluded the conflict is only apparent (different context or time).
    is_genuine: Mapped[bool] = mapped_column(Boolean, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default="medium", nullable=False)


class VerificationResult(UUIDPrimaryKey, Timestamps, Base):
    """The Verification Agent's independent review of one hypothesis, contradiction or finding."""

    __tablename__ = "verification_results"
    __table_args__ = (Index("ix_verification_results_target", "target_type", "target_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    investigation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False, index=True)
    execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)  # hypothesis | contradiction
    target_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    verdict: Mapped[VerificationVerdict] = mapped_column(db_enum(VerificationVerdict, "verification_verdict"), nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    issues: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    missing_evidence: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    checked_claim_ids: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)


class InvestigationReport(UUIDPrimaryKey, Timestamps, Base):
    """Synthesis output for one run. Kept per run so earlier reports remain viewable."""

    __tablename__ = "investigation_reports"
    __table_args__ = (UniqueConstraint("investigation_id", "run_number", name="uq_investigation_reports_run"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    investigation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False, index=True)
    execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[dict] = mapped_column(JSONType, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(120))


class GraphChange(UUIDPrimaryKey, Timestamps, Base):
    """Append-only log of how an investigation changed the workspace knowledge graph."""

    __tablename__ = "graph_changes"
    __table_args__ = (Index("ix_graph_changes_investigation_created", "investigation_id", "created_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="SET NULL"))
    change_type: Mapped[GraphChangeType] = mapped_column(db_enum(GraphChangeType, "graph_change_type"), nullable=False)
    target_key: Mapped[str] = mapped_column(String(128), nullable=False)
    details: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
