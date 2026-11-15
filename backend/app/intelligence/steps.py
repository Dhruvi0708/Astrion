"""Step types shared by the orchestrator and its Phase 3 adaptive mixin."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from pydantic import BaseModel

from app.intelligence import contracts as c
from app.intelligence.agents import AgentRun
from app.models import Claim
from app.models.enums import AgentRole


class Cancelled(Exception):
    pass


class StepFailed(Exception):
    def __init__(self, step_key: str, message: str) -> None:
        super().__init__(f"{step_key}: {message}")
        self.step_key = step_key


class BudgetExhausted(StepFailed):
    """A mandatory step would exceed the run budget (calls, tokens or cost)."""


@dataclass
class StepSpec:
    name: str
    role: AgentRole
    call: Callable[[], AgentRun]
    input: dict
    output_type: type[BaseModel]
    depends_on: list[str] = field(default_factory=list)
    summarize: Callable[[BaseModel], str] = lambda o: ""


@dataclass
class StepOutcome:
    output: BaseModel
    execution_id: uuid.UUID
    reused: bool


@dataclass
class ClaimIndex:
    """Short refs (C1…) shown to agents, mapped to claims."""

    by_ref: dict[str, Claim] = field(default_factory=dict)
    views: list[c.ClaimView] = field(default_factory=list)
    source_of: dict[str, uuid.UUID] = field(default_factory=dict)
    group_of: dict[str, str] = field(default_factory=dict)  # independence group of each claim's source

    def ref_of(self, claim_id: uuid.UUID) -> str | None:
        return next((r for r, cl in self.by_ref.items() if cl.id == claim_id), None)
