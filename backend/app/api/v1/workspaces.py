import uuid

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession, Limit, Offset
from app.schemas.common import ErrorResponse, Page
from app.schemas.source import DocumentRead, SourceCreate, SourceRead
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead
from app.services import sources as source_service
from app.services import workspaces as workspace_service

router = APIRouter(prefix="/workspaces", tags=["workspaces"])
ERRORS = {401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED, responses=ERRORS, summary="Create a workspace you own")
def create_workspace(payload: WorkspaceCreate, user: CurrentUser, db: DbSession) -> WorkspaceRead:
    return workspace_service.create_workspace(db, user, payload)


@router.get("", response_model=Page[WorkspaceRead], responses=ERRORS, summary="List your workspaces (newest first)")
def list_workspaces(user: CurrentUser, db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[WorkspaceRead]:
    items, total = workspace_service.list_workspaces(db, user, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/{workspace_id}", response_model=WorkspaceRead, responses=ERRORS, summary="Get one of your workspaces")
def get_workspace(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession) -> WorkspaceRead:
    return workspace_service.get_workspace(db, user, workspace_id)


@router.post("/{workspace_id}/sources", response_model=SourceRead, status_code=status.HTTP_201_CREATED, responses=ERRORS, summary="Register a source")
def create_source(workspace_id: uuid.UUID, payload: SourceCreate, user: CurrentUser, db: DbSession) -> SourceRead:
    return source_service.create_source(db, user, workspace_id, payload)


@router.get("/{workspace_id}/sources", response_model=Page[SourceRead], responses=ERRORS, summary="List sources in a workspace")
def list_sources(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[SourceRead]:
    items, total = source_service.list_sources(db, user, workspace_id, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/{workspace_id}/documents", response_model=Page[DocumentRead], responses=ERRORS, summary="List documents across a workspace")
def list_documents(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[DocumentRead]:
    items, total = source_service.list_workspace_documents(db, user, workspace_id, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)
