"""End-to-end investigation pipeline through the API, using the deterministic fixture provider.

The fixture is rule-based (not AI); these tests check orchestration, persistence and provenance, not
reasoning quality. Faults are injected with ``ScriptedLLM``.
"""

import threading

import pytest

from app.models import AgentExecution, Investigation
from app.models.enums import InvestigationStatus
from tests.intelligence_helpers import QUESTION, REEF_REPORT, REEF_REVIEW, ScriptedLLM, bad_request, create_investigation, seed_workspace, unavailable

STAGE_ORDER = ["ingest", "orchestrator", "research", "knowledge", "graph_sync", "hypothesis", "contradiction", "verification", "synthesis"]


@pytest.fixture()
def llm(harness) -> ScriptedLLM:
    harness.llm = ScriptedLLM()
    return harness.llm


@pytest.fixture()
def seeded(auth_client):
    return seed_workspace(auth_client)


def start(client, inv_id: str):
    return client.post(f"/api/v1/investigations/{inv_id}/start")


def get(client, inv_id: str, part: str = ""):
    r = client.get(f"/api/v1/investigations/{inv_id}{'/' + part if part else ''}")
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- happy path


def test_full_pipeline_completes_with_traceable_steps(auth_client, llm, seeded):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    assert inv["status"] == "draft"
    r = start(auth_client, inv["id"])
    assert r.status_code == 202, r.text
    detail = r.json()
    assert detail["status"] == "completed"
    assert detail["llm_provider"] == "fixture" and detail["llm_model"] == "astrion-fixture-v1"
    assert detail["run_count"] == 1 and detail["error"] is None
    assert not detail["can_cancel"] and detail["can_start"] and not detail["can_resume"]

    stages = {p["stage"]: p for p in detail["progress"]}
    assert stages["graph_sync:knowledge"]["status"] == "skipped"  # Neo4j not configured in this test
    assert stages["graph_sync:knowledge"]["succeeded"] == 0  # a skipped step is never counted as a success
    for name in ("ingest", "orchestrator", "research", "knowledge", "hypothesis", "contradiction", "verification", "synthesis"):
        assert stages[name]["status"] == "succeeded", (name, stages[name])
    assert stages["research"]["steps"] == 2  # one step per document, run in parallel

    execs = get(auth_client, inv["id"], "executions")
    keys = [e["step_key"] for e in execs]
    assert all(k.startswith("r1:") for k in keys)
    # Execution order follows the dependency graph and every step records what it depended on.
    first = {s: min(i for i, k in enumerate(keys) if k.split(":", 1)[1].startswith(s)) for s in STAGE_ORDER}
    assert [s for s, _ in sorted(first.items(), key=lambda kv: kv[1])] == STAGE_ORDER
    by_key = {e["step_key"]: e for e in execs}
    assert by_key["r1:orchestrator"]["depends_on"] == ["r1:ingest"]
    assert by_key["r1:orchestrator"]["parent_execution_id"] == by_key["r1:ingest"]["id"]
    assert all(e["status"] in ("succeeded", "skipped") for e in execs)
    # r1:knowledge is the deterministic merge into the registry: no model call, so no provider is recorded.
    agent_rows = [e for e in execs if e["agent_role"] != "system" and e["status"] == "succeeded" and e["step_key"] != "r1:knowledge"]
    assert by_key["r1:knowledge"]["provider"] is None
    bad = [
        (e["step_key"], e["provider"], list((e["output"] or {}).keys()))
        for e in agent_rows
        if not (e["provider"] == "fixture" and (e["output"] or {}).get("result"))
    ]
    assert agent_rows and not bad, bad


