"""Typed input and output contracts for every agent.

Outputs are what the model must return (constrained by JSON schema, re-validated with Pydantic).
References inside an investigation use short, human-readable handles (``C3`` for a claim, ``H1`` for a
hypothesis, ``X2`` for a contradiction, ``P4`` for a passage) that the orchestrator maps back to
database ids, so the model never has to copy UUIDs and can't reference anything it wasn't shown.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Confidence = Literal["low", "medium", "high"]
EntityType = Literal["concept", "organization", "person", "location", "event", "metric", "method", "artifact", "other"]
Predicate = Literal["influences", "causes", "correlates_with", "part_of", "associated_with", "precedes", "located_in", "measures"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- shared views


class PassageView(Contract):
    ref: str  # P1, P2 …
    text: str


class ClaimView(Contract):
    ref: str  # C1, C2 …
    statement: str
    kind: Literal["explicit", "inferred"]
    document: str
    source: str
    temporal_scope: str | None = None
    quotes: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- Orchestrator


class OrchestratorInput(Contract):
    question: str
    documents: list[str]  # "title — source" for each document in scope


class SubQuestion(Contract):
    id: str  # Q1, Q2 …
    question: str
    rationale: str


class OrchestratorOutput(Contract):
    objective: str
    scope_notes: str
    sub_questions: list[SubQuestion]
    key_terms: list[str]
    evidence_needs: list[str]
    initial_assessment: str


# --------------------------------------------------------------------------- Research


class ResearchInput(Contract):
    question: str
    sub_questions: list[SubQuestion]
    document_title: str
    source_title: str
    passages: list[PassageView]


class ResearchEvidence(Contract):
    passage_ref: str
    quote: str  # must appear verbatim in the passage


class ResearchEntity(Contract):
    ref: str  # E1, E2 … (local to this output)
    name: str
    entity_type: EntityType
    description: str


class ResearchClaim(Contract):
    ref: str  # local
    statement: str
    kind: Literal["explicit", "inferred"]
    subject_entity_ref: str | None
    sub_question_ids: list[str]
    temporal_scope: str | None
    confidence: Confidence
    evidence: list[ResearchEvidence]


class ResearchRelationship(Contract):
    source_entity_ref: str
    target_entity_ref: str
    predicate: Predicate
    claim_refs: list[str]


class ResearchOutput(Contract):
    relevance: Literal["none", "low", "medium", "high"]
    relevance_note: str
    entities: list[ResearchEntity]
    claims: list[ResearchClaim]
    relationships: list[ResearchRelationship]


# --------------------------------------------------------------------------- Knowledge (entity resolution)


class EntityCandidate(Contract):
    ref: str  # N1 (new) / K1 (existing)
    name: str
    entity_type: EntityType
    description: str


class DuplicateQuestion(Contract):
    pair_id: str  # D1, D2 …
    new_entity: EntityCandidate
    existing_entity: EntityCandidate


class KnowledgeInput(Contract):
    question: str
    pairs: list[DuplicateQuestion]


class DuplicateDecision(Contract):
    pair_id: str
    same_entity: bool
    reason: str


class KnowledgeOutput(Contract):
    decisions: list[DuplicateDecision]


# --------------------------------------------------------------------------- Hypothesis


class HypothesisInput(Contract):
    question: str
    sub_questions: list[SubQuestion]
    claims: list[ClaimView]
    relationships: list[str]  # "entity A —predicate→ entity B (C1, C4)"


class ProposedHypothesis(Contract):
    statement: str
    rationale: str
    supporting_claim_refs: list[str]
    opposing_claim_refs: list[str]
    test_plan: str
    assumptions: list[str]
    plausibility: Confidence


class HypothesisOutput(Contract):
    hypotheses: list[ProposedHypothesis]
    patterns_observed: list[str]


# --------------------------------------------------------------------------- Contradiction


class ContradictionInput(Contract):
    question: str
    claims: list[ClaimView]


class DetectedContradiction(Contract):
    claim_a_ref: str
    claim_b_ref: str
    kind: Literal["direct", "temporal", "contextual"]
    is_genuine: bool
    explanation: str
    severity: Literal["low", "medium", "high"]


class ContradictionOutput(Contract):
    contradictions: list[DetectedContradiction]


# --------------------------------------------------------------------------- Verification


class HypothesisForReview(Contract):
    ref: str  # H1 …
    statement: str
    rationale: str
    supporting: list[ClaimView]
    opposing: list[ClaimView]


class ContradictionForReview(Contract):
    ref: str  # X1 …
    claim_a: ClaimView
    claim_b: ClaimView
    kind: str
    is_genuine: bool
    explanation: str


class VerificationInput(Contract):
    question: str
    hypotheses: list[HypothesisForReview]
    contradictions: list[ContradictionForReview]


class Review(Contract):
    target_ref: str  # H1 / X1
    verdict: Literal["supported", "partially_supported", "unsupported", "insufficient_evidence", "contradicted"]
    reasoning: str
    issues: list[str]
    missing_evidence: list[str]
    unsupported_claim_refs: list[str]


class VerificationOutput(Contract):
    reviews: list[Review]
    overall_assessment: str


# --------------------------------------------------------------------------- Synthesis


class VerifiedHypothesisView(Contract):
    ref: str
    statement: str
    verdict: str
    confidence: Confidence
    supporting_claim_refs: list[str]
    opposing_claim_refs: list[str]


class ContradictionView(Contract):
    ref: str
    claim_a_ref: str
    claim_b_ref: str
    kind: str
    is_genuine: bool
    verdict: str | None
    explanation: str


class SynthesisInput(Contract):
    question: str
    objective: str
    sub_questions: list[SubQuestion]
    claims: list[ClaimView]
    hypotheses: list[VerifiedHypothesisView]
    contradictions: list[ContradictionView]
    verification_summary: str
    documents_without_evidence: list[str]


class KeyFinding(Contract):
    statement: str
    claim_refs: list[str]  # every finding must cite claims
    confidence: Confidence
    basis: str


class ItemAssessment(Contract):
    ref: str
    assessment: str


class SynthesisOutput(Contract):
    title: str
    answer_status: Literal["answered", "partially_answered", "insufficient_evidence"]
    executive_summary: str
    key_findings: list[KeyFinding]
    hypotheses: list[ItemAssessment]
    contradictions: list[ItemAssessment]
    unresolved_questions: list[str]
    limitations: list[str]
