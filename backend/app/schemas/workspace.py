import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.models.enums import WorkspaceStatus
from app.schemas.common import ORMModel


class WorkspaceCreate(ORMModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class WorkspaceRead(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    status: WorkspaceStatus
    source_count: int = 0
    created_at: datetime
    updated_at: datetime
