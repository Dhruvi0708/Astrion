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
    draft = "draft"  # created, never run
    queued = "queued"  # accepted for execution
    running = "running"
    cancelling = "cancelling"  # cancel requested; stops at the next step boundary
    completed = "completed"  # every required step succeeded
    failed = "failed"  # a required step failed after retries
    cancelled = "cancelled"
    interrupted = "interrupted"  # process stopped mid-run; can be resumed


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
    system = "system"  # deterministic pipeline steps (document ingestion)
    orchestrator = "orchestrator"
    research = "research"
    knowledge = "knowledge"
    hypothesis = "hypothesis"
    contradiction = "contradiction"
    verification = "verification"
    synthesis = "synthesis"


class ExecutionStatus(StrEnum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"
    skipped = "skipped"  # nothing to do (e.g. no documents); recorded, never counted as success


class ClaimKind(StrEnum):
    explicit = "explicit"  # stated directly in the quoted evidence
    inferred = "inferred"  # the agent's inference from the evidence


class ContradictionKind(StrEnum):
    direct = "direct"  # incompatible statements about the same thing
    temporal = "temporal"  # conflict explained by / involving different times
    contextual = "contextual"  # apparent conflict, different conditions or scope


class VerificationVerdict(StrEnum):
    supported = "supported"
    partially_supported = "partially_supported"
    unsupported = "unsupported"
    insufficient_evidence = "insufficient_evidence"
    contradicted = "contradicted"


class GraphChangeType(StrEnum):
    entity_created = "entity_created"
    entity_updated = "entity_updated"
    entity_merged = "entity_merged"
    relationship_created = "relationship_created"
    relationship_reinforced = "relationship_reinforced"
    claim_added = "claim_added"
    contradiction_linked = "contradiction_linked"
    hypothesis_added = "hypothesis_added"


class ScenarioStatus(StrEnum):
    draft = "draft"
    ready = "ready"
    running = "running"
    completed = "completed"
    failed = "failed"
