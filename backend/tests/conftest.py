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

import app.models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.db.session import build_engine, get_db  # noqa: E402
from app.graph.client import GraphHealth, get_graph_client  # noqa: E402
from app.main import create_app  # noqa: E402

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
def storage_root(tmp_path):
    return tmp_path / "storage"


class IntelligenceHarness:
    """What the test app uses to run investigations: the LLM (None = not configured), an optional
    graph repository, and settings overrides. Runs are executed inline, inside the request."""

    def __init__(self) -> None:
        self.llm = None
        self.graph_repo = None
        self.settings_overrides: dict = {}
        self.sleeps: list[float] = []


@pytest.fixture()
def harness() -> IntelligenceHarness:
    return IntelligenceHarness()


@pytest.fixture()
def app(db_session: Session, storage_root, harness: IntelligenceHarness):
    from app.core.config import get_settings
    from app.intelligence.orchestrator import Orchestrator
    from app.intelligence.runner import InvestigationRunner
    from app.intelligence.wiring import get_intelligence_llm
    from app.services.auth import login_limiter
    from app.storage import get_storage
    from app.storage.local import LocalStorage

    login_limiter._failures.clear()
    application = create_app()
    application.dependency_overrides[get_db] = lambda: db_session
    application.dependency_overrides[get_storage] = lambda: LocalStorage(storage_root)
    application.dependency_overrides[get_intelligence_llm] = lambda: harness.llm

    sessions = sessionmaker(bind=db_session.get_bind(), autoflush=False, expire_on_commit=False)

    def orchestrator() -> Orchestrator:
        settings = get_settings().model_copy(update={"agent_retry_backoff_seconds": 0.0, **harness.settings_overrides})
        return Orchestrator(sessions, harness.llm, settings, storage=LocalStorage(storage_root), graph_repo=harness.graph_repo, sleep=harness.sleeps.append)

    # Never let the test app's lifespan touch the configured (dev) database.
    application.state.investigation_runner = InvestigationRunner(sessions, get_settings(), orchestrator, inline=True)
    return application


CLIENT_HEADERS = {"X-Astrion-Client": "web"}
DEFAULT_PASSWORD = "correct horse battery staple 42"


@pytest.fixture()
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def register_user(client: TestClient, email: str, password: str = DEFAULT_PASSWORD, name: str = "Researcher") -> dict:
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password, "display_name": name}, headers=CLIENT_HEADERS)
    assert r.status_code == 201, r.text
    return r.json()


def bearer(token_body: dict) -> dict:
    return {"Authorization": f"Bearer {token_body['access_token']}"}


@pytest.fixture()
def auth_client(app) -> Iterator[TestClient]:
    """A client already signed in as alice@example.org (Authorization header pre-set)."""
    with TestClient(app) as c:
        body = register_user(c, "alice@example.org", name="Alice")
        c.headers.update(bearer(body))
        yield c


@pytest.fixture()
def other_client(app) -> Iterator[TestClient]:
    """A second, independent user (bob@example.org) for cross-user authorization tests."""
    with TestClient(app) as c:
        body = register_user(c, "bob@example.org", name="Bob")
        c.headers.update(bearer(body))
        yield c


@pytest.fixture()
def fake_graph():
    return FakeGraph


def pytest_report_header(config):  # noqa: ANN001
    return f"database: {'postgresql (alembic migrations)' if IS_POSTGRES else 'sqlite (metadata)'}"


__all__ = ["IS_POSTGRES", "FakeGraph", "IntelligenceHarness", "text", "get_graph_client"]
