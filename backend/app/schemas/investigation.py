import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.models.enums import AgentRole, ExecutionStatus, InvestigationStatus
from app.schemas.common import ORMModel


class InvestigationCreate(ORMModel):
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=10, max_length=4000)
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)

    @field_validator("title", "question")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class StageProgress(ORMModel):
    stage: str
    role: AgentRole
    status: str  # pending | running | succeeded | failed | skipped | cancelled
    steps: int
    succeeded: int
    failed: int
    summary: str | None = None


class InvestigationRead(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    question: str
    status: InvestigationStatus
    document_ids: list[str]
    summary: str | None
    error: str | None
    run_count: int
    started_at: datetime | None
    finished_at: datetime | None
    llm_provider: str | None
    llm_model: str | None
    input_tokens: int
    output_tokens: int
    cost_usd: float
    created_at: datetime
    updated_at: datetime


class InvestigationDetail(InvestigationRead):
    plan: dict | None
    progress: list[StageProgress]
    counts: dict[str, int]
    can_start: bool
    can_resume: bool
    can_cancel: bool


class ExecutionRead(ORMModel):
    id: uuid.UUID
    step_key: str | None
    agent_role: AgentRole
    status: ExecutionStatus
    attempt: int
    parent_execution_id: uuid.UUID | None
    depends_on: list[str]
    provider: str | None
    model_requested: str | None
    model: str | None
    provider_request_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    duration_ms: int | None
    summary: str | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    input: dict
    output: dict | None


class IntelligenceStatus(ORMModel):
    configured: bool
    provider: str | None
    model: str | None
    is_fixture: bool
    neo4j_configured: bool
    detail: str