def test_claims_have_verbatim_evidence_and_full_provenance(auth_client, llm, seeded):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    start(auth_client, inv["id"])
    claims = get(auth_client, inv["id"], "claims")
    assert claims
    texts = {d["title"]: body for d, body in zip(seeded["docs"], (REEF_REPORT, REEF_REVIEW), strict=True)}
    for cl in claims:
        assert cl["evidence"], cl
        assert cl["source"]["id"] == seeded["src"]["id"]
        normalised = " ".join(texts[cl["document"]["title"]].split())
        for ev in cl["evidence"]:
            assert ev["quote"] in normalised  # evidence is a real substring of the uploaded document
            assert ev["locator"]["chunk_id"]

    report = get(auth_client, inv["id"], "reports")[0]
    assert report["run_number"] == 1 and report["provider"] == "fixture"
    content = report["content"]
    assert content["generated_by"]["is_fixture"] is True
    assert content["key_findings"]
    claim_ids = {c["id"] for c in claims}
    for finding in content["key_findings"]:
        assert finding["claim_refs"], finding
        for ref in finding["claim_refs"]:
            cit = content["citations"][ref]  # every cited ref resolves to a claim → evidence → document → source chain
            assert cit["claim_id"] in claim_ids
            assert cit["document"]["id"] in {d["id"] for d in seeded["docs"]}
            assert cit["source"]["id"] == seeded["src"]["id"]
            assert cit["evidence"]


def test_hypotheses_contradictions_and_verification_are_persisted(auth_client, llm, seeded):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    start(auth_client, inv["id"])
    hyps = get(auth_client, inv["id"], "hypotheses")
    cons = get(auth_client, inv["id"], "contradictions")
    vers = get(auth_client, inv["id"], "verifications")
    assert hyps and cons
    claim_ids = {c["id"] for c in get(auth_client, inv["id"], "claims")}
    for h in hyps:
        assert h["status"] != "verified"  # an agent verdict never marks a hypothesis verified
        assert h["confidence_method"]["method"] == "astrion-evidence-v1"
        assert 0 <= h["confidence"] <= 1
        assert set(h["supporting_claim_ids"]) <= claim_ids
        assert h["verification"]["verdict"]
    for x in cons:
        assert x["claim_a"]["id"] in claim_ids and x["claim_b"]["id"] in claim_ids
    targets = {(v["target_type"], v["target_id"]) for v in vers}
    assert {("hypothesis", h["id"]) for h in hyps} <= targets
    assert {("contradiction", x["id"]) for x in cons} <= targets
    changes = get(auth_client, inv["id"], "graph-changes")
    kinds = {c["change_type"] for c in changes}
    assert {"entity_created", "claim_added", "hypothesis_added", "contradiction_linked"} <= kinds


def test_workspace_graph_falls_back_to_postgres_and_is_scoped(auth_client, llm, seeded):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    start(auth_client, inv["id"])
    g = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/graph", params={"include_claims": True, "investigation_id": inv["id"]}).json()
    assert g["source"] == "postgres" and g["fallback_reason"] == "Neo4j is not configured."
    keys = {n["key"] for n in g["nodes"]}
    assert any(n["kind"] == "entity" for n in g["nodes"]) and any(n["kind"] == "claim" for n in g["nodes"])
    assert all(e["source"] in keys and e["target"] in keys for e in g["edges"])  # no dangling edges
    ent = next(n for n in g["nodes"] if n["kind"] == "entity")
    d = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/graph/entities/{ent['entity_id']}").json()
    assert d["claims"] and all(c["evidence"] and c["source"] for c in d["claims"])
    assert auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/graph/consistency").json()["status"] == "not_configured"


def test_rerun_reuses_knowledge_instead_of_duplicating(auth_client, llm, seeded):
    first = create_investigation(auth_client, seeded["ws"]["id"])
    start(auth_client, first["id"])
    n_claims = len(get(auth_client, first["id"], "claims"))
    second = create_investigation(auth_client, seeded["ws"]["id"])
    detail = start(auth_client, second["id"]).json()
    assert detail["status"] == "completed"
    knowledge = next(p for p in detail["progress"] if p["stage"] == "knowledge")
    assert "0 new claims" in knowledge["summary"] and "0 new entities" in knowledge["summary"]
    # The second investigation still sees (and reasons over) the claims it found again.
    assert len(get(auth_client, second["id"], "claims")) == n_claims
    assert get(auth_client, second["id"], "hypotheses")
    cmp = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/investigations/compare", params={"ids": f"{first['id']},{second['id']}"}).json()
    assert len(cmp["investigations"]) == 2 and cmp["shared_entities"]
    ents = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/graph").json()["nodes"]
    assert len({(n["label"].lower(), n["entity_type"]) for n in ents}) == len(ents)  # no duplicate entities
    assert max(n["mention_count"] for n in ents) >= 2


