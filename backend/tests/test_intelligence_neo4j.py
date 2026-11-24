"""Investigation graph sync against a REAL Neo4j server (skipped unless ASTRION_TEST_NEO4J_URI is set)."""

import os

import pytest

from app.core.config import Settings
from app.graph.client import Neo4jGraphClient, get_graph_client
from tests.intelligence_helpers import ScriptedLLM, create_investigation, seed_workspace

URI = os.environ.get("ASTRION_TEST_NEO4J_URI")
pytestmark = pytest.mark.skipif(not URI, reason="ASTRION_TEST_NEO4J_URI not set — no real Neo4j server available")


@pytest.fixture(scope="module")
def neo4j_client():
    c = Neo4jGraphClient(
        Settings(
            ASTRION_NEO4J_URI=URI,
            ASTRION_NEO4J_USER=os.environ.get("ASTRION_TEST_NEO4J_USER", "neo4j"),
            ASTRION_NEO4J_PASSWORD=os.environ.get("ASTRION_TEST_NEO4J_PASSWORD", ""),
        )
    )
    c.repository().ensure_schema()
    yield c
    c.close()


@pytest.fixture()
def graph_app(app, harness, neo4j_client):
    harness.llm = ScriptedLLM()
    harness.graph_repo = neo4j_client.repository()
    app.dependency_overrides[get_graph_client] = lambda: neo4j_client
    return app


COUNT_KNOWLEDGE = (
    "MATCH (n {workspace_id: $ws}) WHERE n:Entity OR n:Claim OR n:Document OR n:Source "
    "RETURN sum(CASE WHEN n:Entity THEN 1 ELSE 0 END) AS entities, sum(CASE WHEN n:Claim THEN 1 ELSE 0 END) AS claims, count(n) AS total"
)


def _wipe(client, ws_id: str) -> None:
    with client._driver.session() as s:  # test cleanup only
        s.run("MATCH (n {workspace_id: $ws}) DETACH DELETE n", ws=ws_id).consume()


def test_investigation_syncs_consistent_graph_to_neo4j(graph_app, auth_client, other_client, neo4j_client):
    d = seed_workspace(auth_client)
    ws = d["ws"]["id"]
    try:
        inv = create_investigation(auth_client, ws)
        detail = auth_client.post(f"/api/v1/investigations/{inv['id']}/start").json()
        assert detail["status"] == "completed", detail["error"]
        stages = {p["stage"]: p for p in detail["progress"]}
        assert stages["graph_sync:knowledge"]["status"] == "succeeded"
        assert stages["graph_sync:final"]["status"] == "succeeded"

        report = auth_client.get(f"/api/v1/workspaces/{ws}/graph/consistency").json()
        assert report["status"] == "checked" and report["consistent"], report
        assert report["entities"]["neo4j"] == report["entities"]["postgres"] > 0

        g = auth_client.get(f"/api/v1/workspaces/{ws}/graph", params={"include_claims": True}).json()
        assert g["source"] == "neo4j" and g["fallback_reason"] is None
        assert any(n["kind"] == "claim" for n in g["nodes"]) and any(n["kind"] == "entity" for n in g["nodes"])

        # Provenance in the graph: every claim node is about an entity and evidenced by a document.
        with neo4j_client._driver.session() as s:
            row = s.run(
                "MATCH (c:Claim {workspace_id: $ws}) "
                "OPTIONAL MATCH (c)-[:ABOUT]->(e:Entity) OPTIONAL MATCH (c)-[ev:EVIDENCED_BY]->(d:Document)-[:FROM_SOURCE]->(src:Source) "
                "RETURN count(DISTINCT c) AS claims, count(DISTINCT CASE WHEN d IS NULL THEN c END) AS unevidenced, "
                "count(DISTINCT src) AS sources, collect(DISTINCT ev.quote)[0] AS quote",
                ws=ws,
            ).single()
            assert row["claims"] > 0 and row["unevidenced"] == 0 and row["sources"] == 1 and row["quote"]
            found = s.run("MATCH (:Investigation {workspace_id: $ws})-[:FOUND]->(c:Claim) RETURN count(c) AS n", ws=ws).single()["n"]
            assert found == row["claims"]
            before = s.run(COUNT_KNOWLEDGE, ws=ws).single().data()

        # A second run over the same documents MERGEs on stable keys: knowledge nodes aren't duplicated
        # (the new run's hypotheses are new rows, so Hypothesis nodes may be added).
        assert auth_client.post(f"/api/v1/investigations/{inv['id']}/start").json()["status"] == "completed"
        with neo4j_client._driver.session() as s:
            after = s.run(COUNT_KNOWLEDGE, ws=ws).single().data()
        assert after == before
        assert auth_client.get(f"/api/v1/workspaces/{ws}/graph/consistency").json()["consistent"]

        # Workspace isolation: another user's workspace sees nothing of this graph.
        bob_ws = other_client.post("/api/v1/workspaces", json={"name": "Bob"}).json()["id"]
        bob = other_client.get(f"/api/v1/workspaces/{bob_ws}/graph").json()
        assert bob["source"] == "neo4j" and bob["nodes"] == [] and bob["edges"] == []
    finally:
        _wipe(neo4j_client, ws)


