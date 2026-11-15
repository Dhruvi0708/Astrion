"""Phase 3 behaviour through the API: adaptive planning, budgets, memory, debate, temporal and source
intelligence, active learning, comparison and isolation.

MOCKED LLM: every test here uses the deterministic fixture provider (rule-based, not AI). These tests
check that the engine's control flow, persistence and provenance are correct, not reasoning quality.
"""

import pytest

from tests import phase3_data as d
from tests.intelligence_helpers import ScriptedLLM

ADAPTIVE = {"research_initial_chars": 1500, "research_iteration_chars": 3000, "max_iterations": 3}


@pytest.fixture()
def llm(harness) -> ScriptedLLM:
    harness.llm = ScriptedLLM()
    return harness.llm


@pytest.fixture()
def seeded(auth_client):
    return d.seed(auth_client)


def get(client, inv_id: str, part: str):
    r = client.get(f"/api/v1/investigations/{inv_id}/{part}")
    assert r.status_code == 200, r.text
    return r.json()


def steps(client, inv_id: str) -> dict[str, dict]:
    return {e["step_key"]: e for e in get(client, inv_id, "executions")}


# --------------------------------------------------------------------------- adaptive planning


def test_adaptive_exploration_reads_more_evidence_with_explained_choices(auth_client, llm, seeded, harness):
    harness.settings_overrides.update(ADAPTIVE)
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    assert detail["status"] == "completed", detail["error"]
    ex = steps(auth_client, detail["id"])
    assessments = get(auth_client, detail["id"], "assessments")
    assert [a["iteration"] for a in assessments] == [1, 2, 3]
    assert all(a["coverage"] for a in assessments)
    for cand in assessments[0]["candidates"]:
        assert cand["explanation"] and cand["score"] >= 0.2 and set(cand["factors"]) >= {"uncertainty", "relevance", "information_gain"}
    assert "r1:planner:1" in ex and "r1:planner:2" in ex
    i2 = [e for k, e in ex.items() if k.startswith("r1:research:i2:")]
    assert i2, "the planner's choice must lead to a second research iteration"
    chosen = {cid for a in assessments[0]["candidates"] if a["id"] in ex["r1:planner:1"]["output"]["result"]["selected_action_ids"] for cid in a["chunk_ids"]}
    read_first = {cid for k, e in ex.items() if k.startswith("r1:research:") and not k.startswith("r1:research:i") for cid in e["input"]["chunk_ids"]}
    read_second = {cid for e in i2 for cid in e["input"]["chunk_ids"]}
    assert read_second <= chosen and not (read_second & read_first)  # reads exactly what was chosen, nothing twice
    run = get(auth_client, detail["id"], "runs")[0]
    assert run["iterations"] == 3 and "Iteration limit" in run["stop_reason"]
    assert [h["iteration"] for h in run["plan_history"]] == [1, 2]
    assert run["usage"]["llm_calls"] <= run["budget"]["max_llm_calls"]


def test_exploration_stops_when_everything_has_been_read(auth_client, llm, seeded):
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)  # default limits: every passage fits the first iteration
    ex = steps(auth_client, detail["id"])
    assert not any(k.startswith("r1:planner") for k in ex)  # no choice to make → no model call
    run = get(auth_client, detail["id"], "runs")[0]
    assert run["iterations"] == 1
    assert "planner" not in {p["stage"] for p in detail["progress"]}  # optional stage hidden, never "pending"


def test_budget_stops_exploration_but_the_run_completes(auth_client, llm, seeded, harness):
    harness.settings_overrides.update(ADAPTIVE | {"run_max_llm_calls": 10})
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    assert detail["status"] == "completed"
    run = get(auth_client, detail["id"], "runs")[0]
    assert "budget" in run["stop_reason"]
    assert run["usage"]["llm_calls"] <= 10


def test_budget_exhaustion_fails_mandatory_steps_and_resume_continues(auth_client, llm, seeded, harness):
    harness.settings_overrides.update({"run_max_llm_calls": 6})
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    assert detail["status"] == "failed" and "budget exhausted" in detail["error"].lower()
    assert get(auth_client, detail["id"], "reports") == []
    assert get(auth_client, detail["id"], "runs")[0]["usage"]["llm_calls"] <= 6
    calls = len(llm.calls)
    harness.settings_overrides["run_max_llm_calls"] = 40
    resumed = auth_client.post(f"/api/v1/investigations/{detail['id']}/resume").json()
    assert resumed["status"] == "completed" and resumed["run_count"] == 1
    assert "research" not in llm.calls[calls:]  # research already succeeded and is reused


# --------------------------------------------------------------------------- memory and cross-investigation intelligence


