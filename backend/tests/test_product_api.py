"""Product-level API: dashboard, intelligence explorer, graph exploration, document processing, report
export, live events, history filters and run limits.

MOCKED LLM: investigations here run with the deterministic fixture provider (rule-based, not AI).
"""

import io
import json
import threading
import time
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import update
from sqlalchemy.orm import sessionmaker

from app.models import Investigation
from app.models.enums import InvestigationStatus
from tests import phase3_data as d
from tests.intelligence_helpers import ScriptedLLM


@pytest.fixture()
def llm(harness) -> ScriptedLLM:
    harness.llm = ScriptedLLM()
    return harness.llm


@pytest.fixture()
def seeded(auth_client, llm):
    s = d.seed(auth_client)
    s["first"] = d.run(auth_client, s["ws"]["id"], d.QUESTION_1, "Warming and bleaching")
    return s


def test_dashboard_counts_match_stored_records(auth_client, seeded):
    ws = seeded["ws"]["id"]
    dash = auth_client.get(f"/api/v1/workspaces/{ws}/dashboard").json()
    inv = seeded["first"]["id"]
    assert dash["investigations"] == {"total": 1, "active": 0, "completed": 1, "failed": 0, "by_status": {"completed": 1}}
    graph = auth_client.get(f"/api/v1/workspaces/{ws}/graph").json()
    assert dash["knowledge"]["entities"] == len(graph["nodes"])
    assert dash["knowledge"]["relationships"] == len(graph["edges"])
    assert dash["knowledge"]["claims"] == len(auth_client.get(f"/api/v1/investigations/{inv}/claims").json())
    report = auth_client.get(f"/api/v1/investigations/{inv}/reports").json()[0]["content"]
    assert dash["findings"]["cited_findings"] == len([f for f in report["key_findings"] if f["claim_refs"]])
    assert dash["findings"]["human_verified_hypotheses"] == 0  # agents never verify; only a person can
    assert dash["recent_activity"] and all(a["investigation"]["id"] == inv for a in dash["recent_activity"])
    assert dash["documents"]["total"] == 4
    empty = auth_client.post("/api/v1/workspaces", json={"name": "Empty"}).json()
    blank = auth_client.get(f"/api/v1/workspaces/{empty['id']}/dashboard").json()
    assert blank["investigations"]["total"] == 0 and blank["knowledge"]["entities"] == 0 and blank["recent_activity"] == []


def test_explorer_lists_are_searchable_and_real(auth_client, seeded):
    ws = seeded["ws"]["id"]
    ents = auth_client.get(f"/api/v1/workspaces/{ws}/entities").json()
    assert ents["total"] == len(ents["items"]) > 0
    first = ents["items"][0]
    assert first["claims"] >= 1 and first["investigations"][0]["title"] == "Warming and bleaching"
    found = auth_client.get(f"/api/v1/workspaces/{ws}/entities", params={"q": first["name"][:4]}).json()
    assert any(e["id"] == first["id"] for e in found["items"])
    assert auth_client.get(f"/api/v1/workspaces/{ws}/entities", params={"q": "zzzz-nothing"}).json()["total"] == 0
    hyps = auth_client.get(f"/api/v1/workspaces/{ws}/hypotheses").json()
    assert hyps["total"] >= 1 and all(h["investigation"]["title"] for h in hyps["items"])
    contested = auth_client.get(f"/api/v1/workspaces/{ws}/hypotheses", params={"consensus": "contested"}).json()
    assert all(h["consensus"] == "contested" for h in contested["items"])
    cons = auth_client.get(f"/api/v1/workspaces/{ws}/contradictions").json()
    resolved = auth_client.get(f"/api/v1/workspaces/{ws}/contradictions", params={"resolved": True}).json()
    assert resolved["total"] <= cons["total"] and all(x["resolution_kind"] for x in resolved["items"])
    ev = auth_client.get(f"/api/v1/workspaces/{ws}/evidence", params={"q": "61 percent"}).json()
    assert ev["total"] >= 1
    item = ev["items"][0]
    assert "61 percent" in item["quote"] and item["source"]["title"] == "Northern Reef Monitoring 2023" and item["document"]["title"] == "survey-2023.txt"
    assert item["investigations"][0]["title"] == "Warming and bleaching" and item["claim"]["period"] == [2023, 2023]


def test_graph_search_neighbourhood_and_entity_context(auth_client, seeded):
    ws = seeded["ws"]["id"]
    hits = auth_client.get(f"/api/v1/workspaces/{ws}/graph/search", params={"q": "bleach"}).json()
    assert hits and hits[0]["name"].lower().startswith("bleach")
    ent = hits[0]
    hood = auth_client.get(f"/api/v1/workspaces/{ws}/graph/entities/{ent['id']}/neighbourhood", params={"depth": 2}).json()
    assert hood["source"] == "postgres" and hood["center"] == ent["key"]
    keys = {n["key"] for n in hood["nodes"]}
    assert ent["key"] in keys and all(e["source"] in keys and e["target"] in keys for e in hood["edges"])
    assert auth_client.get(f"/api/v1/workspaces/{ws}/graph/entities/{ent['id']}/neighbourhood", params={"depth": 9}).status_code == 422
    detail = auth_client.get(f"/api/v1/workspaces/{ws}/graph/entities/{ent['id']}").json()
    assert detail["investigations"][0]["title"] == "Warming and bleaching"
    assert isinstance(detail["hypotheses"], list)


