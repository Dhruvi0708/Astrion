"""The seven ASTRION agents.

Each agent is a pure, typed unit: ``run(input, llm) -> AgentRun[output]``. Agents never touch the
database — the orchestrator builds their inputs and persists their outputs — which keeps execution
boundaries explicit and makes parallel execution safe.

After the model responds, every agent applies ``post_validate``: references to claims, passages or
entities that weren't in the input are removed and reported, so a model can't cite evidence it was
never shown.
"""

import json
import re
from dataclasses import dataclass, field
from typing import ClassVar, Generic, TypeVar

from pydantic import BaseModel

from app.intelligence import contracts as c
from app.intelligence.llm import StructuredLLM, StructuredResult
from app.models.enums import AgentRole

In = TypeVar("In", bound=BaseModel)
Out = TypeVar("Out", bound=BaseModel)

_WS = re.compile(r"\s+")


def normalise_ws(text: str) -> str:
    return _WS.sub(" ", text).strip()


@dataclass
class AgentRun(Generic[Out]):
    output: Out
    result: StructuredResult | None  # None when the agent resolved its task without a model call
    notes: list[str] = field(default_factory=list)  # integrity corrections applied after validation


class Agent(Generic[In, Out]):
    role: ClassVar[AgentRole]
    title: ClassVar[str]
    responsibility: ClassVar[str]
    input_type: ClassVar[type[BaseModel]]
    output_type: ClassVar[type[BaseModel]]
    system: ClassVar[str]
    effort: ClassVar[str] = "medium"
    max_tokens: ClassVar[int] = 16000

    def prompt(self, payload: In) -> str:
        return (
            "Work only from the material below. Respond with JSON matching the required schema.\n\n"
            f"<input>\n{json.dumps(payload.model_dump(), ensure_ascii=False, indent=1)}\n</input>"
        )

    def post_validate(self, payload: In, output: Out) -> tuple[Out, list[str]]:
        return output, []

    def run(self, payload: In, llm: StructuredLLM) -> AgentRun[Out]:
        result = llm.generate(
            agent=self.role.value,
            system=self.system,
            prompt=self.prompt(payload),
            output_type=self.output_type,
            payload=payload,
            max_tokens=self.max_tokens,
            effort=self.effort,
        )
        output, notes = self.post_validate(payload, result.output)  # type: ignore[arg-type]
        return AgentRun(output=output, result=result, notes=notes)


EVIDENCE_RULES = (
    "Evidence rules: every claim must be grounded in the provided passages. Quotes must be copied verbatim "
    "from a passage (no paraphrasing, no ellipses). Mark a claim 'explicit' only when the quote states it "
    "directly; mark it 'inferred' when it is your inference from the quote. Never introduce facts that are "
    "not in the passages. If the material doesn't address the question, say so and return no claims."
)


class OrchestratorAgent(Agent[c.OrchestratorInput, c.OrchestratorOutput]):
    role = AgentRole.orchestrator
    title = "Orchestrator"
    responsibility = "Understands the research objective, decomposes it into sub-questions and defines what evidence is needed."
    input_type = c.OrchestratorInput
    output_type = c.OrchestratorOutput
    effort = "high"
    system = (
        "You are the Orchestrator of ASTRION, a research intelligence system. Restate the user's research objective "
        "precisely, then decompose it into 2-6 focused sub-questions (ids Q1, Q2 …) that together answer it. List the "
        "key terms to look for and the kinds of evidence that would settle each sub-question. Give an honest initial "
        "assessment of whether the listed documents are likely to contain that evidence. Do not answer the question."
    )

    def post_validate(self, payload, output):
        notes = []
        seen, subs = set(), []
        for i, sq in enumerate(output.sub_questions[:6], start=1):
            sid = sq.id if re.fullmatch(r"Q\d+", sq.id) and sq.id not in seen else f"Q{i}"
            seen.add(sid)
            subs.append(sq.model_copy(update={"id": sid}))
        if len(output.sub_questions) > 6:
            notes.append(f"Truncated {len(output.sub_questions) - 6} extra sub-questions.")
        if not subs:
            subs = [c.SubQuestion(id="Q1", question=payload.question, rationale="The objective itself (no decomposition returned).")]
            notes.append("No sub-questions returned; using the objective as the only sub-question.")
        return output.model_copy(update={"sub_questions": subs}), notes


