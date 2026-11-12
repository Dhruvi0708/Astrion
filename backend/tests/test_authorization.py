"""Cross-user authorization: one user can never see or modify another user's resources."""

import io

import pytest

from app.models import Workspace


@pytest.fixture()
def alice_data(auth_client):
    ws = auth_client.post("/api/v1/workspaces", json={"name": "Alice private"}).json()
    src = auth_client.post(f"/api/v1/workspaces/{ws['id']}/sources", json={"title": "Alice source", "source_type": "paper"}).json()
    doc = auth_client.post(f"/api/v1/sources/{src['id']}/documents", json={"title": "meta.pdf", "media_type": "application/pdf"}).json()
    up = auth_client.post(
        f"/api/v1/sources/{src['id']}/documents/upload",
        files={"file": ("notes.txt", io.BytesIO(b"alice secret notes"), "text/plain")},
    ).json()
    return {"ws": ws, "src": src, "doc": doc, "upload": up}


def test_lists_are_scoped_to_owner(auth_client, other_client, alice_data):
    assert other_client.get("/api/v1/workspaces").json()["total"] == 0
    assert auth_client.get("/api/v1/workspaces").json()["total"] == 1


def test_other_user_gets_404_everywhere(other_client, alice_data):
    ws, src, doc, up = alice_data["ws"]["id"], alice_data["src"]["id"], alice_data["doc"]["id"], alice_data["upload"]["id"]
    for path in [
        f"/api/v1/workspaces/{ws}",
        f"/api/v1/workspaces/{ws}/sources",
        f"/api/v1/sources/{src}",
        f"/api/v1/sources/{src}/documents",
        f"/api/v1/documents/{doc}",
        f"/api/v1/documents/{up}/content",
    ]:
        r = other_client.get(path)
        assert r.status_code == 404, path  # 404, not 403: existence is not disclosed
    assert other_client.post(f"/api/v1/workspaces/{ws}/sources", json={"title": "intrusion", "source_type": "paper"}).status_code == 404
    assert other_client.post(f"/api/v1/sources/{src}/documents", json={"title": "x", "media_type": "application/pdf"}).status_code == 404
    r = other_client.post(f"/api/v1/sources/{src}/documents/upload", files={"file": ("x.txt", io.BytesIO(b"x"), "text/plain")})
    assert r.status_code == 404


def test_client_supplied_owner_is_ignored(auth_client, other_client, db_session):
    """Mass-assignment attempt: extra owner fields in the body must not change ownership."""
    me = other_client.get("/api/v1/auth/me").json()
    ws = auth_client.post("/api/v1/workspaces", json={"name": "Mine", "owner_id": me["id"]}).json()
    assert db_session.get(Workspace, __import__("uuid").UUID(ws["id"])).owner_id != __import__("uuid").UUID(me["id"])
    assert other_client.get(f"/api/v1/workspaces/{ws['id']}").status_code == 404


def test_legacy_unowned_workspaces_are_inaccessible(auth_client, db_session):
    legacy = Workspace(name="Phase 1 data", slug="phase-1", settings={}, owner_id=None)
    db_session.add(legacy)
    db_session.commit()
    assert auth_client.get(f"/api/v1/workspaces/{legacy.id}").status_code == 404
    assert all(w["id"] != str(legacy.id) for w in auth_client.get("/api/v1/workspaces").json()["items"])


def test_same_slug_allowed_for_different_owners(auth_client, other_client):
    a = auth_client.post("/api/v1/workspaces", json={"name": "Shared Name"}).json()
    b = other_client.post("/api/v1/workspaces", json={"name": "Shared Name"}).json()
    assert a["slug"] == b["slug"] == "shared-name"  # slug suffixes no longer leak other users' names
