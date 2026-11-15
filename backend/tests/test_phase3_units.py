"""Unit tests for Phase 3 building blocks (deterministic; no model involved)."""

import uuid

import pytest

from app.intelligence import contracts as c
from app.intelligence.active_learning import Candidate, sufficiency
from app.intelligence.agents import CHALLENGER, DEFENSE, PLANNER
from app.intelligence.confidence import ClaimWeight, hypothesis_confidence
from app.intelligence.insights import workspace_insights
from app.intelligence.retrieval import BM25, jaccard, tokens
from app.intelligence.temporal import Period, _figures, parse_period, resolve_temporal
from app.models import Claim, Document, GraphEntity, GraphRelationship, Investigation, RelationshipClaim, Source, User, Workspace
from app.models.enums import ClaimKind, ExtractionMethod, SourceType
from app.models.knowledge import InvestigationClaim

# --------------------------------------------------------------------------- retrieval


def test_bm25_ranks_by_relevance_and_is_deterministic():
    docs = ["coral bleaching rises with ocean warming", "fish graze algae on reefs", "warming oceans and coral reefs bleaching events"]
    hits = BM25(docs).search("ocean warming coral bleaching")
    assert [h.index for h in hits][:2] == [0, 2] and BM25(docs).search("ocean warming coral bleaching") == hits
    assert all(h.matched for h in hits)
    assert BM25(docs).search("ocean warming", min_matched=2)[0].index == 0
    assert BM25(docs).search("volcano") == []
    assert tokens("The Corals were bleaching in 2023") == ["coral", "bleaching"]
    assert jaccard("coral bleaching", "bleaching of coral") == 1.0


# --------------------------------------------------------------------------- temporal


@pytest.mark.parametrize(
    ("text", "period"),
    [
        ("between 2018 and 2020", Period(2018, 2020)),
        ("2019–2021 surveys", Period(2019, 2021)),
        ("since 2015", Period(2015, None)),
        ("until 2010", Period(None, 2010)),
        ("in 2023", Period(2023, 2023)),
        ("no dates here", None),
    ],
)
def test_parse_period(text, period):
    assert parse_period(text) == period


def test_temporal_resolution_and_figures():
    a = Claim(statement="x", valid_from_year=2018, valid_to_year=2020)
    b = Claim(statement="y", valid_from_year=2023, valid_to_year=2023)
    assert "Different periods (2018–2020 vs 2023)" in resolve_temporal(a, b)
    assert resolve_temporal(a, Claim(statement="z", valid_from_year=2019, valid_to_year=2019)) is None  # overlapping: a real conflict
    assert resolve_temporal(a, Claim(statement="undated")) is None
    assert _figures("Bleaching affected 61 percent of sites in 2023") == ["61"]  # years are not figures


# --------------------------------------------------------------------------- active learning


def test_candidate_score_is_weighted_and_explained():
    cand = Candidate(
        id="A1",
        kind="research_subquestion",
        target="Q1: why",
        chunk_ids=["x"],
        factors={"uncertainty": 1.0, "relevance": 1.0, "information_gain": 0.0, "evidence_quality": 0.0, "contradiction": 0.0},
    ).finalize()
    assert cand.score == 0.55
    assert "little evidence so far" in cand.explanation and "closely matches the question" in cand.explanation
    clipped = Candidate(
        id="A2",
        kind="k",
        target="t",
        chunk_ids=[],
        factors={"uncertainty": 3.0, "relevance": -1.0, "information_gain": 0, "evidence_quality": 0, "contradiction": 0},
    ).finalize()
    assert clipped.factors["uncertainty"] == 1.0 and clipped.factors["relevance"] == 0.0


