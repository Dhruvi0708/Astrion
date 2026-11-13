"""Unit tests for the intelligence engine's building blocks (no database, no network)."""

import json
from types import SimpleNamespace

import pytest

from app.ai.llm import ProviderBadRequestError, ProviderRefusalError, ProviderUnavailableError
from app.core.config import Settings
from app.intelligence import contracts as c
from app.intelligence.agents import AGENTS, ResearchAgent, SynthesisAgent, VerificationAgent
from app.intelligence.confidence import ClaimWeight, hypothesis_confidence
from app.intelligence.fixture import FixtureLLM
from app.intelligence.knowledge_store import normalize_name, normalize_statement
from app.intelligence.llm import ClaudeStructuredLLM, SchemaValidationError, estimate_cost, get_structured_llm, strict_json_schema
from app.intelligence.text import ExtractionError, Segment, chunk, extract_segments
from app.models.enums import AgentRole

# --------------------------------------------------------------------------- schema conversion


@pytest.mark.parametrize(
    "model", [c.OrchestratorOutput, c.ResearchOutput, c.KnowledgeOutput, c.HypothesisOutput, c.ContradictionOutput, c.VerificationOutput, c.SynthesisOutput]
)
def test_strict_schema_closes_every_object(model):
    schema = strict_json_schema(model)

    def walk(node):
        if isinstance(node, dict):
            if "properties" in node:
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            assert not {"minLength", "maxLength", "minItems", "pattern", "default"} & set(node)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(schema)
    json.dumps(schema)


def test_every_role_has_an_agent():
    expected = {
        AgentRole.orchestrator,
        AgentRole.research,
        AgentRole.knowledge,
        AgentRole.hypothesis,
        AgentRole.contradiction,
        AgentRole.verification,
        AgentRole.synthesis,
    }
    assert set(AGENTS) == expected
    assert all(a.system and a.output_type for a in AGENTS.values())


# --------------------------------------------------------------------------- agent validation


def _research_payload() -> c.ResearchInput:
    return c.ResearchInput(
        question="Does warming increase bleaching?",
        sub_questions=[],
        document_title="survey",
        source_title="reef monitoring",
        passages=[c.PassageView(ref="P1", text="Ocean warming   increases coral\nbleaching across the reef.")],
    )


def test_research_drops_non_verbatim_quotes_and_orphans():
    out = c.ResearchOutput(
        relevance="high",
        relevance_note="",
        entities=[
            c.ResearchEntity(ref="E1", name="Ocean warming", entity_type="concept", description=""),
            c.ResearchEntity(ref="E2", name="Coral bleaching", entity_type="concept", description=""),
            c.ResearchEntity(ref="E3", name="Unused", entity_type="concept", description=""),
        ],
        claims=[
            c.ResearchClaim(
                ref="R1",
                statement="Warming increases bleaching.",
                kind="explicit",
                subject_entity_ref="E1",
                sub_question_ids=[],
                temporal_scope=None,
                confidence="high",
                evidence=[c.ResearchEvidence(passage_ref="P1", quote="Ocean warming increases coral bleaching")],  # whitespace differs: still verbatim
            ),
            c.ResearchClaim(
                ref="R2",
                statement="Warming halves bleaching.",
                kind="explicit",
                subject_entity_ref="E2",
                sub_question_ids=[],
                temporal_scope=None,
                confidence="high",
                evidence=[
                    c.ResearchEvidence(passage_ref="P1", quote="warming halves coral bleaching"),
                    c.ResearchEvidence(passage_ref="P9", quote="anything at all here"),
                ],
            ),
        ],
        relationships=[
            c.ResearchRelationship(source_entity_ref="E1", target_entity_ref="E2", predicate="causes", claim_refs=["R1"]),
            c.ResearchRelationship(source_entity_ref="E1", target_entity_ref="E2", predicate="influences", claim_refs=["R2"]),  # its claim was rejected
        ],
    )
    cleaned, notes = ResearchAgent().post_validate(_research_payload(), out)
    assert [cl.ref for cl in cleaned.claims] == ["R1"]
    assert [r.predicate for r in cleaned.relationships] == ["causes"]
    assert {e.ref for e in cleaned.entities} == {"E1", "E2"}  # E3 is an orphan
    assert any("not found verbatim" in n for n in notes) and any("unknown passage" in n for n in notes)


