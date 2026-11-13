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