def test_sufficiency_rules():
    covered = [{"sub_question_id": "Q1", "claims": 3}, {"sub_question_id": "Q2", "claims": 2}]
    weak = [{"sub_question_id": "Q1", "claims": 0}]
    low = Candidate(
        id="A1",
        kind="k",
        target="t",
        chunk_ids=[],
        factors={"uncertainty": 0.2, "relevance": 0.2, "information_gain": 0, "evidence_quality": 0, "contradiction": 0},
    ).finalize()
    high = Candidate(
        id="A1",
        kind="k",
        target="t",
        chunk_ids=[],
        factors={"uncertainty": 1, "relevance": 1, "information_gain": 1, "evidence_quality": 1, "contradiction": 0},
    ).finalize()
    assert sufficiency(covered, [], 2)[0] is True
    assert sufficiency(weak, [], 2) == (True, "No unread passage addresses Q1; more evidence needs new documents.")
    assert sufficiency(covered, [low], 2)[0] is True
    assert sufficiency(weak, [high], 2)[0] is False


# --------------------------------------------------------------------------- confidence v2


def test_confidence_counts_independent_groups_and_discounts_superseded_claims():
    same_group = [ClaimWeight(True, "g1"), ClaimWeight(True, "g1")]
    two_groups = [ClaimWeight(True, "g1"), ClaimWeight(True, "g2")]
    assert hypothesis_confidence(two_groups, [])["score"] > hypothesis_confidence(same_group, [])["score"]
    fresh = hypothesis_confidence([ClaimWeight(True, "g1")], [])
    stale = hypothesis_confidence([ClaimWeight(True, "g1", superseded=True)], [])
    assert stale["score"] < fresh["score"] and stale["inputs"]["superseded_supporting"] == 1


# --------------------------------------------------------------------------- agent post-validation


def _view(ref: str, doc: str = "d") -> c.ClaimView:
    return c.ClaimView(ref=ref, statement=f"claim {ref}", kind="explicit", document=doc, source="s")


def _hyp(ref: str = "H1") -> c.HypothesisForDebate:
    return c.HypothesisForDebate(
        ref=ref, statement="s", rationale="r", reasoning_type="correlation", assumptions=[], falsification_conditions=[], supporting=[_view("C1")], opposing=[]
    )


def test_planner_may_only_choose_listed_actions():
    payload = c.PlannerInput(
        question="q",
        iteration=1,
        iterations_left=2,
        sub_questions=[],
        coverage=[],
        candidates=[c.CandidateAction(id=f"A{i}", kind="k", target="t", explanation="e", score=0.5, passages=1) for i in range(1, 6)],
        recent_claims=[],
        budget_note="",
    )
    out, notes = PLANNER.post_validate(
        payload,
        c.PlannerOutput(sufficient=False, rationale="r", selected_action_ids=["A9", "A1", "A1", "A2", "A3", "A4"], new_sub_questions=[], evidence_gaps=[]),
    )
    assert out.selected_action_ids == ["A1", "A2", "A3"] and any("A9" in n for n in notes)
    out, _ = PLANNER.post_validate(payload, c.PlannerOutput(sufficient=True, rationale="r", selected_action_ids=["A1"], new_sub_questions=[], evidence_gaps=[]))
    assert out.selected_action_ids == []


def test_challenger_counter_evidence_must_cite_claims():
    payload = c.ChallengerInput(question="q", hypotheses=[_hyp()], claims=[_view("C1"), _view("C2")])
    out, notes = CHALLENGER.post_validate(
        payload,
        c.ChallengerOutput(
            challenges=[
                c.Challenge(
                    hypothesis_ref="H1",
                    objections=[
                        c.Objection(kind="counter_evidence", argument="no cite", cited_claim_refs=["C9"]),
                        c.Objection(kind="counter_evidence", argument="cited", cited_claim_refs=["C2", "C9"]),
                        c.Objection(kind="confounder", argument="maybe", cited_claim_refs=[]),
                    ],
                    alternative_hypothesis=None,
                    strength="moderate",
                ),
                c.Challenge(hypothesis_ref="H7", objections=[], alternative_hypothesis=None, strength="weak"),
            ]
        ),
    )
    (ch,) = out.challenges
    assert [o.argument for o in ch.objections] == ["cited", "maybe"] and ch.objections[0].cited_claim_refs == ["C2"]
    assert any("H7" in n for n in notes)


