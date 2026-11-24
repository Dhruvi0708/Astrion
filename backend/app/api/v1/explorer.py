"""Workspace dashboard, intelligence explorer, graph search and neighbourhoods, document processing."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession, Graph, Limit, Offset, Storage
from app.schemas.common import ErrorResponse
from app.services import explorer as svc

router = APIRouter(tags=["explorer"])
ERRORS = {401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
Search = Annotated[str | None, Query(max_length=200)]


def _page(items: list, total: int, limit: int, offset: int) -> dict:
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/workspaces/{workspace_id}/dashboard", responses=ERRORS, summary="Workspace intelligence state (all counts from stored records)")
def dashboard(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    return svc.dashboard(db, user, workspace_id)


@router.get("/workspaces/{workspace_id}/entities", responses=ERRORS, summary="Entity library")
def entities(
    workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, q: Search = None, entity_type: Search = None, limit: Limit = 50, offset: Offset = 0
) -> dict:
    items, total = svc.entities(db, user, workspace_id, q, entity_type, limit, offset)
    return _page(items, total, limit, offset)


@router.get("/workspaces/{workspace_id}/hypotheses", responses=ERRORS, summary="Hypotheses across investigations")
def hypotheses(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    q: Search = None,
    status: Search = None,
    consensus: Search = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> dict:
    items, total = svc.hypotheses(db, user, workspace_id, q, status, consensus, limit, offset)
    return _page(items, total, limit, offset)


@router.get("/workspaces/{workspace_id}/contradictions", responses=ERRORS, summary="Contradictions across investigations")
def contradictions(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, resolved: bool | None = None, limit: Limit = 50, offset: Offset = 0) -> dict:
    items, total = svc.contradictions(db, user, workspace_id, resolved, limit, offset)
    return _page(items, total, limit, offset)


@router.get("/workspaces/{workspace_id}/evidence", responses=ERRORS, summary="Evidence with full provenance")
def evidence(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, q: Search = None, limit: Limit = 50, offset: Offset = 0) -> dict:
    items, total = svc.evidence(db, user, workspace_id, q, limit, offset)
    return _page(items, total, limit, offset)


@router.get("/workspaces/{workspace_id}/graph/search", responses=ERRORS, summary="Find entities by name")
def graph_search(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, q: Annotated[str, Query(min_length=1, max_length=200)]) -> list[dict]:
    return svc.graph_search(db, user, workspace_id, q)


@router.get("/workspaces/{workspace_id}/graph/entities/{entity_id}/neighbourhood", responses=ERRORS, summary="Expand an entity's neighbourhood")
def neighbourhood(
    workspace_id: uuid.UUID, entity_id: uuid.UUID, user: CurrentUser, db: DbSession, graph: Graph, depth: Annotated[int, Query(ge=1, le=3)] = 1
) -> dict:
    return svc.neighbourhood(db, user, workspace_id, entity_id, depth, graph)


@router.post("/documents/{document_id}/process", responses=ERRORS, summary="Extract a stored document's text now")
def process_document(document_id: uuid.UUID, user: CurrentUser, db: DbSession, storage: Storage) -> dict:
    return svc.process_document(db, user, storage, document_id)


@router.get("/documents/{document_id}/intelligence", responses=ERRORS, summary="What ASTRION extracted from a document")
def document_intelligence(document_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    return svc.document_intelligence(db, user, document_id)
