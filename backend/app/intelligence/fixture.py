"""Deterministic fixture provider — NOT an AI model.

Used for automated tests and for running the pipeline offline when no Anthropic key is configured
(``ASTRION_LLM_PROVIDER=fixture``, development/test only). It applies simple, transparent rules to the
*actual* document passages (keyword-matched sentences become claims, capitalised phrases become
entities), so the pipeline, persistence and UI can be exercised end-to-end. Every result is labelled
``provider="fixture"`` / ``model="astrion-fixture-v1"`` and the UI states that it is not AI analysis.
"""

import re
import time
from itertools import combinations
from typing import TypeVar

from pydantic import BaseModel

from app.intelligence import contracts as c
from app.intelligence.llm import StructuredResult

T = TypeVar("T", bound=BaseModel)

FIXTURE_MODEL = "astrion-fixture-v1"
STOP = set(
    "about above after again against all also among and any are because been before being between both but can could did does doing down during each few for from further had has have having here how into its itself just more most much must not now off once only other our out over own same should some such than that the their them then there these they this those through too under until very was were what when where which while who whom why will with would your does what which whose".split()  # noqa: E501
)
NEGATION = re.compile(r"\b(not|no|never|limited|little|without|fails?|failed|did not|does not|cannot|unclear|insignificant|negligible)\b", re.I)
CAUSAL = re.compile(r"\b(reduc\w*|increas\w*|caus\w*|lead\w*|drive\w*|affect\w*|influenc\w*|improv\w*|lower\w*|rais\w*)\b", re.I)
ASSOC = re.compile(r"\b(correlat\w*|associat\w*|linked|link)\b", re.I)
YEARS = re.compile(r"\b(?:19|20)\d{2}(?:\s*[–-]\s*(?:19|20)\d{2})?\b")
ENTITY = re.compile(r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+|[A-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)*)\b")
SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _terms(*texts: str) -> list[str]:
    seen: list[str] = []
    for t in texts:
        for w in re.findall(r"[A-Za-z][A-Za-z-]{3,}", t.lower()):
            if w not in STOP and w not in seen:
                seen.append(w)
    return seen


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 4 and w.endswith("s") else w