class ResearchAgent(Agent[c.ResearchInput, c.ResearchOutput]):
    role = AgentRole.research
    title = "Research"
    responsibility = "Reads document passages and extracts entities, claims and relationships, each tied to verbatim evidence."
    input_type = c.ResearchInput
    output_type = c.ResearchOutput
    system = (
        "You are the Research Agent of ASTRION. Read the passages of one document and extract what is relevant to the "
        "research question and its sub-questions: entities (people, organisations, concepts, metrics, places, events …), "
        "claims the document makes, and relationships between entities that a claim asserts. Use local refs E1… for "
        "entities and R1… for claims. Each claim cites one or more passages with verbatim quotes. Relationships must "
        "use one of the allowed predicates and cite the claims that assert them. " + EVIDENCE_RULES
    )

    def post_validate(self, payload, output):
        """Drops evidence whose quote isn't verbatim in the cited passage, then claims left without evidence."""
        notes: list[str] = []
        passages = {p.ref: normalise_ws(p.text) for p in payload.passages}
        entity_refs = {e.ref for e in output.entities}
        claims = []
        for claim in output.claims:
            good = []
            for ev in claim.evidence:
                quote = normalise_ws(ev.quote).strip("\"'“”")
                text = passages.get(ev.passage_ref)
                if text is None:
                    notes.append(f"{claim.ref}: cited unknown passage {ev.passage_ref}; evidence dropped.")
                elif len(quote) < 8 or quote not in text:
                    notes.append(f"{claim.ref}: quote not found verbatim in {ev.passage_ref}; evidence dropped.")
                else:
                    good.append(ev.model_copy(update={"quote": quote}))
            if not good:
                notes.append(f"{claim.ref}: rejected (no verifiable evidence).")
                continue
            subject = claim.subject_entity_ref if claim.subject_entity_ref in entity_refs else None
            claims.append(claim.model_copy(update={"evidence": good, "subject_entity_ref": subject}))
        claim_refs = {cl.ref for cl in claims}
        rels = []
        for rel in output.relationships:
            cited = [r for r in rel.claim_refs if r in claim_refs]
            if rel.source_entity_ref not in entity_refs or rel.target_entity_ref not in entity_refs or rel.source_entity_ref == rel.target_entity_ref:
                notes.append(f"Relationship {rel.source_entity_ref}->{rel.target_entity_ref} dropped (unknown or identical entities).")
            elif not cited:
                notes.append(f"Relationship {rel.source_entity_ref}->{rel.target_entity_ref} dropped (no supporting claim).")
            else:
                rels.append(rel.model_copy(update={"claim_refs": cited}))
        # Only keep entities that a surviving claim or relationship actually uses: no orphan nodes.
        used = {cl.subject_entity_ref for cl in claims if cl.subject_entity_ref} | {r.source_entity_ref for r in rels} | {r.target_entity_ref for r in rels}
        entities = [e for e in output.entities if e.ref in used]
        if len(entities) < len(output.entities):
            notes.append(f"Dropped {len(output.entities) - len(entities)} entities not referenced by any evidenced claim.")
        return output.model_copy(update={"claims": claims, "relationships": rels, "entities": entities}), notes


class KnowledgeAgent(Agent[c.KnowledgeInput, c.KnowledgeOutput]):
    role = AgentRole.knowledge
    title = "Knowledge"
    responsibility = "Resolves ambiguous duplicate entities before new knowledge is merged into the persistent graph."
    input_type = c.KnowledgeInput
    output_type = c.KnowledgeOutput
    effort = "low"
    system = (
        "You are the Knowledge Agent of ASTRION. For each pair, decide whether the new entity and the existing entity "
        "refer to the same real-world thing. Merge only when you are confident; different granularity (e.g. 'reef' vs "
        "'coral bleaching') or different instances are NOT the same entity. Explain each decision briefly."
    )

    def post_validate(self, payload, output):
        valid = {p.pair_id for p in payload.pairs}
        kept = [d for d in output.decisions if d.pair_id in valid]
        notes = [f"Ignored decision for unknown pair {d.pair_id}." for d in output.decisions if d.pair_id not in valid]
        missing = valid - {d.pair_id for d in kept}
        notes += [f"No decision for {p}; treated as different entities." for p in sorted(missing)]
        return output.model_copy(update={"decisions": kept}), notes


