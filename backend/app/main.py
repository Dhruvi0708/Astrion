"""ASTRION API application factory."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.graph.client import get_graph_client

logger = logging.getLogger("astrion")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logger.info(
        "startup",
        extra={"environment": settings.environment, "version": __version__, "neo4j_configured": settings.neo4j_configured},
    )
    runner = app.state.investigation_runner
    try:
        runner.recover()  # runs left in flight by a previous process become resumable
    except Exception:  # database may be down at startup; health checks will report it
        logger.exception("could not recover stale investigations")
    yield
    runner.shutdown()
    get_graph_client().close()
    logger.info("shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        summary="ASTRION — The Living Intelligence Engine. Phase 1 foundation API.",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,  # the refresh cookie must reach /api/v1/auth
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID", "X-Astrion-Client"],
        expose_headers=["X-Request-ID"],
    )
    register_exception_handlers(app)
    app.include_router(api_router)
    from app.intelligence.wiring import build_runner

    app.state.investigation_runner = build_runner(settings)
    return app


app = create_app()