class FixtureLLM:
    provider = "fixture"
    model = FIXTURE_MODEL

    def generate(
        self, *, agent: str, system: str, prompt: str, output_type: type[T], payload: BaseModel, max_tokens: int = 16000, effort: str = "medium"
    ) -> StructuredResult[T]:
        started = time.perf_counter()
        output = getattr(self, f"_{agent}")(payload)
        return StructuredResult(
            output=output_type.model_validate(output.model_dump()),
            provider=self.provider,
            model_requested=FIXTURE_MODEL,
            model_served=FIXTURE_MODEL,
            request_id=None,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )

    # ------------------------------------------------------------------ agents

    def _orchestrator(self, p: c.OrchestratorInput) -> c.OrchestratorOutput:
        terms = _terms(p.question)[:8]
        return c.OrchestratorOutput(
            objective=p.question,
            scope_notes=f"Rule-based decomposition over {len(p.documents)} document(s).",
            sub_questions=[
                c.SubQuestion(id="Q1", question=p.question, rationale="The objective as stated."),
                c.SubQuestion(id="Q2", question=f"What evidence weakens or limits the premise of: {p.question}", rationale="Look for opposing evidence."),
            ],
            key_terms=terms,
            evidence_needs=[f"Statements mentioning {t}" for t in terms[:4]],
            initial_assessment="Fixture provider: keyword-based decomposition, not model reasoning.",
        )

    def _research(self, p: c.ResearchInput) -> c.ResearchOutput:
        terms = {_stem(t) for t in _terms(p.question, *[s.question for s in p.sub_questions])}
        entities: dict[str, c.ResearchEntity] = {}
        claims: list[c.ResearchClaim] = []
        rels: list[c.ResearchRelationship] = []

        def entity(name: str, etype: str) -> str:
            key = name.lower()
            if key not in entities:
                entities[key] = c.ResearchEntity(ref=f"E{len(entities) + 1}", name=name, entity_type=etype, description=f"Mentioned in {p.document_title}.")
            return entities[key].ref

        for passage in p.passages:
            # Lines first (headings have no full stop), then sentences; each piece stays a verbatim substring.
            sentences = [s for line in passage.text.splitlines() for s in SENTENCE.split(" ".join(line.split())) if s]
            for sentence in sentences:
                words = {_stem(w) for w in _terms(sentence)}
                hits = sorted(words & terms)
                if not hits or not (30 <= len(sentence) <= 400) or len(claims) >= 8:
                    continue
                names = [m.group(1) for m in ENTITY.finditer(sentence) if m.group(1).split()[0] not in ("The", "This", "These", "In", "At")]
                refs = [entity(n, "concept") for n in names[:3]] or [entity(hits[0], "concept")]
                ref = f"R{len(claims) + 1}"
                years = YEARS.search(sentence)
                claims.append(
                    c.ResearchClaim(
                        ref=ref,
                        statement=sentence,
                        kind="explicit",
                        subject_entity_ref=refs[0],
                        sub_question_ids=["Q2" if NEGATION.search(sentence) else "Q1"],
                        temporal_scope=years.group(0) if years else None,
                        confidence="medium",
                        evidence=[c.ResearchEvidence(passage_ref=passage.ref, quote=sentence)],
                    )
                )
                if len(refs) >= 2:
                    pred = "influences" if CAUSAL.search(sentence) else "associated_with" if ASSOC.search(sentence) else None
                    if pred:
                        rels.append(c.ResearchRelationship(source_entity_ref=refs[0], target_entity_ref=refs[1], predicate=pred, claim_refs=[ref]))
        relevance = "high" if len(claims) >= 4 else "medium" if claims else "none"
        return c.ResearchOutput(
            relevance=relevance,
            relevance_note=f"Fixture: {len(claims)} keyword-matched sentence(s).",
            entities=list(entities.values()),
            claims=claims,
            relationships=rels,
        )

    def _knowledge(self, p: c.KnowledgeInput) -> c.KnowledgeOutput:
        return c.KnowledgeOutput(
            decisions=[c.DuplicateDecision(pair_id=x.pair_id, same_entity=False, reason="Fixture provider never merges ambiguous entities.") for x in p.pairs]
        )

    def _shared(self, a: c.ClaimView, b: c.ClaimView) -> set[str]:
        return {_stem(w) for w in _terms(a.statement)} & {_stem(w) for w in _terms(b.statement)}

    def _hypothesis(self, p: c.HypothesisInput) -> c.HypothesisOutput:
        hyps: list[c.ProposedHypothesis] = []
        for a, b in combinations(p.claims, 2):
            if a.document == b.document or len(hyps) >= 3:
                continue
            shared = sorted(self._shared(a, b))
            if len(shared) < 2 or NEGATION.search(a.statement) or NEGATION.search(b.statement):
                continue
            opposing = [x.ref for x in p.claims if x.ref not in (a.ref, b.ref) and NEGATION.search(x.statement) and len(self._shared(a, x)) >= 2]
            hyps.append(
                c.ProposedHypothesis(
                    statement=f"Evidence from '{a.document}' and '{b.document}' may describe a common relationship involving {', '.join(shared[:3])}.",
                    rationale="Fixture rule: two claims from different documents share key terms.",
                    supporting_claim_refs=[a.ref, b.ref],
                    opposing_claim_refs=opposing[:3],
                    test_plan="Look for a source that measures both conditions together.",
                    assumptions=["Shared vocabulary indicates a shared subject (rule-based assumption)."],
                    plausibility="low",
                )
            )
        return c.HypothesisOutput(hypotheses=hyps, patterns_observed=[f"{len(p.claims)} claims compared by shared terms (fixture)."])

    def _contradiction(self, p: c.ContradictionInput) -> c.ContradictionOutput:
        found: list[c.DetectedContradiction] = []
        for a, b in combinations(p.claims, 2):
            if a.document == b.document or len(found) >= 5:
                continue
            if bool(NEGATION.search(a.statement)) == bool(NEGATION.search(b.statement)) or len(self._shared(a, b)) < 2:
                continue
            temporal = bool(a.temporal_scope and b.temporal_scope and a.temporal_scope != b.temporal_scope)
            found.append(
                c.DetectedContradiction(
                    claim_a_ref=a.ref,
                    claim_b_ref=b.ref,
                    kind="temporal" if temporal else "direct",
                    is_genuine=not temporal,
                    explanation="Fixture rule: claims share key terms but only one contains a negating/limiting statement.",
                    severity="medium",
                )
            )
        return c.ContradictionOutput(contradictions=found)

    def _verification(self, p: c.VerificationInput) -> c.VerificationOutput:
        reviews = []
        for h in p.hypotheses:
            docs = {x.document for x in h.supporting}
            verdict = "insufficient_evidence" if len(h.supporting) < 2 else "partially_supported" if h.opposing or len(docs) < 2 else "supported"
            reviews.append(
                c.Review(
                    target_ref=h.ref,
                    verdict=verdict,
                    reasoning=f"Fixture rule: {len(h.supporting)} supporting claim(s) from {len(docs)} document(s), {len(h.opposing)} opposing.",
                    issues=["Rule-based check; semantic support was not assessed."],
                    missing_evidence=["A source measuring the proposed relationship directly."],
                    unsupported_claim_refs=[],
                )
            )
        for x in p.contradictions:
            reviews.append(
                c.Review(
                    target_ref=x.ref,
                    verdict="supported" if x.is_genuine else "partially_supported",
                    reasoning="Fixture rule: the paired quotes exist and differ in polarity.",
                    issues=[],
                    missing_evidence=[],
                    unsupported_claim_refs=[],
                )
            )
        return c.VerificationOutput(reviews=reviews, overall_assessment="Fixture verification: structural checks only.")

    def _synthesis(self, p: c.SynthesisInput) -> c.SynthesisOutput:
        findings = [
            c.KeyFinding(statement=cl.statement, claim_refs=[cl.ref], confidence="low", basis="Single extracted sentence (fixture).") for cl in p.claims[:5]
        ]
        return c.SynthesisOutput(
            title=f"Fixture report: {p.question[:80]}",
            answer_status="partially_answered" if findings else "insufficient_evidence",
            executive_summary=(
                f"{len(p.claims)} claim(s), {len(p.hypotheses)} hypothesis(es) and {len(p.contradictions)} contradiction(s) "
                "were produced by deterministic rules."
            ),
            key_findings=findings,
            hypotheses=[c.ItemAssessment(ref=h.ref, assessment=f"Verifier verdict: {h.verdict}.") for h in p.hypotheses],
            contradictions=[c.ItemAssessment(ref=x.ref, assessment=x.explanation) for x in p.contradictions],
            unresolved_questions=[s.question for s in p.sub_questions[1:]],
            limitations=["Generated by the deterministic fixture provider — this is not AI analysis."],
        )