def test_document_processing_reports_only_what_was_extracted(auth_client, llm):
    ws = auth_client.post("/api/v1/workspaces", json={"name": "Docs"}).json()
    src = auth_client.post(f"/api/v1/workspaces/{ws['id']}/sources", json={"title": "S", "source_type": "report"}).json()

    def upload(name: str, body: bytes, mime: str) -> dict:
        r = auth_client.post(f"/api/v1/sources/{src['id']}/documents/upload", files={"file": (name, io.BytesIO(body), mime)})
        assert r.status_code == 201, r.text
        return r.json()

    text = upload("notes.txt", b"Ocean warming increases coral bleaching across the northern reef in 2023.", "text/plain")
    assert text["processing_status"] == "registered"  # uploading is not extracting
    out = auth_client.post(f"/api/v1/documents/{text['id']}/process").json()
    assert out["processing_status"] == "processed" and out["passages"] == 1 and out["extracted_characters"] > 40
    assert auth_client.post(f"/api/v1/documents/{text['id']}/process").json()["passages"] == 1  # idempotent
    bad = upload("broken.pdf", b"%PDF-1.4\nnot really a pdf", "application/pdf")
    failed = auth_client.post(f"/api/v1/documents/{bad['id']}/process").json()
    assert failed["processing_status"] == "failed" and failed["processing_error"] and failed["passages"] == 0
    meta = auth_client.post(f"/api/v1/sources/{src['id']}/documents", json={"title": "meta.csv", "media_type": "text/csv"}).json()
    m = auth_client.post(f"/api/v1/documents/{meta['id']}/process").json()
    assert m["processing_status"] == "failed" and "No file is stored" in m["processing_error"]
    inv = d.run(auth_client, ws["id"], "Does ocean warming increase coral bleaching?")
    intel = auth_client.get(f"/api/v1/documents/{text['id']}/intelligence").json()
    assert intel["claim_count"] >= 1 and intel["entities"]
    assert {"id": inv["id"], "title": "Investigation", "relation": "found claims"} in intel["investigations"]


def test_markdown_report_has_every_section_and_labels(auth_client, seeded):
    inv = seeded["first"]["id"]
    r = auth_client.get(f"/api/v1/investigations/{inv}/report.md")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/markdown")
    assert r.headers["content-disposition"].startswith('attachment; filename="astrion-warming-and-bleaching-run1.md"')
    md = r.text
    for n, title in enumerate(
        [
            "Executive summary",
            "Research objective",
            "Methodology",
            "Key discoveries",
            "Important entities",
            "Discovered relationships",
            "Verified findings",
            "Generated hypotheses",
            "Contradictions",
            "Supporting and opposing evidence",
            "Confidence assessments",
            "Unresolved questions",
            "Limitations",
            "Conclusions",
        ],
        start=1,
    ):
        assert f"## {n}. {title}" in md
    assert "deterministic fixture rules, not AI" in md and "Reasoning type:" in md
    assert "none of them has been verified by a person" in md
    draft = auth_client.post(f"/api/v1/workspaces/{seeded['ws']['id']}/investigations", json={"title": "Draft", "question": d.QUESTION_2}).json()
    assert auth_client.get(f"/api/v1/investigations/{draft['id']}/report.md").status_code == 404


def test_event_stream_sends_recorded_state_and_ends(auth_client, seeded):
    inv = seeded["first"]["id"]
    with auth_client.stream("GET", f"/api/v1/investigations/{inv}/events") as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    events = [blk for blk in body.split("\n\n") if blk.strip()]
    assert events[0].startswith("event: snapshot") and events[-1].startswith("event: end")
    snap = json.loads(events[0].split("data: ", 1)[1])
    assert snap["detail"]["status"] == "completed" and snap["executions"]
    assert snap["executions"] == auth_client.get(f"/api/v1/investigations/{inv}/executions").json()


def _later(seconds: float, fn) -> threading.Timer:  # noqa: ANN001
    t = threading.Timer(seconds, fn)
    t.start()
    return t


def _write(db_session, stmt, check) -> None:  # noqa: ANN001
    """Commits from another thread and confirms it stuck. In-memory SQLite shares ONE connection between threads, so
    a reader closing its session can roll this write back; PostgreSQL (separate connections) is not affected."""
    for _ in range(40):
        with sessionmaker(bind=db_session.get_bind())() as s:
            s.execute(stmt)
            s.commit()
        time.sleep(0.02)
        with sessionmaker(bind=db_session.get_bind())() as s:
            if check(s):
                return


def _set_status(db_session, inv_id: str, status: InvestigationStatus) -> None:  # noqa: ANN001
    key = uuid.UUID(inv_id)
    _write(db_session, update(Investigation).where(Investigation.id == key).values(status=status), lambda s: s.get(Investigation, key).status == status)