def test_defense_rebuttal_without_evidence_is_flagged():
    payload = c.DefenseInput(
        question="q",
        hypotheses=[_hyp()],
        objections=[
            c.ObjectionView(id="H1.O1", hypothesis_ref="H1", kind="confounder", argument="a", cited_claims=[]),
            c.ObjectionView(id="H1.O2", hypothesis_ref="H1", kind="scope", argument="b", cited_claims=[]),
        ],
        claims=[_view("C1")],
    )
    out, notes = DEFENSE.post_validate(
        payload, c.DefenseOutput(responses=[c.DefenseResponse(objection_id="H1.O1", stance="rebut", argument="no", cited_claim_refs=["C5"])], revisions=[])
    )
    assert out.responses[0].cited_claim_refs == []
    assert any("cites no evidence" in n for n in notes) and any("H1.O2: no response" in n for n in notes)


# --------------------------------------------------------------------------- cross-investigation insights


def test_insights_find_unnoticed_connections_patterns_and_corroboration(db_session):
    db = db_session
    user = User(email=f"u{uuid.uuid4().hex[:6]}@example.org", password_hash="x", display_name="U")
    db.add(user)
    db.flush()
    ws = Workspace(name="W", slug=f"w-{uuid.uuid4().hex[:6]}", owner_id=user.id)
    db.add(ws)
    db.flush()
    src = Source(workspace_id=ws.id, title="S", source_type=SourceType.report)
    db.add(src)
    db.flush()
    doc = Document(workspace_id=ws.id, source_id=src.id, title="D", media_type="text/plain")
    db.add(doc)
    inv1 = Investigation(workspace_id=ws.id, title="One", question="first question here")
    inv2 = Investigation(workspace_id=ws.id, title="Two", question="second question here")
    db.add_all([inv1, inv2])
    db.flush()
    ents = {}
    for name in ("Alpha", "Beta", "Gamma"):
        e = GraphEntity(workspace_id=ws.id, graph_key=f"ent:{uuid.uuid4()}", name=name, entity_type="concept", normalized_name=name.lower())
        db.add(e)
        ents[name] = e
    db.flush()

    def claim(subject: str, inv: Investigation) -> Claim:
        cl = Claim(
            workspace_id=ws.id,
            document_id=doc.id,
            statement=f"{subject} {uuid.uuid4().hex}",
            extraction_method=ExtractionMethod.model,
            kind=ClaimKind.explicit,
            subject_entity_id=ents[subject].id,
        )
        db.add(cl)
        db.flush()
        db.add(InvestigationClaim(investigation_id=inv.id, claim_id=cl.id))
        return cl

    def rel(a: str, b: str, *claims: Claim) -> None:
        r = GraphRelationship(
            workspace_id=ws.id,
            graph_key=f"rel:{uuid.uuid4()}",
            source_entity_id=ents[a].id,
            target_entity_id=ents[b].id,
            relation_type="CAUSES",
            support_count=len(claims),
        )
        db.add(r)
        db.flush()
        for cl in claims:
            db.add(RelationshipClaim(relationship_id=r.id, claim_id=cl.id))

    a1 = claim("Alpha", inv1)
    b2 = claim("Beta", inv2)
    g2 = claim("Gamma", inv2)
    rel("Alpha", "Beta", a1, b2)  # corroborated by both investigations
    rel("Beta", "Gamma", g2)
    db.commit()

    out = workspace_insights(db, ws.id)
    # never linked directly; the pair is undirected
    assert any({x["from"], x["to"]} == {"Alpha", "Gamma"} and x["via"] == "Beta" for x in out["connections"])
    assert [r["investigations"] for r in out["corroborated_relationships"]] == [["One", "Two"]]
    assert out["patterns"] == [{"pattern": "concept —causes→ concept", "investigations": 2}]
    assert {g["name"] for g in out["gaps"]["single_claim_entities"]} == {"Alpha", "Beta", "Gamma"}
    assert {"source": "Beta", "type": "CAUSES", "target": "Gamma"} in out["gaps"]["weakly_supported_relationships"]
