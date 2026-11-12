import uuid
from datetime import date, datetime

from pydantic import AnyHttpUrl, Field, field_validator

from app.models.enums import DocumentProcessingStatus, SourceStatus, SourceType
from app.schemas.common import ORMModel


class SourceCreate(ORMModel):
    title: str = Field(min_length=1, max_length=500)
    source_type: SourceType
    uri: AnyHttpUrl | None = None
    citation: str | None = Field(default=None, max_length=2000)
    authors: list[str] = Field(default_factory=list, max_length=100)
    published_on: date | None = None
    description: str | None = Field(default=None, max_length=5000)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("authors")
    @classmethod
    def _clean_authors(cls, v: list[str]) -> list[str]:
        cleaned = [a.strip() for a in v if a and a.strip()]
        if any(len(a) > 200 for a in cleaned):
            raise ValueError("author names must be at most 200 characters")
        return cleaned


class SourceRead(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    source_type: SourceType
    uri: str | None
    citation: str | None
    authors: list[str]
    published_on: date | None
    description: str | None
    status: SourceStatus
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class DocumentCreate(ORMModel):
    title: str = Field(min_length=1, max_length=500)
    media_type: str = Field(min_length=3, max_length=255, pattern=r"^[\w.+-]+/[\w.+-]+$")
    byte_size: int | None = Field(default=None, ge=0)
    content_hash: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{64}$", description="SHA-256 hex digest")
    storage_uri: str | None = Field(default=None, max_length=2048)

    @field_validator("content_hash")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return v.lower() if v else v


class DocumentRead(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    source_id: uuid.UUID
    title: str
    media_type: str
    byte_size: int | None
    content_hash: str | None
    storage_uri: str | None
    original_filename: str | None = None
    storage_backend: str | None = None
    has_file: bool = False  # derived from Document.has_file; the storage key itself is never exposed
    processing_status: DocumentProcessingStatus
    created_at: datetime
    updated_at: datetime
