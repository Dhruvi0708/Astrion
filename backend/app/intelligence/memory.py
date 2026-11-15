"""Persistent intelligence memory: what the workspace already knows that is relevant to a new question.

Recall is deterministic (BM25 over stored claims, hypotheses and entity names) and recorded as its own
step, so every reused fact is traceable to the claim, hypothesis or report it came from. Nothing is
summarised by a model here: the agents receive the stored statements themselves.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.intelligence.retrieval import BM25
from app.models import (
    Claim,
    Contradiction,
    Document,
    GraphEntity,
    Hypothesis,
    Investigation,
    InvestigationReport,
    VerificationResult,
)
from app.models.enums import VerificationStatus
from app.models.knowledge import InvestigationClaim

SCAN_LIMIT = 5000  # most recent claims considered per recall


@dataclass
class MemoryBrief:
    claim_ids: list[uuid.UUID] = field(default_factory=list)
    hypothesis_ids: list[uuid.UUID] = field(default_factory=list)
    contradiction_ids: list[uuid.UUID] = field(default_factory=list)
    investigation_ids: list[uuid.UUID] = field(default_factory=list)
    entity_ids: list[uuid.UUID] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)
    scores: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "claim_ids": [str(x) for x in self.claim_ids],
            "hypothesis_ids": [str(x) for x in self.hypothesis_ids],
            "contradiction_ids": [str(x) for x in self.contradiction_ids],
            "investigation_ids": [str(x) for x in self.investigation_ids],
            "entity_ids": [str(x) for x in self.entity_ids],
            "lines": self.lines,
            "scores": self.scores,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MemoryBrief":
        u = lambda xs: [uuid.UUID(x) for x in xs]  # noqa: E731
        return cls(
            u(d.get("claim_ids", [])),
            u(d.get("hypothesis_ids", [])),
            u(d.get("contradiction_ids", [])),
            u(d.get("investigation_ids", [])),
            u(d.get("entity_ids", [])),
            d.get("lines", []),
            d.get("scores", {}),
        )


def recall(db: Session, inv: Investigation, query: str, claim_limit: int = 20, hypothesis_limit: int = 8) -> MemoryBrief:
    brief = MemoryBrief()
    own = set(db.scalars(select(InvestigationClaim.claim_id).where(InvestigationClaim.investigation_id == inv.id)))

    # Claims from earlier work in this workspace.
    claims = [
        c
        for c in db.scalars(
            select(Claim).where(Claim.workspace_id == inv.workspace_id).order_by(Claim.created_at.desc(), Claim.normalized_statement).limit(SCAN_LIMIT)
        )
        if c.id not in own
    ]
    if claims:
        for hit in BM25([c.statement for c in claims]).search(query, limit=claim_limit, min_matched=2):
            c = claims[hit.index]
            brief.claim_ids.append(c.id)
            brief.scores[f"claim:{c.id}"] = hit.score
            doc = db.get(Document, c.document_id)
            superseded = " (superseded by a newer claim)" if c.superseded_by_id else ""
            brief.lines.append(f"Known claim from '{doc.title if doc else '?'}'{superseded}: {c.statement}")

    # Entities already in the graph that the question names.
    entities = list(db.scalars(select(GraphEntity).where(GraphEntity.workspace_id == inv.workspace_id, GraphEntity.merged_into_id.is_(None)).limit(SCAN_LIMIT)))
    if entities:
        for hit in BM25([f"{e.name} {' '.join(e.aliases or [])}" for e in entities]).search(query, limit=15, min_matched=1):
            e = entities[hit.index]
            brief.entity_ids.append(e.id)
            brief.lines.append(f"Known entity: {e.name} ({e.entity_type}), {e.mention_count} mention(s)")

    # Hypotheses from other investigations that are still open (not refuted).
    hyps = list(
        db.scalars(
            select(Hypothesis).where(
                Hypothesis.workspace_id == inv.workspace_id,
                Hypothesis.investigation_id != inv.id,
                Hypothesis.status != VerificationStatus.refuted,
            )
        )
    )
    if hyps:
        for hit in BM25([h.statement for h in hyps]).search(query, limit=hypothesis_limit, min_matched=2):
            h = hyps[hit.index]
            brief.hypothesis_ids.append(h.id)
            conf = f"{h.confidence:.2f}" if h.confidence is not None else "n/a"
            brief.lines.append(f"Open hypothesis ({h.status.value}, confidence {conf}, consensus {h.consensus or 'n/a'}): {h.statement}")

    # Unresolved genuine contradictions that involve recalled claims.
    if brief.claim_ids:
        for x in db.scalars(
            select(Contradiction).where(
                Contradiction.workspace_id == inv.workspace_id,
                Contradiction.is_genuine.is_(True),
                Contradiction.resolution_kind.is_(None),
                (Contradiction.claim_a_id.in_(brief.claim_ids)) | (Contradiction.claim_b_id.in_(brief.claim_ids)),
            )
        ):
            verdict = db.scalar(select(VerificationResult.verdict).where(VerificationResult.target_id == x.id))
            brief.contradiction_ids.append(x.id)
            a, b = db.get(Claim, x.claim_a_id), db.get(Claim, x.claim_b_id)
            brief.lines.append(f"Unresolved contradiction ({x.kind.value}, verdict {verdict.value if verdict else 'none'}): '{a.statement}' vs '{b.statement}'")

    # Outcomes of previous investigations that touched the recalled knowledge.
    related = set(db.scalars(select(InvestigationClaim.investigation_id).where(InvestigationClaim.claim_id.in_(brief.claim_ids)))) if brief.claim_ids else set()
    related |= {h.investigation_id for h in hyps if h.id in brief.hypothesis_ids}
    related.discard(inv.id)
    for inv_id in sorted(related, key=str)[:5]:
        report = db.scalar(select(InvestigationReport).where(InvestigationReport.investigation_id == inv_id).order_by(InvestigationReport.run_number.desc()))
        other = db.get(Investigation, inv_id)
        if report and other:
            brief.investigation_ids.append(inv_id)
            c = report.content or {}
            brief.lines.append(f"Previous investigation '{other.title}' ({c.get('answer_status', 'unknown')}): {str(c.get('executive_summary', ''))[:300]}")
    return brief
