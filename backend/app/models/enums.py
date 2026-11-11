"""Status vocabularies. Stored as VARCHAR + CHECK constraint (non-native enums) so values can evolve via migrations."""

from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def db_enum(enum_cls: type[StrEnum], name: str) -> SAEnum:
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


class UserStatus(StrEnum):
    active = "active"
    disabled = "disabled"


class WorkspaceStatus(StrEnum):
    active = "active"
    archived = "archived"


class SourceType(StrEnum):
    paper = "paper"
    report = "report"
    dataset = "dataset"
    article = "article"
    document = "document"
    web = "web"
    other = "other"


class SourceStatus(StrEnum):
    registered = "registered"
    archived = "archived"


class DocumentProcessingStatus(StrEnum):
    registered = "registered"
    queued = "queued"
    processing = "processing"
    processed = "processed"
    failed = "failed"


class ClaimStatus(StrEnum):
    extracted = "extracted"
    challenged = "challenged"
    accepted = "accepted"
    rejected = "rejected"


class ExtractionMethod(StrEnum):
    manual = "manual"
    model = "model"


class EvidenceStance(StrEnum):
    supports = "supports"
    contradicts = "contradicts"
    context = "context"


class EntityStatus(StrEnum):
    proposed = "proposed"
    active = "active"
    merged = "merged"
    retired = "retired"


class RelationshipStatus(StrEnum):
    extracted = "extracted"
    hypothesized = "hypothesized"
    verified = "verified"
    rejected = "rejected"


class InvestigationStatus(StrEnum):
    draft = "draft"
    active = "active"
    paused = "paused"
    closed = "closed"


class HypothesisOrigin(StrEnum):
    human = "human"
    ai_generated = "ai_generated"


class VerificationStatus(StrEnum):
    unverified = "unverified"
    in_review = "in_review"
    conditional = "conditional"
    verified = "verified"
    refuted = "refuted"


class AgentRole(StrEnum):
    inquirer = "inquirer"
    cartographer = "cartographer"
    retriever = "retriever"
    skeptic = "skeptic"
    verifier = "verifier"


class ExecutionStatus(StrEnum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class ScenarioStatus(StrEnum):
    draft = "draft"
    ready = "ready"
    running = "running"
    completed = "completed"
    failed = "failed"