def test_verification_fills_missing_reviews_and_ignores_unknown_targets():
    view = c.ClaimView(ref="C1", statement="s", kind="explicit", document="d", source="s")
    payload = c.VerificationInput(
        question="q",
        hypotheses=[c.HypothesisForReview(ref="H1", statement="h", rationale="r", supporting=[view], opposing=[])],
        contradictions=[],
    )
    out = c.VerificationOutput(
        reviews=[c.Review(target_ref="H9", verdict="supported", reasoning="", issues=[], missing_evidence=[], unsupported_claim_refs=[])], overall_assessment=""
    )
    cleaned, _ = VerificationAgent().post_validate(payload, out)
    assert [(r.target_ref, r.verdict) for r in cleaned.reviews] == [("H1", "insufficient_evidence")]


def test_synthesis_removes_uncited_findings():
    view = c.ClaimView(ref="C1", statement="s", kind="explicit", document="d", source="s")
    payload = c.SynthesisInput(
        question="q", objective="o", sub_questions=[], claims=[view], hypotheses=[], contradictions=[], verification_summary="", documents_without_evidence=[]
    )
    out = c.SynthesisOutput(
        title="t",
        answer_status="answered",
        executive_summary="e",
        key_findings=[c.KeyFinding(statement="made up", claim_refs=["C7"], confidence="high", basis="")],
        hypotheses=[],
        contradictions=[],
        unresolved_questions=[],
        limitations=[],
    )
    cleaned, _ = SynthesisAgent().post_validate(payload, out)
    assert cleaned.key_findings == [] and cleaned.answer_status == "insufficient_evidence"


# --------------------------------------------------------------------------- confidence


def test_confidence_rewards_diverse_support_and_penalises_opposition():
    one = [ClaimWeight(True, "s1")]
    two_sources = [ClaimWeight(True, "s1"), ClaimWeight(True, "s2")]
    base = hypothesis_confidence(one, [])["score"]
    assert hypothesis_confidence(two_sources, [])["score"] > base
    assert hypothesis_confidence(one, [ClaimWeight(True, "s3")])["score"] < base
    assert hypothesis_confidence(one, [], "contradicted")["score"] < hypothesis_confidence(one, [], "supported")["score"]
    assert hypothesis_confidence([ClaimWeight(False, "s1")], [])["score"] < base  # inferred counts half
    r = hypothesis_confidence([], [])
    assert r["score"] == 0 and r["band"] == "low" and r["method"] == "astrion-evidence-v1"


# --------------------------------------------------------------------------- text


def test_extract_and_chunk_text():
    body = ("Paragraph one sentence. " * 40 + "\n\n" + "Second paragraph here. " * 40).encode()
    passages = chunk(extract_segments(body, "text/plain"))
    assert len(passages) >= 2
    assert all(p.text.strip() for p in passages)
    assert [p.index for p in passages] == list(range(len(passages)))


def test_extract_html_strips_markup_and_json_is_pretty():
    html = extract_segments(b"<html><script>evil()</script><p>Hello <b>reef</b></p></html>", "text/html")[0].text
    assert "Hello" in html and "reef" in html and "evil" not in html and "<" not in html
    assert '"a": 1' in extract_segments(b'{"a":1}', "application/json")[0].text