def _filter_refs(refs: list[str], valid: set[str], label: str, notes: list[str]) -> list[str]:
    out = []
    for r in refs:
        if r in valid and r not in out:
            out.append(r)
        elif r not in valid:
            notes.append(f"{label}: unknown reference {r} removed.")
    return out


class HypothesisAgent(Agent[c.HypothesisInput, c.HypothesisOutput]):
    role = AgentRole.hypothesis
    title = "Hypothesis"
    responsibility = "Identifies patterns across evidence and proposes testable hypotheses with supporting and opposing claims."
    input_type = c.HypothesisInput
    output_type = c.HypothesisOutput
    effort = "high"
    system = (
        "You are the Hypothesis Agent of ASTRION. Look for patterns across the claims (which come from different "
        "documents) and propose up to 5 testable hypotheses that would help answer the research question. A hypothesis "
        "is a proposal, not a fact: phrase it conditionally, explain the reasoning, cite the claim refs (C…) that support "
        "it and any that cut against it, state assumptions, and describe a concrete way to test it. Do not restate a "
        "single claim as a hypothesis. If the evidence is too thin to propose anything meaningful, return none."
    )

    def post_validate(self, payload, output):
        notes: list[str] = []
        valid = {cl.ref for cl in payload.claims}
        kept = []
        for i, h in enumerate(output.hypotheses[:5], start=1):
            sup = _filter_refs(h.supporting_claim_refs, valid, f"Hypothesis {i}", notes)
            opp = [r for r in _filter_refs(h.opposing_claim_refs, valid, f"Hypothesis {i}", notes) if r not in sup]
            if not sup:
                notes.append(f"Hypothesis {i} rejected: no valid supporting claims.")
                continue
            kept.append(h.model_copy(update={"supporting_claim_refs": sup, "opposing_claim_refs": opp}))
        return output.model_copy(update={"hypotheses": kept}), notes


class ContradictionAgent(Agent[c.ContradictionInput, c.ContradictionOutput]):
    role = AgentRole.contradiction
    title = "Contradiction"
    responsibility = "Compares claims across sources to find genuine, temporal and merely contextual conflicts."
    input_type = c.ContradictionInput
    output_type = c.ContradictionOutput
    system = (
        "You are the Contradiction Agent of ASTRION. Compare the claims and report pairs that conflict. Classify each "
        "as 'direct' (incompatible statements about the same thing), 'temporal' (the conflict involves different times; "
        "use temporal_scope), or 'contextual' (they look opposed but describe different conditions, scope or "
        "populations). Set is_genuine=false when the conflict is only apparent. Explain using the quotes. Report only "
        "real tensions; do not pair unrelated claims."
    )

    def post_validate(self, payload, output):
        notes: list[str] = []
        valid = {cl.ref for cl in payload.claims}
        seen, kept = set(), []
        for x in output.contradictions:
            pair = tuple(sorted((x.claim_a_ref, x.claim_b_ref)))
            if x.claim_a_ref not in valid or x.claim_b_ref not in valid:
                notes.append(f"Contradiction {x.claim_a_ref}/{x.claim_b_ref} dropped: unknown claim.")
            elif x.claim_a_ref == x.claim_b_ref or pair in seen:
                notes.append(f"Contradiction {x.claim_a_ref}/{x.claim_b_ref} dropped: duplicate or self-pair.")
            else:
                seen.add(pair)
                kept.append(x)
        return output.model_copy(update={"contradictions": kept}), notes


