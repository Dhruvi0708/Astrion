"""Workspace use-cases. Every function is scoped to the authenticated user.

Authorization rule: a workspace is visible only to its owner. Requests for another user's workspace
return 404 (not 403) so the API does not confirm that the resource exists.
"""

import re
import unicodedata
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models import Source, User, Workspace
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value[:120] or "workspace"


def _unique_slug(db: Session, owner_id: uuid.UUID, name: str) -> str:
    base = slugify(name)
    taken = set(db.scalars(select(Workspace.slug).where(Workspace.owner_id == owner_id, Workspace.slug.like(f"{base}%"))))
    if base not in taken:
        return base
    i = 2
    while f"{base}-{i}" in taken:
        i += 1
    return f"{base}-{i}"


def _source_counts(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = db.execute(select(Source.workspace_id, func.count()).where(Source.workspace_id.in_(ids)).group_by(Source.workspace_id))
    return {wid: n for wid, n in rows}


def to_read(ws: Workspace, source_count: int) -> WorkspaceRead:
    return WorkspaceRead.model_validate(ws).model_copy(update={"source_count": source_count})


def create_workspace(db: Session, user: User, payload: WorkspaceCreate) -> WorkspaceRead:
    ws = Workspace(
        owner_id=user.id,  # ownership always comes from the authenticated identity
        name=payload.name,
        description=payload.description,
        slug=_unique_slug(db, user.id, payload.name),
        settings={},
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return to_read(ws, 0)


def list_workspaces(db: Session, user: User, limit: int, offset: int) -> tuple[list[WorkspaceRead], int]:
    where = Workspace.owner_id == user.id
    total = db.scalar(select(func.count()).select_from(Workspace).where(where)) or 0
    rows = list(db.scalars(select(Workspace).where(where).order_by(Workspace.created_at.desc(), Workspace.id).limit(limit).offset(offset)))
    counts = _source_counts(db, [w.id for w in rows])
    return [to_read(w, counts.get(w.id, 0)) for w in rows], total


def get_owned_workspace(db: Session, user: User, workspace_id: uuid.UUID) -> Workspace:
    ws = db.get(Workspace, workspace_id)
    if ws is None or ws.owner_id != user.id:
        raise NotFoundError(f"Workspace {workspace_id} was not found.")
    return ws


def get_workspace(db: Session, user: User, workspace_id: uuid.UUID) -> WorkspaceRead:
    ws = get_owned_workspace(db, user, workspace_id)
    return to_read(ws, _source_counts(db, [ws.id]).get(ws.id, 0))