def test_restart_creates_new_run_and_report(auth_client, llm, seeded):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    start(auth_client, inv["id"])
    detail = start(auth_client, inv["id"]).json()
    assert detail["run_count"] == 2 and detail["status"] == "completed"
    assert [r["run_number"] for r in get(auth_client, inv["id"], "reports")] == [2, 1]
    assert any(e["step_key"].startswith("r2:") for e in get(auth_client, inv["id"], "executions"))


def test_document_without_text_yields_honest_insufficient_evidence(auth_client, llm):
    ws = auth_client.post("/api/v1/workspaces", json={"name": "Empty"}).json()
    src = auth_client.post(f"/api/v1/workspaces/{ws['id']}/sources", json={"title": "Meta", "source_type": "paper"}).json()
    auth_client.post(f"/api/v1/sources/{src['id']}/documents", json={"title": "meta.pdf", "media_type": "application/pdf"})
    inv = create_investigation(auth_client, ws["id"])
    detail = start(auth_client, inv["id"]).json()
    assert detail["status"] == "completed"
    stages = {p["stage"]: p["status"] for p in detail["progress"]}
    assert stages["hypothesis"] == "skipped" and stages["contradiction"] == "skipped"
    report = get(auth_client, inv["id"], "reports")[0]["content"]
    assert report["answer_status"] == "insufficient_evidence" and report["key_findings"] == []


# --------------------------------------------------------------------------- failure, retry, resume, cancel


def test_retryable_error_is_retried_and_recorded(auth_client, llm, seeded, harness):
    llm.faults["orchestrator"] = [unavailable, unavailable]
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    detail = start(auth_client, inv["id"]).json()
    assert detail["status"] == "completed"
    attempts = [e for e in get(auth_client, inv["id"], "executions") if e["step_key"] == "r1:orchestrator"]
    assert [(e["attempt"], e["status"]) for e in attempts] == [(1, "failed"), (2, "failed"), (3, "succeeded")]
    assert "ProviderUnavailableError" in attempts[0]["error"]
    assert len(harness.sleeps) == 2  # backoff between attempts


def test_exhausted_retries_fail_the_investigation(auth_client, llm, seeded):
    llm.faults["orchestrator"] = [unavailable] * 3
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    detail = start(auth_client, inv["id"]).json()
    assert detail["status"] == "failed" and "r1:orchestrator" in detail["error"]
    assert detail["can_resume"]
    assert not get(auth_client, inv["id"], "reports")  # never a report for a failed run


def test_non_retryable_error_fails_without_retry_then_resume_reuses_succeeded_steps(auth_client, llm, seeded):
    llm.faults["hypothesis"] = [bad_request]
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    detail = start(auth_client, inv["id"]).json()
    assert detail["status"] == "failed"
    stages = {p["stage"]: p["status"] for p in detail["progress"]}
    assert stages["hypothesis"] == "failed" and stages["synthesis"] == "pending"
    research_calls = llm.calls.count("research")
    hyp_attempts = [e for e in get(auth_client, inv["id"], "executions") if e["step_key"] == "r1:hypothesis"]
    assert len(hyp_attempts) == 1

    r = auth_client.post(f"/api/v1/investigations/{inv['id']}/resume")
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "completed" and r.json()["run_count"] == 1
    assert llm.calls.count("research") == research_calls  # research was not re-run
    hyp = [e for e in get(auth_client, inv["id"], "executions") if e["step_key"] == "r1:hypothesis"]
    assert [(e["attempt"], e["status"]) for e in hyp] == [(1, "failed"), (2, "succeeded")]


