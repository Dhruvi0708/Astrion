"""Users and workspaces."""

import uuid

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey
from app.models.enums import UserStatus, WorkspaceStatus, db_enum


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[UserStatus] = mapped_column(db_enum(UserStatus, "user_status"), default=UserStatus.active, nullable=False)


class Workspace(UUIDPrimaryKey, Timestamps, Base):
    """A bounded line of inquiry. Every other domain object belongs to exactly one workspace."""

    __tablename__ = "workspaces"
    __table_args__ = (Index("ix_workspaces_status_updated", "status", "updated_at"),)

    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[WorkspaceStatus] = mapped_column(
        db_enum(WorkspaceStatus, "workspace_status"), default=WorkspaceStatus.active, nullable=False
    )
    settings: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)

    owner: Mapped[User | None] = relationship()
    sources: Mapped[list["Source"]] = relationship(back_populates="workspace", cascade="all, delete-orphan", passive_deletes=True)  # noqa: F821
