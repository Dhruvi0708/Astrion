"""Users and workspaces."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey
from app.models.enums import UserStatus, WorkspaceStatus, db_enum


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"

    # Stored lower-cased; uniqueness is therefore case-insensitive.
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[UserStatus] = mapped_column(db_enum(UserStatus, "user_status"), default=UserStatus.active, nullable=False)
    # Argon2id hash. NULL means the account cannot sign in with a password.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthSession(UUIDPrimaryKey, Timestamps, Base):
    """A refresh-token session. Access tokens reference it (``sid``), so revoking it logs out immediately.

    Refresh tokens rotate on every use. ``family_id`` groups a chain of rotations: presenting an
    already-rotated token is treated as theft and revokes the whole family.
    """

    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_user_active", "user_id", "revoked_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(32))
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("auth_sessions.id", ondelete="SET NULL"))
    user_agent: Mapped[str | None] = mapped_column(String(400))
    ip_address: Mapped[str | None] = mapped_column(String(64))


class Workspace(UUIDPrimaryKey, Timestamps, Base):
    """A bounded line of inquiry. Every other domain object belongs to exactly one workspace."""

    __tablename__ = "workspaces"
    __table_args__ = (
        Index("ix_workspaces_status_updated", "status", "updated_at"),
        UniqueConstraint("owner_id", "slug", name="uq_workspaces_owner_slug"),
    )

    # Workspaces created before authentication existed have no owner and are inaccessible via the API.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[WorkspaceStatus] = mapped_column(db_enum(WorkspaceStatus, "workspace_status"), default=WorkspaceStatus.active, nullable=False)
    settings: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)

    owner: Mapped[User | None] = relationship()
    sources: Mapped[list["Source"]] = relationship(back_populates="workspace", cascade="all, delete-orphan", passive_deletes=True)  # noqa: F821
