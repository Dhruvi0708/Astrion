"""Integration tests against a REAL Neo4j server.

Skipped unless ASTRION_TEST_NEO4J_URI is set, e.g.:
    ASTRION_TEST_NEO4J_URI=bolt://localhost:7687 ASTRION_TEST_NEO4J_PASSWORD=... pytest tests/test_neo4j_integration.py
Nothing here is mocked; a skip means no server was available.
"""

import os
import time
import uuid

import pytest

from app.core.config import Settings
from app.graph.client import Neo4jGraphClient
from app.graph.model import NodeLabel, RelType, node_key, parse_key, relationship_key
from app.graph.repository import GraphNotFoundError, GraphUnavailableError, GraphValidationError

URI = os.environ.get("ASTRION_TEST_NEO4J_URI")
pytestmark = pytest.mark.skipif(not URI, reason="ASTRION_TEST_NEO4J_URI not set — no real Neo4j server available")


def _settings(**overrides) -> Settings:
    base = {
        "ASTRION_NEO4J_URI": URI,
        "ASTRION_NEO4J_USER": os.environ.get("ASTRION_TEST_NEO4J_USER", "neo4j"),
        "ASTRION_NEO4J_PASSWORD": os.environ.get("ASTRION_TEST_NEO4J_PASSWORD", ""),
        "ASTRION_NEO4J_TIMEOUT_SECONDS": 3,
        "ASTRION_NEO4J_QUERY_TIMEOUT_SECONDS": 5,
    }
    return Settings(**{**base, **overrides})


@pytest.fixture(scope="module")
def client():
    c = Neo4jGraphClient(_settings())
    yield c
    c.close()


@pytest.fixture(scope="module")
def repo(client):
    r = client.repository()
    r.ensure_schema()
    return r


@pytest.fixture()
def ws(repo):
    workspace_id = str(uuid.uuid4())
    yield workspace_id
    repo.clear_workspace(workspace_id)


def k(label: NodeLabel) -> str:
    return node_key(label, uuid.uuid4())


def test_health_ok(client):
    h = client.health()
    assert h.status == "ok" and h.latency_ms is not None


def test_wrong_password_reports_auth_failure():
    c = Neo4jGraphClient(_settings(ASTRION_NEO4J_PASSWORD="definitely-wrong-password"))
    try:
        h = c.health()
        assert h.status == "unavailable"
        assert "auth" in (h.detail or "").lower()
        with pytest.raises(GraphUnavailableError):
            c.repository().get_node(str(uuid.uuid4()), k(NodeLabel.ENTITY))
    finally:
        c.close()


def test_unreachable_server_times_out_quickly():
    c = Neo4jGraphClient(_settings(ASTRION_NEO4J_URI="bolt://127.0.0.1:1", ASTRION_NEO4J_TIMEOUT_SECONDS=1))
    try:
        start = time.perf_counter()
        assert c.health().status == "unavailable"
        assert time.perf_counter() - start < 10
    finally:
        c.close()


def test_schema_is_idempotent_and_constraints_exist(repo, client):
    repo.ensure_schema()  # second run must not fail
    records, _, _ = client._driver.execute_query("SHOW CONSTRAINTS YIELD name RETURN collect(name) AS names")
    names = set(records[0]["names"])
    for label in NodeLabel:
        assert f"{label.value.lower()}_workspace_key" in names


def test_node_crud(repo, ws):
    key = k(NodeLabel.ENTITY)
    created = repo.upsert_node(ws, NodeLabel.ENTITY, key, {"name": "Mangrove forests", "weight": 5})
    assert created.properties["name"] == "Mangrove forests"
    updated = repo.upsert_node(ws, NodeLabel.ENTITY, key, {"weight": 4, "aliases": ["mangroves"]})
    assert updated.properties["weight"] == 4 and updated.properties["name"] == "Mangrove forests"
    assert repo.get_node(ws, key).properties["aliases"] == ["mangroves"]
    assert repo.count(ws) == (1, 0)
    assert repo.delete_node(ws, key) is True
    assert repo.get_node(ws, key) is None
    assert repo.delete_node(ws, key) is False