def test_agent_timeout_fails_the_step(auth_client, llm, seeded, harness):
    harness.settings_overrides["agent_timeout_seconds"] = 0.3
    release = threading.Event()
    llm.faults["orchestrator"] = [lambda: release.wait(5)]
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    try:
        detail = start(auth_client, inv["id"]).json()
    finally:
        release.set()
    assert detail["status"] == "failed"
    row = next(e for e in get(auth_client, inv["id"], "executions") if e["step_key"] == "r1:orchestrator")
    assert row["status"] == "failed" and "Timed out" in row["error"]


def test_research_steps_run_in_parallel(auth_client, llm, seeded):
    barrier = threading.Barrier(2, timeout=5)
    llm.faults["research"] = [barrier.wait, barrier.wait]  # deadlocks (BrokenBarrierError) unless both run at once
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    assert start(auth_client, inv["id"]).json()["status"] == "completed"
    assert llm.max_concurrent >= 2


def test_cancel_during_run_stops_before_next_step(auth_client, llm, seeded, db_session):
    def request_cancel(agent: str) -> None:
        if agent == "orchestrator":
            db_session.query(Investigation).update({Investigation.cancel_requested: True, Investigation.status: InvestigationStatus.cancelling})
            db_session.commit()

    llm.on_call = request_cancel
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    detail = start(auth_client, inv["id"]).json()
    assert detail["status"] == "cancelled"
    assert "research" not in llm.calls
    assert not get(auth_client, inv["id"], "reports")
    assert detail["can_start"] and not detail["can_resume"]


def test_lifecycle_conflicts(auth_client, llm, seeded):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    assert auth_client.post(f"/api/v1/investigations/{inv['id']}/cancel").status_code == 409  # nothing running
    assert auth_client.post(f"/api/v1/investigations/{inv['id']}/resume").status_code == 409  # never ran
    start(auth_client, inv["id"])
    assert auth_client.post(f"/api/v1/investigations/{inv['id']}/resume").status_code == 409  # completed runs aren't resumable


def test_start_without_llm_is_503_and_nothing_runs(auth_client, harness, seeded):
    harness.llm = None
    status = auth_client.get("/api/v1/intelligence/status").json()
    assert status["configured"] is False and status["is_fixture"] is False
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    r = start(auth_client, inv["id"])
    assert r.status_code == 503 and r.json()["error"]["code"] == "llm_unavailable"
    assert get(auth_client, inv["id"])["status"] == "draft"
    assert get(auth_client, inv["id"], "executions") == []


def test_intelligence_status_labels_fixture(auth_client, llm):
    s = auth_client.get("/api/v1/intelligence/status").json()
    assert s["configured"] and s["is_fixture"] and s["provider"] == "fixture"
    assert "not AI" in s["detail"]


def test_recover_marks_in_flight_runs_interrupted(auth_client, llm, seeded, app, db_session):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    start(auth_client, inv["id"])
    db_session.query(Investigation).update({Investigation.status: InvestigationStatus.running})
    db_session.commit()
    assert app.state.investigation_runner.recover() == 1
    db_session.expire_all()
    assert get(auth_client, inv["id"])["status"] == "interrupted"
    assert auth_client.post(f"/api/v1/investigations/{inv['id']}/resume").json()["status"] == "completed"
    # Resume after a completed pipeline re-uses every step: no duplicate agent executions.
    assert db_session.query(AgentExecution).filter(AgentExecution.step_key == "r1:synthesis").count() == 1


# --------------------------------------------------------------------------- validation and authorization


def test_create_validation(auth_client, seeded):
    ws = seeded["ws"]["id"]
    assert auth_client.post(f"/api/v1/workspaces/{ws}/investigations", json={"title": "x", "question": "short"}).status_code == 422
    assert auth_client.post(f"/api/v1/workspaces/{ws}/investigations", json={"title": " ", "question": QUESTION}).status_code == 422
    other_ws = auth_client.post("/api/v1/workspaces", json={"name": "Other"}).json()
    r = auth_client.post(
        f"/api/v1/workspaces/{other_ws['id']}/investigations", json={"title": "t", "question": QUESTION, "document_ids": [seeded["docs"][0]["id"]]}
    )
    assert r.status_code in (404, 422)  # documents must belong to the investigation's workspace


