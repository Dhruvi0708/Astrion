"""Investigations, hypotheses, agent executions and simulation scenarios."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey
from app.models.enums import (
    AgentRole,
    EvidenceStance,
    ExecutionStatus,
    HypothesisOrigin,
    InvestigationStatus,
    ScenarioStatus,
    VerificationStatus,
    db_enum,
)


class Investigation(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "investigations"
    __table_args__ = (Index("ix_investigations_workspace_status", "workspace_id", "status"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    status: Mapped[InvestigationStatus] = mapped_column(db_enum(InvestigationStatus, "investigation_status"), default=InvestigationStatus.draft, nullable=False)


class AgentExecution(UUIDPrimaryKey, Timestamps, Base):
    """One agent step. ``parent_execution_id`` records the handoff chain between agents."""

    __tablename__ = "agent_executions"
    __table_args__ = (
        Index("ix_agent_executions_investigation_created", "investigation_id", "created_at"),
        Index("ix_agent_executions_workspace_status", "workspace_id", "status"),
        CheckConstraint("finished_at IS NULL OR started_at IS NOT NULL", name="finished_after_start"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"))
    parent_execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))
    agent_role: Mapped[AgentRole] = mapped_column(db_enum(AgentRole, "agent_role"), nullable=False)
    status: Mapped[ExecutionStatus] = mapped_column(db_enum(ExecutionStatus, "execution_status"), default=ExecutionStatus.pending, nullable=False)
    # Provider identity, recorded for every execution so results stay auditable.
    provider: Mapped[str | None] = mapped_column(String(32))
    model_requested: Mapped[str | None] = mapped_column(String(120))
    model: Mapped[str | None] = mapped_column(String(120))  # model that actually served the response
    # Non-null only when an explicitly configured fallback model was used; explains why.
    fallback_reason: Mapped[str | None] = mapped_column(String(120))
    provider_request_id: Mapped[str | None] = mapped_column(String(120))
    input: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    output: Mapped[dict | None] = mapped_column(JSONType)
    error: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Hypothesis(UUIDPrimaryKey, Timestamps, Base):
    """A proposed explanation. Becomes a *verified discovery* only with a recorded verifier and evidence."""

    __tablename__ = "hypotheses"
    __table_args__ = (
        Index("ix_hypotheses_workspace_status", "workspace_id", "status"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="confidence_range"),
        # A hypothesis can never be marked verified without a recorded verification time.
        CheckConstraint("status <> 'verified' OR verified_at IS NOT NULL", name="verified_requires_timestamp"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="SET NULL"), index=True)
    generated_by_execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text)
    origin: Mapped[HypothesisOrigin] = mapped_column(db_enum(HypothesisOrigin, "hypothesis_origin"), nullable=False)
    status: Mapped[VerificationStatus] = mapped_column(
        db_enum(VerificationStatus, "verification_status"), default=VerificationStatus.unverified, nullable=False
    )
    confidence: Mapped[float | None] = mapped_column(Float)
    verified_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_note: Mapped[str | None] = mapped_column(Text)


class HypothesisEvidence(Base):
    """Links a hypothesis to the evidence that supports or weakens it."""

    __tablename__ = "hypothesis_evidence"

    hypothesis_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hypotheses.id", ondelete="CASCADE"), primary_key=True)
    evidence_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True)
    stance: Mapped[EvidenceStance] = mapped_column(db_enum(EvidenceStance, "hypothesis_evidence_stance"), nullable=False)


class SimulationScenario(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "simulation_scenarios"
    __table_args__ = (Index("ix_simulation_scenarios_workspace_status", "workspace_id", "status"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="SET NULL"))
    baseline_scenario_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("simulation_scenarios.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ScenarioStatus] = mapped_column(db_enum(ScenarioStatus, "scenario_status"), default=ScenarioStatus.draft, nullable=False)
    parameters: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    assumptions: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    results: Mapped[dict | None] = mapped_column(JSONType)
    # True for toy / demonstration models; real engine output must set this to False explicitly.
    is_illustrative: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
