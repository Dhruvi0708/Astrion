"""Schema-level guarantees that protect provenance and honesty of the data model."""

from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError, StatementError

from app.models import (
    AgentExecution,
    Claim,
    Document,
    Evidence,
    GraphEntity,
    GraphRelationship,
    GraphSnapshot,
    Hypothesis,
    HypothesisEvidence,
    Investigation,
    SimulationScenario,
    Source,
    User,
    Workspace,
)
from app.models.enums import (
    AgentRole,
    EvidenceStance,
    ExtractionMethod,
    HypothesisOrigin,
    SourceType,
    VerificationStatus,
)


@pytest.fixture()
def graph(db_session):
    """Builds a minimal but complete provenance chain: source → document → claim → evidence → relationship."""
    s = db_session
    user = User(email="r@example.org", display_name="Researcher")
    ws = Workspace(name="W", slug="w", settings={}, owner=user)
    s.add_all([user, ws])
    s.flush()
    src = Source(workspace_id=ws.id, title="Survey", source_type=SourceType.report, authors=[], attributes={})
    s.add(src)
    s.flush()
    doc = Document(workspace_id=ws.id, source_id=src.id, title="survey.pdf", media_type="application/pdf")
    s.add(doc)
    s.flush()
    claim = Claim(workspace_id=ws.id, document_id=doc.id, statement="X co-occurs with Y.", extraction_method=ExtractionMethod.manual)
    s.add(claim)
    s.flush()
    ev = Evidence(workspace_id=ws.id, claim_id=claim.id, document_id=doc.id, quote="…", locator={"page": 3}, stance=EvidenceStance.supports)
    a = GraphEntity(workspace_id=ws.id, graph_key="e:x", name="X", entity_type="concept", properties={})
    b = GraphEntity(workspace_id=ws.id, graph_key="e:y", name="Y", entity_type="concept", properties={})
    s.add_all([ev, a, b])
    s.flush()
    rel = GraphRelationship(workspace_id=ws.id, graph_key="r:xy", source_entity_id=a.id, target_entity_id=b.id, relation_type="CORRELATES_WITH", evidence_id=ev.id, confidence=0.5, properties={})
    s.add(rel)
    s.commit()
    return {"ws": ws, "doc": doc, "claim": claim, "ev": ev, "a": a, "b": b, "rel": rel, "user": user}


def test_full_provenance_chain_persists(graph, db_session):
    rel = db_session.get(GraphRelationship, graph["rel"].id)
    ev = db_session.get(Evidence, rel.evidence_id)
    claim = db_session.get(Claim, ev.claim_id)
    doc = db_session.get(Document, claim.document_id)
    assert db_session.get(Source, doc.source_id).title == "Survey"


def test_verified_hypothesis_requires_verification_timestamp(graph, db_session):
    h = Hypothesis(workspace_id=graph["ws"].id, statement="H", origin=HypothesisOrigin.ai_generated, status=VerificationStatus.verified)
    db_session.add(h)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    ok = Hypothesis(
        workspace_id=graph["ws"].id,
        statement="H",
        origin=HypothesisOrigin.ai_generated,
        status=VerificationStatus.verified,
        verified_at=datetime.now(UTC),
        verified_by_id=graph["user"].id,
    )
    db_session.add(ok)
    db_session.commit()
    db_session.add(HypothesisEvidence(hypothesis_id=ok.id, evidence_id=graph["ev"].id, stance=EvidenceStance.supports))
    db_session.commit()


def test_new_hypotheses_default_to_unverified(graph, db_session):
    h = Hypothesis(workspace_id=graph["ws"].id, statement="H", origin=HypothesisOrigin.ai_generated)
    db_session.add(h)
    db_session.commit()
    assert db_session.get(Hypothesis, h.id).status is VerificationStatus.unverified


def test_relationship_rejects_self_loops_and_bad_confidence(graph, db_session):
    db_session.add(GraphRelationship(workspace_id=graph["ws"].id, graph_key="r:loop", source_entity_id=graph["a"].id, target_entity_id=graph["a"].id, relation_type="X", properties={}))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    db_session.add(GraphRelationship(workspace_id=graph["ws"].id, graph_key="r:conf", source_entity_id=graph["a"].id, target_entity_id=graph["b"].id, relation_type="X", confidence=1.5, properties={}))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_graph_keys_unique_per_workspace(graph, db_session):
    db_session.add(GraphEntity(workspace_id=graph["ws"].id, graph_key="e:x", name="dup", entity_type="concept", properties={}))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_invalid_enum_value_rejected(graph, db_session):
    with pytest.raises((StatementError, LookupError, IntegrityError)):
        db_session.add(Source(workspace_id=graph["ws"].id, title="t", source_type="novel", authors=[], attributes={}))
        db_session.commit()
    db_session.rollback()


def test_agent_execution_handoff_and_scenario(graph, db_session):
    inv = Investigation(workspace_id=graph["ws"].id, title="I", question="Q?")
    db_session.add(inv)
    db_session.flush()
    first = AgentExecution(workspace_id=graph["ws"].id, investigation_id=inv.id, agent_role=AgentRole.inquirer, input={})
    db_session.add(first)
    db_session.flush()
    second = AgentExecution(workspace_id=graph["ws"].id, investigation_id=inv.id, parent_execution_id=first.id, agent_role=AgentRole.cartographer, input={})
    base = SimulationScenario(workspace_id=graph["ws"].id, name="Baseline", parameters={"a": 1}, assumptions=[])
    db_session.add_all([second, base])
    db_session.flush()
    alt = SimulationScenario(workspace_id=graph["ws"].id, name="Alt", baseline_scenario_id=base.id, parameters={"a": 2}, assumptions=[])
    snap = GraphSnapshot(workspace_id=graph["ws"].id, label="v1", node_count=2, relationship_count=1, details={})
    db_session.add_all([alt, snap])
    db_session.commit()
    assert db_session.get(AgentExecution, second.id).parent_execution_id == first.id
    assert db_session.get(SimulationScenario, alt.id).is_illustrative is True


def test_deleting_workspace_cascades(graph, db_session):
    db_session.delete(db_session.get(Workspace, graph["ws"].id))
    db_session.commit()
    db_session.expunge_all()  # drop cached instances so the assertions hit the database
    assert db_session.get(Document, graph["doc"].id) is None
    assert db_session.get(GraphRelationship, graph["rel"].id) is None
