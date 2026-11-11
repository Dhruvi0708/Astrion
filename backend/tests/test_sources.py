import uuid

import pytest


@pytest.fixture()
def workspace(client):
    return client.post("/api/v1/workspaces", json={"name": "Sources WS"}).json()


def test_register_and_list_sources(client, workspace):
    payload = {
        "title": "Reef Monitoring Survey",
        "source_type": "report",
        "uri": "https://example.org/reef",
        "authors": [" A. Author ", "", "B. Author"],
        "published_on": "2024-05-01",
    }
    r = client.post(f"/api/v1/workspaces/{workspace['id']}/sources", json=payload)
    assert r.status_code == 201, r.text
    src = r.json()
    assert src["authors"] == ["A. Author", "B. Author"]
    assert src["status"] == "registered"
    assert src["uri"] == "https://example.org/reef"
    assert src["document_count"] == 0

    listed = client.get(f"/api/v1/workspaces/{workspace['id']}/sources").json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == src["id"]
    assert client.get(f"/api/v1/sources/{src['id']}").json()["title"] == "Reef Monitoring Survey"
    assert client.get(f"/api/v1/workspaces/{workspace['id']}").json()["source_count"] == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"title": "x", "source_type": "novel"},
        {"title": "", "source_type": "paper"},
        {"title": "x", "source_type": "paper", "uri": "not a url"},
        {"title": "x", "source_type": "paper", "published_on": "yesterday"},
    ],
)
def test_source_validation(client, workspace, bad):
    r = client.post(f"/api/v1/workspaces/{workspace['id']}/sources", json=bad)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


def test_source_requires_existing_workspace(client):
    r = client.post(f"/api/v1/workspaces/{uuid.uuid4()}/sources", json={"title": "x", "source_type": "paper"})
    assert r.status_code == 404
    assert client.get(f"/api/v1/workspaces/{uuid.uuid4()}/sources").status_code == 404
    assert client.get(f"/api/v1/sources/{uuid.uuid4()}").status_code == 404


def test_documents_lifecycle(client, workspace):
    src = client.post(f"/api/v1/workspaces/{workspace['id']}/sources", json={"title": "Dataset", "source_type": "dataset"}).json()
    digest = "A" * 64
    r = client.post(
        f"/api/v1/sources/{src['id']}/documents",
        json={"title": "landings.csv", "media_type": "text/csv", "byte_size": 2048, "content_hash": digest},
    )
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["processing_status"] == "registered"  # Phase 1 never pretends to process
    assert doc["content_hash"] == "a" * 64
    assert doc["workspace_id"] == workspace["id"]

    assert client.get(f"/api/v1/documents/{doc['id']}").json()["title"] == "landings.csv"
    docs = client.get(f"/api/v1/sources/{src['id']}/documents").json()
    assert docs["total"] == 1
    assert client.get(f"/api/v1/sources/{src['id']}").json()["document_count"] == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"title": "f", "media_type": "pdf"},
        {"title": "f", "media_type": "application/pdf", "byte_size": -1},
        {"title": "f", "media_type": "application/pdf", "content_hash": "abc"},
    ],
)
def test_document_validation(client, workspace, bad):
    src = client.post(f"/api/v1/workspaces/{workspace['id']}/sources", json={"title": "S", "source_type": "paper"}).json()
    assert client.post(f"/api/v1/sources/{src['id']}/documents", json=bad).status_code == 422


def test_document_for_missing_source(client):
    r = client.post(f"/api/v1/sources/{uuid.uuid4()}/documents", json={"title": "f", "media_type": "application/pdf"})
    assert r.status_code == 404
    assert client.get(f"/api/v1/documents/{uuid.uuid4()}").status_code == 404
