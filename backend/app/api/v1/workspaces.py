import uuid

from fastapi import APIRouter, status

from app.api.deps import DbSession, Limit, Offset
from app.schemas.common import ErrorResponse, Page
from app.schemas.source import SourceCreate, SourceRead
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead
from app.services import sources as source_service
from app.services import workspaces as workspace_service

router = APIRouter(prefix="/workspaces", tags=["workspaces"])
NOT_FOUND = {404: {"model": ErrorResponse}}


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED, summary="Create a workspace")
def create_workspace(payload: WorkspaceCreate, db: DbSession) -> WorkspaceRead:
    return workspace_service.create_workspace(db, payload)


@router.get("", response_model=Page[WorkspaceRead], summary="List workspaces (newest first)")
def list_workspaces(db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[WorkspaceRead]:
    items, total = workspace_service.list_workspaces(db, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/{workspace_id}", response_model=WorkspaceRead, responses=NOT_FOUND, summary="Get a workspace")
def get_workspace(workspace_id: uuid.UUID, db: DbSession) -> WorkspaceRead:
    return workspace_service.get_workspace(db, workspace_id)


@router.post(
    "/{workspace_id}/sources", response_model=SourceRead, status_code=status.HTTP_201_CREATED, responses=NOT_FOUND, summary="Register a source"
)
def create_source(workspace_id: uuid.UUID, payload: SourceCreate, db: DbSession) -> SourceRead:
    return source_service.create_source(db, workspace_id, payload)


@router.get("/{workspace_id}/sources", response_model=Page[SourceRead], responses=NOT_FOUND, summary="List sources in a workspace")
def list_sources(workspace_id: uuid.UUID, db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[SourceRead]:
    items, total = source_service.list_sources(db, workspace_id, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)