class VerificationAgent(Agent[c.VerificationInput, c.VerificationOutput]):
    role = AgentRole.verification
    title = "Verification"
    responsibility = "Independently challenges hypotheses and contradictions against the quoted evidence and flags gaps."
    input_type = c.VerificationInput
    output_type = c.VerificationOutput
    effort = "high"
    system = (
        "You are the Verification Agent of ASTRION, an independent and skeptical reviewer. You did not write these "
        "hypotheses. For each hypothesis (H…) and contradiction (X…) decide whether the quoted evidence actually "
        "supports it: 'supported', 'partially_supported', 'unsupported', 'insufficient_evidence', or 'contradicted' "
        "(evidence points the other way). Check that each cited claim is relevant and that inferred claims are not "
        "treated as facts. List concrete issues, the evidence that is missing, and any cited claim refs that do not "
        "support the conclusion. Review every item."
    )

    def post_validate(self, payload, output):
        notes: list[str] = []
        targets = {h.ref for h in payload.hypotheses} | {x.ref for x in payload.contradictions}
        claims = {cl.ref for h in payload.hypotheses for cl in [*h.supporting, *h.opposing]} | {
            cl.ref for x in payload.contradictions for cl in (x.claim_a, x.claim_b)
        }
        kept, seen = [], set()
        for r in output.reviews:
            if r.target_ref not in targets or r.target_ref in seen:
                notes.append(f"Review for {r.target_ref} ignored (unknown or duplicate target).")
                continue
            seen.add(r.target_ref)
            kept.append(r.model_copy(update={"unsupported_claim_refs": [x for x in r.unsupported_claim_refs if x in claims]}))
        for missing in sorted(targets - seen):
            notes.append(f"No review returned for {missing}; recorded as insufficient_evidence.")
            kept.append(
                c.Review(
                    target_ref=missing,
                    verdict="insufficient_evidence",
                    reasoning="The verifier did not return a review for this item.",
                    issues=["not reviewed"],
                    missing_evidence=[],
                    unsupported_claim_refs=[],
                )
            )
        return output.model_copy(update={"reviews": kept}), notes


class SynthesisAgent(Agent[c.SynthesisInput, c.SynthesisOutput]):
    role = AgentRole.synthesis
    title = "Synthesis"
    responsibility = "Combines verified findings into a structured report with citations, uncertainty and open questions."
    input_type = c.SynthesisInput
    output_type = c.SynthesisOutput
    effort = "high"
    system = (
        "You are the Synthesis Agent of ASTRION. Write the final intelligence report for the research question using "
        "only the claims, verified hypotheses and contradictions provided. Every key finding must cite claim refs (C…). "
        "Weigh verification verdicts: do not present unsupported or insufficient-evidence hypotheses as conclusions. "
        "Discuss each hypothesis (H…) and contradiction (X…). State plainly what remains unresolved and the limits of "
        "the evidence. If the evidence cannot answer the question, set answer_status to 'insufficient_evidence' and "
        "say so — do not fill gaps with outside knowledge."
    )

    def post_validate(self, payload, output):
        notes: list[str] = []
        valid = {cl.ref for cl in payload.claims}
        findings = []
        for i, f in enumerate(output.key_findings, start=1):
            refs = _filter_refs(f.claim_refs, valid, f"Finding {i}", notes)
            if not refs:
                notes.append(f"Finding {i} removed: it cited no valid claims.")
                continue
            findings.append(f.model_copy(update={"claim_refs": refs}))
        h_refs, x_refs = {h.ref for h in payload.hypotheses}, {x.ref for x in payload.contradictions}
        hyps = [a for a in output.hypotheses if a.ref in h_refs]
        cons = [a for a in output.contradictions if a.ref in x_refs]
        status = output.answer_status
        if not findings and status != "insufficient_evidence":
            notes.append("No cited findings survived validation; answer_status set to insufficient_evidence.")
            status = "insufficient_evidence"
        return output.model_copy(update={"key_findings": findings, "hypotheses": hyps, "contradictions": cons, "answer_status": status}), notes


AGENTS: dict[AgentRole, Agent] = {
    a.role: a for a in (OrchestratorAgent(), ResearchAgent(), KnowledgeAgent(), HypothesisAgent(), ContradictionAgent(), VerificationAgent(), SynthesisAgent())
}
