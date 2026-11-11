import time
from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import text

from app import __version__
from app.api.deps import DbSession, Graph
from app.core.config import get_settings
from app.schemas.health import DependencyHealth, ServiceHealth

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=ServiceHealth, summary="API liveness")
def service_health() -> ServiceHealth:
    settings = get_settings()
    return ServiceHealth(status="ok", service="astrion-api", version=__version__, environment=settings.environment, timestamp=datetime.now(UTC))


@router.get("/postgres", response_model=DependencyHealth, summary="PostgreSQL connectivity")
def postgres_health(db: DbSession) -> DependencyHealth:
    start = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — any failure means "unavailable"; details stay server-side
        return DependencyHealth(name="postgres", status="unavailable", detail=f"{type(exc).__name__}: connection failed")
    return DependencyHealth(name="postgres", status="ok", latency_ms=round((time.perf_counter() - start) * 1000, 2))


@router.get("/neo4j", response_model=DependencyHealth, summary="Neo4j connectivity")
def neo4j_health(graph: Graph) -> DependencyHealth:
    h = graph.health()
    return DependencyHealth(name="neo4j", status=h.status, latency_ms=h.latency_ms, detail=h.detail)