def test_adaptive_run_with_iterations_keeps_neo4j_consistent(graph_app, auth_client, harness, neo4j_client):
    """Phase 3: several research iterations, each synced, plus the final sync, against a real server."""
    from tests import phase3_data as d

    harness.settings_overrides.update({"research_initial_chars": 1500, "research_iteration_chars": 3000, "max_iterations": 3})
    s = d.seed(auth_client, "Neo4j adaptive")
    ws = s["ws"]["id"]
    try:
        first = d.run(auth_client, ws, d.QUESTION_1, "First")
        assert first["status"] == "completed", first["error"]
        keys = {e["step_key"]: e for e in auth_client.get(f"/api/v1/investigations/{first['id']}/executions").json()}
        assert keys["r1:graph_sync:knowledge"]["status"] == "succeeded"
        assert any(k.startswith("r1:graph_sync:knowledge:i") and e["status"] == "succeeded" for k, e in keys.items())
        second = d.run(auth_client, ws, d.QUESTION_2, "Second")
        assert second["status"] == "completed", second["error"]
        report = auth_client.get(f"/api/v1/workspaces/{ws}/graph/consistency").json()
        assert report["consistent"], report
        with neo4j_client._driver.session() as session:
            found = session.run("MATCH (i:Investigation {workspace_id: $ws})-[:FOUND]->(c:Claim) RETURN count(DISTINCT i) AS n", ws=ws).single()["n"]
        assert found == 2
    finally:
        _wipe(neo4j_client, ws)


def test_neighbourhood_comes_from_neo4j_and_matches_postgres(graph_app, app, auth_client, neo4j_client):
    from app.graph.client import get_graph_client
    from tests import phase3_data as d

    s = d.seed(auth_client, "Neo4j neighbourhood")
    ws = s["ws"]["id"]
    try:
        assert d.run(auth_client, ws, d.QUESTION_1)["status"] == "completed"
        ent = auth_client.get(f"/api/v1/workspaces/{ws}/entities").json()["items"][0]
        neo = auth_client.get(f"/api/v1/workspaces/{ws}/graph/entities/{ent['id']}/neighbourhood", params={"depth": 2}).json()
        assert neo["source"] == "neo4j" and neo["fallback_reason"] is None
        app.dependency_overrides.pop(get_graph_client)  # same request against the PostgreSQL registry
        app.dependency_overrides[get_graph_client] = lambda: type("NoGraph", (), {})()
        pg = auth_client.get(f"/api/v1/workspaces/{ws}/graph/entities/{ent['id']}/neighbourhood", params={"depth": 2}).json()
        assert pg["source"] == "postgres"
        assert {n["key"] for n in neo["nodes"]} == {n["key"] for n in pg["nodes"]}
        assert {e["key"] for e in neo["edges"]} == {e["key"] for e in pg["edges"]}
    finally:
        app.dependency_overrides[get_graph_client] = lambda: neo4j_client
        _wipe(neo4j_client, ws)


def test_graph_can_be_rebuilt_from_postgres_after_loss(graph_app, auth_client, neo4j_client, db_session, monkeypatch):
    """Disaster recovery: drop a workspace's graph in Neo4j, rebuild it from PostgreSQL, and it is consistent again."""
    from sqlalchemy.orm import sessionmaker

    from app.graph import resync
    from tests import phase3_data as d

    s = d.seed(auth_client, "Neo4j recovery")
    ws = s["ws"]["id"]
    try:
        assert d.run(auth_client, ws, d.QUESTION_1)["status"] == "completed"
        _wipe(neo4j_client, ws)
        assert auth_client.get(f"/api/v1/workspaces/{ws}/graph/consistency").json()["consistent"] is False
        monkeypatch.setattr(resync, "Neo4jGraphClient", lambda settings: neo4j_client)
        monkeypatch.setattr(resync, "get_sessionmaker", lambda: sessionmaker(bind=db_session.get_bind()))
        monkeypatch.setattr(neo4j_client, "close", lambda: None)
        settings = resync.get_settings().model_copy(update={"neo4j_uri": URI})
        monkeypatch.setattr(resync, "get_settings", lambda: settings)
        assert resync.main([ws]) == 0
        assert auth_client.get(f"/api/v1/workspaces/{ws}/graph/consistency").json()["consistent"] is True
    finally:
        _wipe(neo4j_client, ws)
