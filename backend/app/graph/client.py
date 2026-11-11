"""Neo4j connection abstraction.

The rest of the application depends on the ``GraphClient`` protocol, never on the Neo4j driver
directly, so the graph backend can be swapped or faked in tests. Phase 1 implements connection
management and health checks only — no extraction or traversal logic yet.
"""

import logging
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, Protocol

from app.core.config import Settings, get_settings

logger = logging.getLogger("astrion.graph")

GraphStatus = Literal["ok", "unavailable", "not_configured"]


@dataclass(frozen=True)
class GraphHealth:
    status: GraphStatus
    latency_ms: float | None = None
    detail: str | None = None


class GraphClient(Protocol):
    def health(self) -> GraphHealth: ...

    def close(self) -> None: ...


class UnconfiguredGraphClient:
    """Used when ASTRION_NEO4J_URI is empty. Reports honestly instead of pretending to connect."""

    def health(self) -> GraphHealth:
        return GraphHealth(status="not_configured", detail="ASTRION_NEO4J_URI is not set.")

    def close(self) -> None:
        return None


class Neo4jGraphClient:
    def __init__(self, settings: Settings) -> None:
        from neo4j import GraphDatabase  # imported lazily so the API starts without the driver being used

        self._database = settings.neo4j_database
        self._driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password.get_secret_value()),
            connection_timeout=settings.neo4j_timeout_seconds,
            connection_acquisition_timeout=settings.neo4j_timeout_seconds,
            max_transaction_retry_time=0,
        )

    def health(self) -> GraphHealth:
        from neo4j.exceptions import Neo4jError, ServiceUnavailable

        start = time.perf_counter()
        try:
            self._driver.verify_connectivity()
            records, _, _ = self._driver.execute_query("RETURN 1 AS ok", database_=self._database)
            ok = bool(records and records[0]["ok"] == 1)
        except (ServiceUnavailable, Neo4jError, OSError, ValueError) as exc:
            logger.warning("neo4j health check failed", extra={"error": type(exc).__name__})
            return GraphHealth(status="unavailable", detail=f"{type(exc).__name__}: connection failed")
        latency = round((time.perf_counter() - start) * 1000, 2)
        return GraphHealth(status="ok" if ok else "unavailable", latency_ms=latency)

    def close(self) -> None:
        self._driver.close()


@lru_cache
def get_graph_client() -> GraphClient:
    settings = get_settings()
    if not settings.neo4j_configured:
        return UnconfiguredGraphClient()
    return Neo4jGraphClient(settings)
