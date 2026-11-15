"""Active learning: which next step is worth the most, and why.

Two uses:
* during a run, `exploration_candidates` proposes targeted research actions (unread passages that
  address under-covered sub-questions, open contradictions or missing relationships). The Planner
  agent chooses among them; the code decides when exploration must stop (coverage, budget, limits).
* after a run, `recommendations` tells the user what would most improve the investigation.

Every candidate carries its factor scores and a plain-language explanation. Scores are a documented
weighted sum, not a model's opinion.
"""

import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.intelligence.retrieval import BM25, tokens
from app.models import Claim, Contradiction, DocumentChunk, GraphEntity, GraphRelationship, Hypothesis, Investigation, InvestigationReport
from app.models.enums import ClaimKind
from app.models.knowledge import InvestigationClaim

METHOD = "astrion-active-v1"
WEIGHTS = {"uncertainty": 0.3, "relevance": 0.25, "information_gain": 0.25, "evidence_quality": 0.1, "contradiction": 0.1}
FACTOR_TEXT = {
    "uncertainty": "little evidence so far",
    "relevance": "closely matches the question",
    "information_gain": "likely to add new facts",
    "evidence_quality": "existing evidence is weak (inferred or single-source)",
    "contradiction": "could resolve a conflict",
}
MIN_SCORE = 0.2


@dataclass
class Candidate:
    id: str
    kind: str  # research_subquestion | resolve_contradiction | find_relationship
    target: str
    chunk_ids: list[str]
    factors: dict[str, float]
    score: float = 0.0
    explanation: str = ""
    sub_question_id: str | None = None
    meta: dict = field(default_factory=dict)

    def finalize(self) -> "Candidate":
        self.factors = {k: round(max(0.0, min(1.0, v)), 3) for k, v in self.factors.items()}
        self.score = round(sum(WEIGHTS[k] * v for k, v in self.factors.items() if k in WEIGHTS), 3)
        top = sorted(((v, k) for k, v in self.factors.items() if k in WEIGHTS and v >= 0.4), reverse=True)[:3]
        why = ", ".join(FACTOR_TEXT[k] for _, k in top) or "low expected value"
        self.explanation = f"{self.target} — selected because: {why} (score {self.score})."
        return self

    def as_dict(self) -> dict:
        return asdict(self)


def coverage(db: Session, inv: Investigation, sub_questions: list[dict]) -> list[dict]:
    rows = db.execute(
        select(InvestigationClaim.sub_question_ids, Claim.kind, Claim.document_id)
        .join(Claim, Claim.id == InvestigationClaim.claim_id)
        .where(InvestigationClaim.investigation_id == inv.id)
    ).all()
    out = []
    for q in sub_questions:
        mine = [r for r in rows if q["id"] in (r[0] or [])]
        out.append(
            {
                "sub_question_id": q["id"],
                "question": q["question"],
                "claims": len(mine),
                "explicit": sum(1 for r in mine if r[1] == ClaimKind.explicit),
                "documents": len({r[2] for r in mine}),
            }
        )
    return out


def _novelty(text: str, known: set[str]) -> float:
    t = set(tokens(text))
    return len(t - known) / len(t) if t else 0.0


