"""Test fixtures.

By default tests run against an in-memory SQLite database built from model metadata.
Set ASTRION_TEST_DATABASE_URL (e.g. postgresql+psycopg://astrion@127.0.0.1:5432/astrion_test) to run
the same suite against PostgreSQL using the real Alembic migrations.
"""

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("ASTRION_ENVIRONMENT", "test")
os.environ.setdefault("ASTRION_LOG_JSON", "false")
os.environ.setdefault("ASTRION_NEO4J_URI", "")

from app.db.base import Base  # noqa: E402
from app.db.session import build_engine, get_db  # noqa: E402
from app.graph.client import GraphHealth, get_graph_client  # noqa: E402
from app.main import create_app  # noqa: E402
import app.models  # noqa: E402,F401

TEST_DB_URL = os.environ.get("ASTRION_TEST_DATABASE_URL")
IS_POSTGRES = bool(TEST_DB_URL and TEST_DB_URL.startswith("postgresql"))


def _migrate_postgres(url: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    cfg.cmd_opts = type("Opts", (), {"x": [f"url={url}"]})()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    if IS_POSTGRES:
        _migrate_postgres(TEST_DB_URL)  # type: ignore[arg-type]
        eng = build_engine(TEST_DB_URL)  # type: ignore[arg-type]
    else:
        from sqlalchemy import create_engine, event

        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        event.listen(eng, "connect", lambda c, _: c.execute("PRAGMA foreign_keys=ON"))
        Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def db_session(engine: Engine) -> Iterator[Session]:
    """Each test starts from empty tables."""
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()


class FakeGraph:
    def __init__(self, health: GraphHealth) -> None:
        self._health = health

    def health(self) -> GraphHealth:
        return self._health

    def close(self) -> None:
        return None


@pytest.fixture()
def app(db_session: Session):
    application = create_app()
    application.dependency_overrides[get_db] = lambda: db_session
    return application


@pytest.fixture()
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fake_graph():
    return FakeGraph


def pytest_report_header(config):  # noqa: ANN001
    return f"database: {'postgresql (alembic migrations)' if IS_POSTGRES else 'sqlite (metadata)'}"


__all__ = ["IS_POSTGRES", "FakeGraph", "text", "get_graph_client"]