def test_event_stream_reports_changes_while_a_run_is_active(auth_client, seeded, db_session, monkeypatch):
    from app.api.v1 import investigations as api

    monkeypatch.setattr(api, "EVENT_POLL_SECONDS", 0.05)
    inv = seeded["first"]["id"]
    _set_status(db_session, inv, InvestigationStatus.running)
    timer = _later(0.6, lambda: _set_status(db_session, inv, InvestigationStatus.completed))
    with auth_client.stream("GET", f"/api/v1/investigations/{inv}/events") as r:
        body = "".join(r.iter_text())
    timer.join()
    snapshots = [json.loads(b.split("data: ", 1)[1]) for b in body.split("\n\n") if b.startswith("event: snapshot")]
    assert [s["detail"]["status"] for s in snapshots] == ["running", "completed"]  # one event per change, none invented
    assert body.rstrip().endswith("event: end\ndata: {}")


def test_event_stream_closes_when_the_user_signs_out(auth_client, seeded, db_session, monkeypatch):
    from app.api.v1 import investigations as api
    from app.models import AuthSession

    monkeypatch.setattr(api, "EVENT_POLL_SECONDS", 0.05)
    monkeypatch.setattr(api, "EVENT_STREAM_SECONDS", 10.0)
    inv = seeded["first"]["id"]
    _set_status(db_session, inv, InvestigationStatus.running)

    def sign_out() -> None:
        _write(
            db_session,
            update(AuthSession).values(revoked_at=datetime.now(UTC), revoked_reason="logout"),
            lambda s: s.query(AuthSession).filter(AuthSession.revoked_at.is_(None)).count() == 0,
        )

    timer, started = _later(0.6, sign_out), time.monotonic()
    with auth_client.stream("GET", f"/api/v1/investigations/{inv}/events") as r:
        body = "".join(r.iter_text())
    timer.join()
    assert time.monotonic() - started < 5  # closed by the sign-out, not by the time limit
    assert "event: end" not in body  # the run did not end; the client lost its authorisation


def test_history_filters(auth_client, seeded):
    ws = seeded["ws"]["id"]
    auth_client.post(f"/api/v1/workspaces/{ws}/investigations", json={"title": "Fish draft", "question": d.QUESTION_2})
    url = f"/api/v1/workspaces/{ws}/investigations"
    assert [i["title"] for i in auth_client.get(url, params={"status": "completed"}).json()["items"]] == ["Warming and bleaching"]
    assert [i["title"] for i in auth_client.get(url, params={"status": "draft"}).json()["items"]] == ["Fish draft"]
    assert [i["title"] for i in auth_client.get(url, params={"q": "herbivorous"}).json()["items"]] == ["Fish draft"]  # matches the question
    assert auth_client.get(url, params={"status": "active"}).json()["total"] == 0


def test_per_user_active_run_limit(auth_client, seeded, db_session, harness):
    ws = seeded["ws"]["id"]
    harness.settings_overrides = {}
    from app.core.config import get_settings

    limit = get_settings().max_active_investigations_per_user
    for i in range(limit):
        inv = auth_client.post(f"/api/v1/workspaces/{ws}/investigations", json={"title": f"Busy {i}", "question": d.QUESTION_2}).json()
        db_session.query(Investigation).filter(Investigation.id == uuid.UUID(inv["id"])).update(
            {Investigation.status: InvestigationStatus.running, Investigation.run_count: 1}
        )
    db_session.commit()
    extra = auth_client.post(f"/api/v1/workspaces/{ws}/investigations", json={"title": "One too many", "question": d.QUESTION_2}).json()
    r = auth_client.post(f"/api/v1/investigations/{extra['id']}/start")
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_active_investigations"


def test_product_routes_are_owner_scoped(auth_client, other_client, seeded):
    ws = seeded["ws"]["id"]
    inv = seeded["first"]["id"]
    ent = auth_client.get(f"/api/v1/workspaces/{ws}/entities").json()["items"][0]["id"]
    doc = seeded["docs"]["survey-2023.txt"]["id"]
    for path in (
        f"/api/v1/workspaces/{ws}/dashboard",
        f"/api/v1/workspaces/{ws}/entities",
        f"/api/v1/workspaces/{ws}/hypotheses",
        f"/api/v1/workspaces/{ws}/contradictions",
        f"/api/v1/workspaces/{ws}/evidence",
        f"/api/v1/workspaces/{ws}/graph/search?q=bleach",
        f"/api/v1/workspaces/{ws}/graph/entities/{ent}/neighbourhood",
        f"/api/v1/documents/{doc}/intelligence",
        f"/api/v1/investigations/{inv}/report.md",
        f"/api/v1/investigations/{inv}/events",
    ):
        assert other_client.get(path).status_code == 404, path
    assert other_client.post(f"/api/v1/documents/{doc}/process").status_code == 404
    bob_ws = other_client.post("/api/v1/workspaces", json={"name": "Bob"}).json()["id"]
    assert other_client.get(f"/api/v1/workspaces/{bob_ws}/graph/entities/{ent}/neighbourhood").status_code == 404