def test_new_investigation_reuses_workspace_memory(auth_client, llm, seeded):
    first = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1, "First")
    first_claims = {c["id"] for c in get(auth_client, first["id"], "claims")}
    first_hyps = {h["id"] for h in get(auth_client, first["id"], "hypotheses")}
    second = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_2, "Second", doc_ids=[seeded["docs"]["review-2021.txt"]["id"]])
    ex = steps(auth_client, second["id"])
    memory = ex["r1:memory"]["output"]
    assert set(memory["claim_ids"]) & first_claims, "earlier claims must be recalled"
    assert set(memory["hypothesis_ids"]) <= first_hyps and memory["hypothesis_ids"]
    assert any(line.startswith("Previous investigation 'First'") for line in memory["lines"])
    assert ex["r1:orchestrator"]["input"]["prior_knowledge"] == memory["lines"]
    reasoned = set(ex["r1:hypothesis"]["input"]["claim_refs"].values())
    assert reasoned & (set(memory["claim_ids"]) - {c["id"] for c in get(auth_client, second["id"], "claims")})  # reasons over recalled knowledge
    revised = [h for h in get(auth_client, second["id"], "hypotheses") if h["revises_hypothesis_id"]]
    assert revised and {h["revises_hypothesis_id"] for h in revised} <= first_hyps
    evolution = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/insights").json()["hypothesis_evolution"]
    assert any(link["link"] == "revision" for link in evolution)


def test_comparison_reports_knowledge_evolution(auth_client, llm, seeded):
    a = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1, "First")
    b = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_2, "Second")
    cmp = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/investigations/compare", params={"ids": f"{b['id']},{a['id']}"}).json()
    (evo,) = cmp["evolution"]
    assert evo["from"]["title"] == "First" and evo["to"]["title"] == "Second"  # ordered oldest → newest
    for key in (
        "shared_entities",
        "new_entities",
        "new_relationships",
        "changed_hypotheses",
        "resolved_contradictions",
        "new_conflicts",
        "knowledge_evolution",
    ):
        assert key in evo
    assert evo["knowledge_evolution"]["from"]


def test_insights_are_workspace_isolated(auth_client, other_client, llm, seeded):
    d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    ins = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/insights").json()
    assert ins["investigations"] == 1 and ins["gaps"]["open_hypotheses"]
    empty = auth_client.post("/api/v1/workspaces", json={"name": "Elsewhere"}).json()
    other = auth_client.get(f"/api/v1/workspaces/{empty['id']}/insights").json()
    assert other["investigations"] == 0 and not other["gaps"]["open_hypotheses"] and not other["bridging_entities"]
    assert other_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/insights").status_code == 404
    # Memory never crosses workspaces either.
    docs_elsewhere = d.seed(auth_client, "Second workspace")
    detail = d.run(auth_client, docs_elsewhere["ws"]["id"], d.QUESTION_1)
    memory = steps(auth_client, detail["id"])["r1:memory"]["output"]
    assert memory["claim_ids"] == [] and memory["hypothesis_ids"] == []


# --------------------------------------------------------------------------- debate, hypothesis reasoning, consensus


def test_debate_is_recorded_and_consensus_is_evidence_based(auth_client, llm, seeded):
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    ex = steps(auth_client, detail["id"])
    assert ex["r1:debate:challenge"]["agent_role"] == "challenger"
    objections = sum(len(c["objections"]) for c in ex["r1:debate:challenge"]["output"]["result"]["challenges"])
    assert ("r1:debate:defense" in ex) == bool(objections)  # the author answers only when there is something to answer
    if objections:
        assert ex["r1:debate:defense"]["agent_role"] == "hypothesis"
    hyps = get(auth_client, detail["id"], "hypotheses")
    messages = get(auth_client, detail["id"], "messages")
    kinds = {m["kind"] for m in messages}
    assert "verdict" in kinds
    if objections:
        assert "challenge" in kinds and kinds & {"rebuttal", "concession", "revision"}
    for h in hyps:
        assert h["reasoning_type"] in {"correlation", "causation", "inference", "speculation"}
        assert h["falsification_conditions"] and h["assumptions"]
        assert h["consensus"] in {"agreed", "contested", "rejected", "insufficient", "unchallenged"}
        debate = h["debate"]
        if debate.get("objections") is not None:
            standing = sum(1 for o in debate["objections"] if not o["answered_with_evidence"])
            assert debate["standing_objections"] == standing
            if standing and h["consensus"] != "rejected":
                assert h["consensus"] == "contested"  # unanswered objections block agreement
            for o in debate["objections"]:
                if o["response"] and o["response"]["stance"] == "rebut" and not o["response"]["cited_claim_ids"]:
                    assert not o["answered_with_evidence"]  # a rebuttal without evidence does not count
        verdicts = [m for m in messages if m["kind"] == "verdict" and m["subject_id"] == h["id"]]
        assert len(verdicts) == 1 and verdicts[0]["content"]["consensus"] == h["consensus"]