def exploration_candidates(
    db: Session,
    inv: Investigation,
    sub_questions: list[dict],
    key_terms: list[str],
    chunks: list[DocumentChunk],
    read: set[str],
    chars_per_action: int,
    memory_contradiction_ids: list[uuid.UUID] | None = None,
) -> tuple[list[Candidate], list[dict]]:
    cov = coverage(db, inv, sub_questions)
    unread = [c for c in chunks if str(c.id) not in read]
    if not unread:
        return [], cov
    bm = BM25([c.text for c in unread])
    known = set()
    for st in db.scalars(
        select(Claim.statement).join(InvestigationClaim, InvestigationClaim.claim_id == Claim.id).where(InvestigationClaim.investigation_id == inv.id)
    ):
        known |= set(tokens(st))
    raw: list[Candidate] = []

    def take(hits) -> tuple[list[str], float, float]:  # noqa: ANN001
        ids, size, best, nov = [], 0, 0.0, []
        for h in hits:
            ch = unread[h.index]
            if size + len(ch.text) > chars_per_action and ids:
                break
            ids.append(str(ch.id))
            size += len(ch.text)
            best = max(best, h.score)
            nov.append(_novelty(ch.text, known))
        return ids, best, (sum(nov) / len(nov) if nov else 0.0)

    all_scores = [h.score for h in bm.search(" ".join([inv.question, *key_terms]))] or [1.0]
    scale = max(all_scores) or 1.0
    for q in cov:
        hits = bm.search(f"{q['question']} {' '.join(key_terms)}", min_score=0.5)
        if not hits:
            continue
        ids, best, novelty = take(hits)
        uncertainty = 1 / (1 + q["claims"])
        weak = 1 - (q["explicit"] / q["claims"] if q["claims"] else 0) * (1 if q["documents"] > 1 else 0.5)
        raw.append(
            Candidate(
                id="",
                kind="research_subquestion",
                target=f"{q['sub_question_id']}: {q['question']}",
                chunk_ids=ids,
                sub_question_id=q["sub_question_id"],
                factors={
                    "uncertainty": uncertainty,
                    "relevance": best / scale,
                    "information_gain": uncertainty * novelty,
                    "evidence_quality": weak,
                    "contradiction": 0.0,
                },
                meta={"claims_so_far": q["claims"], "novelty": round(novelty, 3)},
            )
        )
    for xid in memory_contradiction_ids or []:
        x = db.get(Contradiction, xid)
        if not x:
            continue
        a, b = db.get(Claim, x.claim_a_id), db.get(Claim, x.claim_b_id)
        hits = bm.search(f"{a.statement} {b.statement}", min_score=0.5)
        if hits:
            ids, best, novelty = take(hits)
            raw.append(
                Candidate(
                    id="",
                    kind="resolve_contradiction",
                    target=f"Resolve: '{a.statement[:80]}' vs '{b.statement[:80]}'",
                    chunk_ids=ids,
                    factors={"uncertainty": 0.7, "relevance": best / scale, "information_gain": novelty, "evidence_quality": 0.5, "contradiction": 1.0},
                    meta={"contradiction_id": str(xid)},
                )
            )
    for pair, names in _unlinked_pairs(db, inv)[:5]:
        hits = [h for h in bm.search(" ".join(names), min_score=0.5) if len(h.matched) >= 2]
        if hits:
            ids, best, novelty = take(hits)
            raw.append(
                Candidate(
                    id="",
                    kind="find_relationship",
                    target=f"How are '{names[0]}' and '{names[1]}' related?",
                    chunk_ids=ids,
                    factors={"uncertainty": 0.6, "relevance": best / scale, "information_gain": novelty, "evidence_quality": 0.4, "contradiction": 0.0},
                    meta={"entity_ids": [str(p) for p in pair]},
                )
            )
    out = sorted((c.finalize() for c in raw), key=lambda c: (-c.score, c.target))
    out = [c for c in out if c.score >= MIN_SCORE]
    for i, c in enumerate(out, start=1):
        c.id = f"A{i}"
    return out, cov


def _unlinked_pairs(db: Session, inv: Investigation) -> list[tuple[tuple[uuid.UUID, uuid.UUID], tuple[str, str]]]:
    """Entities this investigation found in the same document that have no relationship yet."""
    rows = db.execute(
        select(Claim.subject_entity_id, Claim.document_id)
        .join(InvestigationClaim, InvestigationClaim.claim_id == Claim.id)
        .where(InvestigationClaim.investigation_id == inv.id, Claim.subject_entity_id.is_not(None))
    ).all()
    per_doc: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for ent, doc in rows:
        per_doc[doc].add(ent)
    linked = {
        frozenset((r.source_entity_id, r.target_entity_id))
        for r in db.scalars(select(GraphRelationship).where(GraphRelationship.workspace_id == inv.workspace_id))
    }
    out, seen = [], set()
    for ents in per_doc.values():
        ordered = sorted(ents, key=str)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1 :]:
                key = frozenset((a, b))
                if key in linked or key in seen:
                    continue
                seen.add(key)
                ea, eb = db.get(GraphEntity, a), db.get(GraphEntity, b)
                out.append(((a, b), (ea.name, eb.name)))
    return out


