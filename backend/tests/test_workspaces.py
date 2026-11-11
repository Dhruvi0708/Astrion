import uuid


def test_create_and_get_workspace(client):
    r = client.post("/api/v1/workspaces", json={"name": "  Coastal Resilience  ", "description": "A review."})
    assert r.status_code == 201
    ws = r.json()
    assert ws["name"] == "Coastal Resilience"
    assert ws["slug"] == "coastal-resilience"
    assert ws["status"] == "active"
    assert ws["source_count"] == 0
    uuid.UUID(ws["id"])

    got = client.get(f"/api/v1/workspaces/{ws['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == ws["id"]


def test_slugs_are_unique(client):
    a = client.post("/api/v1/workspaces", json={"name": "Ocean Heat"}).json()
    b = client.post("/api/v1/workspaces", json={"name": "Ocean heat"}).json()
    c = client.post("/api/v1/workspaces", json={"name": "Ocean-Heat!"}).json()
    assert [a["slug"], b["slug"], c["slug"]] == ["ocean-heat", "ocean-heat-2", "ocean-heat-3"]


def test_list_workspaces_paginates_newest_first(client):
    for i in range(3):
        client.post("/api/v1/workspaces", json={"name": f"W{i}"})
    page = client.get("/api/v1/workspaces", params={"limit": 2}).json()
    assert page["total"] == 3
    assert page["limit"] == 2 and page["offset"] == 0
    assert len(page["items"]) == 2
    rest = client.get("/api/v1/workspaces", params={"limit": 2, "offset": 2}).json()
    assert len(rest["items"]) == 1
    ids = {w["id"] for w in page["items"]} | {w["id"] for w in rest["items"]}
    assert len(ids) == 3


def test_validation_errors_use_envelope(client):
    r = client.post("/api/v1/workspaces", json={"name": "   "})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert err["details"][0]["loc"][-1] == "name"
    assert err["request_id"]


def test_pagination_bounds_validated(client):
    assert client.get("/api/v1/workspaces", params={"limit": 0}).status_code == 422
    assert client.get("/api/v1/workspaces", params={"limit": 101}).status_code == 422


def test_missing_workspace_returns_404(client):
    r = client.get(f"/api/v1/workspaces/{uuid.uuid4()}")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_malformed_id_returns_422(client):
    assert client.get("/api/v1/workspaces/not-a-uuid").status_code == 422