def test_causation_without_causal_evidence_is_downgraded(auth_client, llm, seeded):
    # Simulate a model that over-claims: every hypothesis declared causal.
    llm.transforms["hypothesis"] = lambda out: out.model_copy(
        update={"hypotheses": [h.model_copy(update={"reasoning_type": "causation"}) for h in out.hypotheses]}
    )
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    ex = steps(auth_client, detail["id"])
    declared = [h["reasoning_type"] for h in ex["r1:hypothesis"]["output"]["result"]["hypotheses"]]
    assert "causation" in declared  # the fixture claims causation from co-occurring terms
    stored = get(auth_client, detail["id"], "hypotheses")
    assert all(h["reasoning_type"] != "causation" for h in stored)  # no cited claim asserts a causal relationship
    assert any("downgraded to correlation" in (h["debate"].get("reasoning_check") or "") for h in stored)


# --------------------------------------------------------------------------- temporal and source intelligence


def test_temporal_supersession_resolution_and_timeline(auth_client, llm, seeded):
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    claims = {c["id"]: c for c in get(auth_client, detail["id"], "claims")}
    superseded = [c for c in claims.values() if c["superseded_by_id"]]
    assert superseded, "the 2019 figure must be superseded by the 2023 figure"
    old = superseded[0]
    assert "30 percent" in old["statement"] and old["valid_from_year"] == 2019
    assert "61 percent" in claims[old["superseded_by_id"]]["statement"]
    resolved = [x for x in get(auth_client, detail["id"], "contradictions") if x["resolution_kind"] == "temporal"]
    assert resolved and all("Different periods" in x["resolution"] for x in resolved)
    entity = old["subject"]["id"]
    timeline = auth_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/graph/entities/{entity}/timeline").json()
    years = [e["year"] for e in timeline if e["type"] == "claim" and e["year"]]
    assert years == sorted(years)
    assert any(e["type"] == "change" and e["details"].get("kind") == "claim_superseded" for e in timeline)


def test_source_assessment_is_separate_from_claim_confidence(auth_client, llm, seeded):
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    sources = {s["source"]["title"]: s for s in get(auth_client, detail["id"], "sources")}
    s2019, s2023 = sources["Northern Reef Monitoring 2019"], sources["Northern Reef Monitoring 2023"]
    assert s2019["independence_group"] == s2023["independence_group"]  # same author and host
    assert s2019["independence"] == 0.5 and sources["Independent Reef Review"]["independence"] == 1.0
    assert s2023["credibility"] == 0.7 and sources["Independent Reef Review"]["credibility"] == 0.8  # type priors, labelled as such
    assert "not a verified rating" in s2023["details"]["credibility_basis"]
    assert s2023["recency"] > s2019["recency"]
    assert sources["Coastal News"]["corroboration"] > 0  # restates a survey claim from an independent group
    for h in get(auth_client, detail["id"], "hypotheses"):
        assert h["confidence_method"]["method"] == "astrion-evidence-v2"
        assert "credibility" not in h["confidence_method"]["components"]  # source reliability never enters claim/hypothesis scores


# --------------------------------------------------------------------------- active learning


def test_next_steps_are_ranked_and_explained(auth_client, llm, seeded):
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    recs = auth_client.get(f"/api/v1/investigations/{detail['id']}/next-steps").json()
    assert recs
    assert [r["score"] for r in recs] == sorted((r["score"] for r in recs), reverse=True)
    for r in recs:
        assert r["explanation"].startswith(r["target"][:20]) and "selected because" in r["explanation"]
        assert r["method"] == "astrion-active-v1" and set(r["factors"]) == {"uncertainty", "relevance", "information_gain", "evidence_quality", "contradiction"}
    assert {"add_evidence", "test_hypothesis"} <= {r["kind"] for r in recs}


# --------------------------------------------------------------------------- authorization


def test_phase3_routes_are_owner_scoped(auth_client, other_client, llm, seeded):
    detail = d.run(auth_client, seeded["ws"]["id"], d.QUESTION_1)
    for part in ("runs", "next-steps", "assessments", "messages", "sources"):
        assert other_client.get(f"/api/v1/investigations/{detail['id']}/{part}").status_code == 404, part
    entity = get(auth_client, detail["id"], "claims")[0]["subject"]["id"]
    assert other_client.get(f"/api/v1/workspaces/{seeded['ws']['id']}/graph/entities/{entity}/timeline").status_code == 404
    bob_ws = other_client.post("/api/v1/workspaces", json={"name": "Bob"}).json()["id"]
    assert other_client.get(f"/api/v1/workspaces/{bob_ws}/graph/entities/{entity}/timeline").status_code == 404