def sufficiency(cov: list[dict], candidates: list[Candidate], min_claims: int) -> tuple[bool, str]:
    weak = [q for q in cov if q["claims"] < min_claims]
    if not candidates:
        if weak:
            return True, f"No unread passage addresses {', '.join(q['sub_question_id'] for q in weak)}; more evidence needs new documents."
        return True, "Every sub-question has evidence and no unread passage adds value."
    if not weak and candidates[0].score < 0.35:
        return True, f"Every sub-question has at least {min_claims} claims; the best remaining action scores only {candidates[0].score}."
    return False, f"{len(weak)} sub-question(s) under-covered; best action {candidates[0].id} scores {candidates[0].score}."


def recommendations(db: Session, inv: Investigation, run_number: int) -> list[dict]:
    """What would most improve this investigation, computed from its recorded state after a run."""
    recs: list[dict] = []
    sub_questions = (inv.plan or {}).get("sub_questions", [])
    for q in coverage(db, inv, sub_questions):
        if q["claims"] < 2:
            u = 1 / (1 + q["claims"])
            recs.append(
                _rec(
                    "add_evidence",
                    f"Find sources that address {q['sub_question_id']}: {q['question']}",
                    {"uncertainty": u, "relevance": 1.0, "information_gain": u},
                )
            )
    claim_rows = list(
        db.scalars(select(Claim).join(InvestigationClaim, InvestigationClaim.claim_id == Claim.id).where(InvestigationClaim.investigation_id == inv.id))
    )
    from app.intelligence.source_intel import claim_corroboration

    report = db.scalar(select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id, InvestigationReport.run_number == run_number))
    cited = {v.get("claim_id") for v in ((report.content or {}).get("citations", {}) if report else {}).values()}
    corr = claim_corroboration(db, inv.workspace_id, [c for c in claim_rows if str(c.id) in cited])
    for c in claim_rows:
        if str(c.id) in cited and corr.get(c.id, 1) < 2:
            quality = 0.5 if c.kind == ClaimKind.explicit else 0.8
            recs.append(
                _rec(
                    "corroborate",
                    f"Corroborate a single-source claim used in the report: '{c.statement[:140]}'",
                    {"uncertainty": 0.6, "relevance": 0.8, "evidence_quality": quality},
                    claim_id=str(c.id),
                )
            )
        if c.superseded_by_id:
            recs.append(
                _rec(
                    "refresh",
                    f"A newer claim supersedes: '{c.statement[:140]}'",
                    {"relevance": 0.7, "evidence_quality": 0.9, "information_gain": 0.5},
                    claim_id=str(c.id),
                )
            )
    for x in db.scalars(
        select(Contradiction).where(Contradiction.investigation_id == inv.id, Contradiction.is_genuine.is_(True), Contradiction.resolution_kind.is_(None))
    ):
        a = db.get(Claim, x.claim_a_id)
        recs.append(
            _rec(
                "resolve_contradiction",
                f"Resolve the {x.kind.value} conflict around '{a.statement[:120]}'",
                {"contradiction": 1.0, "uncertainty": 0.7, "relevance": 0.8},
                contradiction_id=str(x.id),
            )
        )
    for h in db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == inv.id)):
        conf = h.confidence or 0.0
        if h.consensus in ("contested", "insufficient") or 0.25 <= conf <= 0.65:
            test = (h.falsification_conditions or ["(no falsification condition stated)"])[0]
            recs.append(
                _rec(
                    "test_hypothesis",
                    f"Test '{h.statement[:120]}' — check: {test}",
                    {"uncertainty": 1 - abs(conf - 0.5) * 2, "relevance": 0.8, "information_gain": 0.7},
                    hypothesis_id=str(h.id),
                )
            )
    for _, names in _unlinked_pairs(db, inv)[:5]:
        recs.append(
            _rec(
                "find_relationship",
                f"Establish how '{names[0]}' relates to '{names[1]}' (mentioned together, no relationship recorded)",
                {"uncertainty": 0.6, "information_gain": 0.6, "relevance": 0.5},
            )
        )
    recs.sort(key=lambda r: (-r["score"], r["target"]))
    return recs[:15]


def _rec(kind: str, target: str, factors: dict[str, float], **meta: str) -> dict:
    c = Candidate(id="", kind=kind, target=target, chunk_ids=[], factors={**dict.fromkeys(WEIGHTS, 0.0), **factors}, meta=meta).finalize()
    return {"kind": c.kind, "target": c.target, "score": c.score, "factors": c.factors, "explanation": c.explanation, "method": METHOD, **c.meta}