def test_other_users_cannot_see_or_drive_investigations(auth_client, other_client, llm, seeded):
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    start(auth_client, inv["id"])
    ws = seeded["ws"]["id"]
    for path in ["", "/status", "/executions", "/claims", "/hypotheses", "/contradictions", "/verifications", "/reports", "/graph-changes"]:
        assert other_client.get(f"/api/v1/investigations/{inv['id']}{path}").status_code == 404, path
    for action in ("start", "resume", "cancel"):
        assert other_client.post(f"/api/v1/investigations/{inv['id']}/{action}").status_code == 404, action
    assert other_client.get(f"/api/v1/workspaces/{ws}/investigations").status_code == 404
    assert other_client.post(f"/api/v1/workspaces/{ws}/investigations", json={"title": "t", "question": QUESTION}).status_code == 404
    assert other_client.get(f"/api/v1/workspaces/{ws}/graph").status_code == 404
    assert other_client.get(f"/api/v1/workspaces/{ws}/graph/consistency").status_code == 404
    assert other_client.get(f"/api/v1/workspaces/{ws}/investigations/compare", params={"ids": inv["id"]}).status_code == 404
    # Bob's own workspace can't be used to reach Alice's investigation or entities either.
    bob_ws = other_client.post("/api/v1/workspaces", json={"name": "Bob"}).json()["id"]
    assert other_client.get(f"/api/v1/workspaces/{bob_ws}/graph", params={"investigation_id": inv["id"]}).status_code == 404
    assert other_client.get(f"/api/v1/workspaces/{bob_ws}/investigations/compare", params={"ids": inv["id"]}).status_code == 404
    ent = auth_client.get(f"/api/v1/workspaces/{ws}/graph").json()["nodes"][0]
    assert other_client.get(f"/api/v1/workspaces/{bob_ws}/graph/entities/{ent['entity_id']}").status_code == 404


def test_workspace_documents_listing_is_owner_scoped(auth_client, other_client, seeded):
    ws = seeded["ws"]["id"]
    body = auth_client.get(f"/api/v1/workspaces/{ws}/documents").json()
    assert body["total"] == 2 and {d["id"] for d in body["items"]} == {d["id"] for d in seeded["docs"]}
    assert other_client.get(f"/api/v1/workspaces/{ws}/documents").status_code == 404


def test_requires_authentication(client):
    assert client.get("/api/v1/intelligence/status").status_code == 401
    assert client.get("/api/v1/investigations/00000000-0000-0000-0000-000000000000").status_code == 401


class BrokenGraph:
    """A configured graph whose every call fails, as when Neo4j goes down mid-run."""

    def __getattr__(self, name):
        from app.graph.repository import GraphUnavailableError

        def fail(*a, **kw):
            raise GraphUnavailableError("connection refused")

        return fail


def test_graph_sync_failure_fails_the_run_and_keeps_postgres_knowledge(auth_client, llm, seeded, harness):
    harness.graph_repo = BrokenGraph()
    inv = create_investigation(auth_client, seeded["ws"]["id"])
    detail = start(auth_client, inv["id"]).json()
    assert detail["status"] == "failed" and "Neo4j sync failed" in detail["error"]
    stages = {p["stage"]: p["status"] for p in detail["progress"]}
    assert stages["knowledge"] == "succeeded" and stages["graph_sync:knowledge"] == "failed" and stages["hypothesis"] == "pending"
    assert get(auth_client, inv["id"], "claims")  # PostgreSQL remains the record
    harness.graph_repo = None  # Neo4j "removed": resume skips the sync honestly and finishes
    assert auth_client.post(f"/api/v1/investigations/{inv['id']}/resume").json()["status"] == "completed"