def test_unsupported_types_are_explicit_errors():
    with pytest.raises(ExtractionError):
        extract_segments(b"PK...", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert chunk([Segment(text="   ", page=None)]) == []


def test_normalisation():
    assert normalize_name("  The Great-Barrier Reef ") == normalize_name("great barrier reef")
    assert normalize_statement("Warming,  increases   BLEACHING.") == normalize_statement("warming increases bleaching")


# --------------------------------------------------------------------------- provider selection


def test_fixture_provider_is_refused_in_production():
    with pytest.raises(ProviderBadRequestError):
        get_structured_llm(Settings(ASTRION_ENVIRONMENT="production", ASTRION_LLM_PROVIDER="fixture", ASTRION_JWT_SECRET="x" * 40, ASTRION_COOKIE_SECURE=True))
    assert isinstance(get_structured_llm(Settings(ASTRION_ENVIRONMENT="test", ASTRION_LLM_PROVIDER="fixture")), FixtureLLM)
    assert get_structured_llm(Settings(ASTRION_ENVIRONMENT="test", ASTRION_LLM_PROVIDER="anthropic", ANTHROPIC_API_KEY="")) is None


def test_cost_estimate_unknown_model_is_none():
    assert estimate_cost("not-a-model", 1000, 1000) is None


# --------------------------------------------------------------------------- Claude structured outputs (fake SDK client)


class _Stream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self.message


class FakeClient:
    def __init__(self, text: str, stop_reason: str = "end_turn"):
        self.calls: list[dict] = []
        msg = SimpleNamespace(
            content=[SimpleNamespace(type="thinking", thinking="..."), SimpleNamespace(type="text", text=text)],
            stop_reason=stop_reason,
            model="claude-opus-5-5",
            usage=SimpleNamespace(input_tokens=1200, output_tokens=300),
            _request_id="req_123",
        )
        self.messages = SimpleNamespace(stream=lambda **kw: (self.calls.append(kw), _Stream(msg))[1])


def _claude(text: str, stop_reason: str = "end_turn") -> tuple[ClaudeStructuredLLM, FakeClient]:
    fake = FakeClient(text, stop_reason)
    return ClaudeStructuredLLM(Settings(ASTRION_ENVIRONMENT="test", ANTHROPIC_API_KEY="sk-test"), client=fake), fake


def _plan_json() -> str:
    return json.dumps({"objective": "o", "scope_notes": "", "sub_questions": [], "key_terms": [], "evidence_needs": [], "initial_assessment": ""})


def test_claude_request_uses_structured_outputs_and_tracks_usage():
    llm, fake = _claude(_plan_json())
    payload = c.OrchestratorInput(question="q", documents=[])
    res = llm.generate(agent="orchestrator", system="sys", prompt="p", output_type=c.OrchestratorOutput, payload=payload, effort="low")
    kw = fake.calls[0]
    assert kw["thinking"] == {"type": "adaptive"}
    assert kw["output_config"]["effort"] == "low"
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["output_config"]["format"]["schema"]["additionalProperties"] is False
    assert "fallbacks" not in kw
    assert res.provider == "anthropic" and res.model_served == "claude-opus-5-5" and res.request_id == "req_123"
    assert (res.input_tokens, res.output_tokens) == (1200, 300)
    assert res.cost_usd is not None and res.cost_usd > 0


def test_claude_invalid_json_is_a_retryable_schema_error():
    llm, _ = _claude('{"objective": 1}')
    with pytest.raises(SchemaValidationError) as exc:
        llm.generate(agent="orchestrator", system="s", prompt="p", output_type=c.OrchestratorOutput, payload=c.OrchestratorInput(question="q", documents=[]))
    assert exc.value.retryable


def test_claude_refusal_and_truncation_are_surfaced():
    llm, _ = _claude("", "refusal")
    with pytest.raises(ProviderRefusalError):
        llm.generate(agent="research", system="s", prompt="p", output_type=c.OrchestratorOutput, payload=c.OrchestratorInput(question="q", documents=[]))
    llm, _ = _claude(_plan_json()[:10], "max_tokens")
    with pytest.raises(ProviderUnavailableError):
        llm.generate(agent="research", system="s", prompt="p", output_type=c.OrchestratorOutput, payload=c.OrchestratorInput(question="q", documents=[]))
