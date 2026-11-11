from sqlalchemy.exc import OperationalError

from app.db.session import get_db
from app.graph.client import GraphHealth, get_graph_client
from tests.conftest import FakeGraph


def test_service_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "astrion-api"
    assert body["environment"] == "test"
    assert r.headers["x-request-id"]


def test_request_id_is_propagated(client):
    r = client.get("/api/v1/health", headers={"X-Request-ID": "trace-123"})
    assert r.headers["x-request-id"] == "trace-123"


def test_postgres_health_ok(client):
    r = client.get("/api/v1/health/postgres")
    assert r.status_code == 200
    body = r.json()
    assert body == {"name": "postgres", "status": "ok", "latency_ms": body["latency_ms"], "detail": None}
    assert body["latency_ms"] >= 0


def test_postgres_health_reports_unavailable(app, client):
    class BrokenSession:
        def execute(self, *_a, **_k):
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    app.dependency_overrides[get_db] = lambda: BrokenSession()
    r = client.get("/api/v1/health/postgres")
    assert r.status_code == 200
    assert r.json()["status"] == "unavailable"
    assert "connection refused" not in r.json()["detail"]  # internals are not leaked


def test_neo4j_not_configured_by_default(client):
    r = client.get("/api/v1/health/neo4j")
    assert r.status_code == 200
    assert r.json()["status"] == "not_configured"


def test_neo4j_reports_fake_states(app, client):
    app.dependency_overrides[get_graph_client] = lambda: FakeGraph(GraphHealth(status="unavailable", detail="ServiceUnavailable: connection failed"))
    assert client.get("/api/v1/health/neo4j").json()["status"] == "unavailable"
    app.dependency_overrides[get_graph_client] = lambda: FakeGraph(GraphHealth(status="ok", latency_ms=1.5))
    assert client.get("/api/v1/health/neo4j").json() == {"name": "neo4j", "status": "ok", "latency_ms": 1.5, "detail": None}


def test_unknown_route_uses_error_envelope(client):
    r = client.get("/api/v1/does-not-exist")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_cors_preflight_allows_dev_origin(client):
    r = client.options(
        "/api/v1/workspaces",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
