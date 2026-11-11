"""Sources (provenance records) and documents (concrete artifacts)."""

import uuid
from datetime import date

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey
from app.models.enums import DocumentProcessingStatus, SourceStatus, SourceType, db_enum
from app.models.identity import Workspace


class Source(UUIDPrimaryKey, Timestamps, Base):
    """Where knowledge comes from: a publication, dataset, report or site, with bibliographic provenance."""

    __tablename__ = "sources"
    __table_args__ = (Index("ix_sources_workspace_created", "workspace_id", "created_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    source_type: Mapped[SourceType] = mapped_column(db_enum(SourceType, "source_type"), nullable=False)
    uri: Mapped[str | None] = mapped_column(String(2048))
    citation: Mapped[str | None] = mapped_column(Text)
    authors: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    published_on: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[SourceStatus] = mapped_column(db_enum(SourceStatus, "source_status"), default=SourceStatus.registered, nullable=False)
    attributes: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)

    workspace: Mapped[Workspace] = relationship(back_populates="sources")
    documents: Mapped[list["Document"]] = relationship(back_populates="source", cascade="all, delete-orphan", passive_deletes=True)


class Document(UUIDPrimaryKey, Timestamps, Base):
    """A specific artifact (file / version) belonging to a source. Claims and evidence point at documents."""

    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_source_created", "source_id", "created_at"),
        Index("ix_documents_workspace_status", "workspace_id", "processing_status"),
        Index("ix_documents_content_hash", "content_hash"),
        CheckConstraint("byte_size IS NULL OR byte_size >= 0", name="byte_size_non_negative"),
        CheckConstraint("version >= 1", name="version_positive"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    media_type: Mapped[str] = mapped_column(String(255), nullable=False)
    byte_size: Mapped[int | None] = mapped_column(BigInteger)
    content_hash: Mapped[str | None] = mapped_column(String(64))  # SHA-256 hex
    storage_uri: Mapped[str | None] = mapped_column(String(2048))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    processing_status: Mapped[DocumentProcessingStatus] = mapped_column(
        db_enum(DocumentProcessingStatus, "document_processing_status"), default=DocumentProcessingStatus.registered, nullable=False
    )
    processing_error: Mapped[str | None] = mapped_column(Text)

    source: Mapped[Source] = relationship(back_populates="documents")