def test_relationship_crud_and_neighbours(repo, ws):
    a, b, c = k(NodeLabel.ENTITY), k(NodeLabel.ENTITY), k(NodeLabel.CLAIM)
    for key, label in [(a, NodeLabel.ENTITY), (b, NodeLabel.ENTITY), (c, NodeLabel.CLAIM)]:
        repo.upsert_node(ws, label, key, {"name": key})
    r1 = relationship_key(uuid.uuid4())
    rel = repo.upsert_relationship(ws, RelType.INFLUENCES, r1, a, b, {"confidence": 0.7, "status": "extracted", "evidence_ids": ["e1"]})
    assert (rel.from_key, rel.to_key, rel.type) == (a, b, "INFLUENCES")
    repo.upsert_relationship(ws, RelType.SUPPORTS, relationship_key(uuid.uuid4()), c, a)
    got = repo.get_relationship(ws, r1)
    assert got.properties["confidence"] == 0.7 and got.properties["evidence_ids"] == ["e1"]
    assert len(repo.neighbours(ws, a)) == 2
    assert repo.count(ws) == (3, 2)
    assert repo.delete_relationship(ws, r1) is True
    assert repo.get_relationship(ws, r1) is None
    # Deleting a node detaches its remaining relationships.
    repo.delete_node(ws, a)
    assert repo.count(ws) == (2, 0)


def test_relationship_requires_endpoints_in_same_workspace(repo, ws):
    other_ws = str(uuid.uuid4())
    a, b = k(NodeLabel.ENTITY), k(NodeLabel.ENTITY)
    repo.upsert_node(ws, NodeLabel.ENTITY, a)
    repo.upsert_node(other_ws, NodeLabel.ENTITY, b)
    try:
        with pytest.raises(GraphNotFoundError):
            repo.upsert_relationship(ws, RelType.INFLUENCES, relationship_key(uuid.uuid4()), a, b)
        assert repo.get_node(ws, b) is None  # workspace isolation on reads
    finally:
        repo.clear_workspace(other_ws)


def test_unique_constraint_enforced(repo, client, ws):
    key = k(NodeLabel.SOURCE)
    repo.upsert_node(ws, NodeLabel.SOURCE, key)
    from neo4j.exceptions import ConstraintError

    with pytest.raises(ConstraintError):
        client._driver.execute_query("CREATE (:Source {workspace_id: $ws, key: $key})", ws=ws, key=key)


def test_explicit_transaction_rolls_back(repo, ws):
    a = k(NodeLabel.ENTITY)
    with pytest.raises(RuntimeError), repo.transaction() as tx:
        tx.upsert_node(ws, NodeLabel.ENTITY, a, {"name": "temp"})
        raise RuntimeError("abort")
    assert repo.get_node(ws, a) is None

    b, c = k(NodeLabel.ENTITY), k(NodeLabel.ENTITY)
    with repo.transaction() as tx:
        tx.upsert_node(ws, NodeLabel.ENTITY, b)
        tx.upsert_node(ws, NodeLabel.ENTITY, c)
        tx.upsert_relationship(ws, RelType.PART_OF, relationship_key(uuid.uuid4()), b, c)
    assert repo.count(ws) == (2, 1)


@pytest.mark.parametrize(
    "call",
    [
        lambda r, ws: r.upsert_node(ws, "Entity) DETACH DELETE n //", k(NodeLabel.ENTITY)),
        lambda r, ws: r.upsert_node(ws, NodeLabel.ENTITY, "ent:not-a-uuid"),
        lambda r, ws: r.upsert_node(ws, NodeLabel.ENTITY, k(NodeLabel.ENTITY), {"workspace_id": "hijack"}),
        lambda r, ws: r.upsert_node(ws, NodeLabel.ENTITY, k(NodeLabel.ENTITY), {"nested": {"a": 1}}),
        lambda r, ws: r.upsert_relationship(ws, "INFLUENCES]->() DELETE r //", relationship_key(uuid.uuid4()), k(NodeLabel.ENTITY), k(NodeLabel.ENTITY)),
    ],
)
def test_injection_and_invalid_input_rejected(repo, ws, call):
    with pytest.raises(GraphValidationError):
        call(repo, ws)


def test_key_mapping_roundtrip():
    pid = uuid.uuid4()
    assert parse_key(node_key(NodeLabel.CLAIM, pid)) == ("clm", pid)
    assert parse_key(relationship_key(pid)) == ("rel", pid)
    with pytest.raises(ValueError):
        parse_key("ent:../../x")
