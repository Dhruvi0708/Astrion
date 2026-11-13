"""Builds the runner and orchestrator from application settings (kept out of main.py for testability)."""

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.db.session import get_sessionmaker
from app.graph.client import get_graph_client
from app.intelligence.llm import StructuredLLM, get_structured_llm
from app.intelligence.orchestrator import Orchestrator
from app.intelligence.runner import InvestigationRunner
from app.storage import get_storage


@lru_cache
def get_intelligence_llm() -> StructuredLLM | None:
    return get_structured_llm(get_settings())


def graph_repository():  # noqa: ANN201
    client = get_graph_client()
    factory = getattr(client, "repository", None)
    return factory() if factory else None


def build_runner(settings: Settings | None = None) -> InvestigationRunner:
    settings = settings or get_settings()
    sessions = get_sessionmaker()

    def orchestrator() -> Orchestrator:
        llm = get_intelligence_llm()
        if llm is None:
            raise RuntimeError("No LLM provider configured.")
        return Orchestrator(sessions, llm, settings, storage=get_storage(), graph_repo=graph_repository())

    return InvestigationRunner(sessions, settings, orchestrator)
