import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.api.deps import CurrentUser, DbSession, Graph, Limit, Offset
from app.core.config import get_settings
from app.intelligence.llm import StructuredLLM
from app.intelligence.wiring import get_intelligence_llm
from app.schemas.common import ErrorResponse, Page
from app.schemas.investigation import ExecutionRead, IntelligenceStatus, InvestigationCreate, InvestigationDetail, InvestigationRead
from app.services import graph as graph_service
from app.services import investigations as svc

router = APIRouter(tags=["investigations"])
ERRORS = {401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
LIFECYCLE = {**ERRORS, 409: {"model": ErrorResponse}, 503: {"model": ErrorResponse}}
LLM = Annotated[StructuredLLM | None, Depends(get_intelligence_llm)]


def _runner(request: Request):  # noqa: ANN202
    return request.app.state.investigation_runner


@router.get("/intelligence/status", response_model=IntelligenceStatus, summary="Which AI provider will run investigations")
def intelligence_status(user: CurrentUser, llm: LLM) -> IntelligenceStatus:
    settings = get_settings()
    if llm is None:
        return IntelligenceStatus(
            configured=False,
            provider=None,
            model=None,
            is_fixture=False,
            neo4j_configured=settings.neo4j_configured,
            detail="No LLM provider configured: set ANTHROPIC_API_KEY on the server.",
        )
    fixture = llm.provider == "fixture"
    detail = (
        "Deterministic fixture provider (rule-based, not AI). For development and tests only."
        if fixture
        else f"Investigations run on {llm.model} via {llm.provider}."
    )
    return IntelligenceStatus(
        configured=True, provider=llm.provider, model=llm.model, is_fixture=fixture, neo4j_configured=settings.neo4j_configured, detail=detail
    )


@router.post("/workspaces/{workspace_id}/investigations", response_model=InvestigationRead, status_code=status.HTTP_201_CREATED, responses=ERRORS)
def create_investigation(workspace_id: uuid.UUID, payload: InvestigationCreate, user: CurrentUser, db: DbSession) -> InvestigationRead:
    return svc.create(db, user, workspace_id, payload)


@router.get("/workspaces/{workspace_id}/investigations", response_model=Page[InvestigationRead], responses=ERRORS)
def list_investigations(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[InvestigationRead]:
    items, total = svc.list_for_workspace(db, user, workspace_id, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/workspaces/{workspace_id}/investigations/compare", responses=ERRORS, summary="Compare findings across investigations")
def compare_investigations(
    workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, ids: Annotated[str, Query(description="Comma-separated investigation ids (2–5)")]
) -> dict:
    parsed = [uuid.UUID(x.strip()) for x in ids.split(",") if x.strip()][:5]
    return svc.compare(db, user, workspace_id, parsed)


@router.get("/investigations/{investigation_id}", response_model=InvestigationDetail, responses=ERRORS)
def get_investigation(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> InvestigationDetail:
    return svc.detail(db, user, investigation_id)


@router.get("/investigations/{investigation_id}/status", response_model=InvestigationDetail, responses=ERRORS, summary="Execution status (poll while running)")
def investigation_status(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> InvestigationDetail:
    return svc.detail(db, user, investigation_id)


@router.post(
    "/investigations/{investigation_id}/start",
    response_model=InvestigationDetail,
    status_code=status.HTTP_202_ACCEPTED,
    responses=LIFECYCLE,
    summary="Start a new run",
)
def start_investigation(investigation_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession, llm: LLM) -> InvestigationDetail:
    inv = svc.start(db, user, investigation_id, llm is not None)
    _runner(request).submit(inv.id)
    db.expire_all()
    return svc.detail(db, user, investigation_id)


@router.post(
    "/investigations/{investigation_id}/resume",
    response_model=InvestigationDetail,
    status_code=status.HTTP_202_ACCEPTED,
    responses=LIFECYCLE,
    summary="Resume an interrupted or failed run",
)
def resume_investigation(investigation_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession, llm: LLM) -> InvestigationDetail:
    inv = svc.resume(db, user, investigation_id, llm is not None)
    _runner(request).submit(inv.id)
    db.expire_all()
    return svc.detail(db, user, investigation_id)


@router.post("/investigations/{investigation_id}/cancel", response_model=InvestigationDetail, status_code=status.HTTP_202_ACCEPTED, responses=LIFECYCLE)
def cancel_investigation(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> InvestigationDetail:
    svc.cancel(db, user, investigation_id)
    return svc.detail(db, user, investigation_id)


@router.get("/investigations/{investigation_id}/executions", response_model=list[ExecutionRead], responses=ERRORS, summary="Agent execution trace")
def list_executions(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[ExecutionRead]:
    return [ExecutionRead.model_validate(e) for e in svc.executions(db, user, investigation_id)]


@router.get("/investigations/{investigation_id}/claims", responses=ERRORS)
def list_claims(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    return svc.claims(db, user, investigation_id)


@router.get("/investigations/{investigation_id}/hypotheses", responses=ERRORS)
def list_hypotheses(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    return svc.hypotheses(db, user, investigation_id)


@router.get("/investigations/{investigation_id}/contradictions", responses=ERRORS)
def list_contradictions(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    return svc.contradictions(db, user, investigation_id)


@router.get("/investigations/{investigation_id}/verifications", responses=ERRORS)
def list_verifications(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    return svc.verifications(db, user, investigation_id)


@router.get("/investigations/{investigation_id}/reports", responses=ERRORS, summary="Reports, newest run first")
def list_reports(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    return svc.reports(db, user, investigation_id)


@router.get("/investigations/{investigation_id}/graph-changes", responses=ERRORS)
def list_graph_changes(investigation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    return svc.graph_changes(db, user, investigation_id)


@router.get("/workspaces/{workspace_id}/graph", responses=ERRORS, summary="Query the workspace knowledge graph")
def workspace_graph(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    graph: Graph,
    investigation_id: uuid.UUID | None = None,
    include_claims: bool = False,
    limit: Annotated[int, Query(ge=1, le=1000)] = 300,
) -> dict:
    return graph_service.workspace_graph(db, user, workspace_id, graph, investigation_id, include_claims, limit)


@router.get("/workspaces/{workspace_id}/graph/entities/{entity_id}", responses=ERRORS, summary="Entity with claims, evidence and relationships")
def entity_detail(workspace_id: uuid.UUID, entity_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    return graph_service.entity_detail(db, user, workspace_id, entity_id)


@router.get("/workspaces/{workspace_id}/graph/consistency", responses=ERRORS, summary="Compare the PostgreSQL registry with Neo4j")
def graph_consistency(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession, graph: Graph) -> dict:
    return graph_service.consistency(db, user, workspace_id, graph)
