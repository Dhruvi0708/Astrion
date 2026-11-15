"""Temporal intelligence: when a claim holds, which claims are outdated, and when an apparent
contradiction is really two statements about different periods.

Everything here is rule-based and explainable. Periods are year-resolution; a claim without dates
falls back to its source's publication year as an "as of" anchor (recorded as such).
"""

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.intelligence.retrieval import tokens
from app.models import Claim, Document, GraphChange, Source
from app.models.enums import GraphChangeType

_Y = r"(1[89]\d\d|20\d\d)"
RANGE = re.compile(rf"\b{_Y}\s*(?:-|–|—|to|through|until|and)\s*{_Y}\b", re.I)
SINCE = re.compile(rf"\b(?:since|from|after|starting(?: in)?)\s+{_Y}\b", re.I)
UNTIL = re.compile(rf"\b(?:until|before|by|through)\s+{_Y}\b", re.I)
YEAR = re.compile(rf"\b{_Y}\b")
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


@dataclass(frozen=True)
class Period:
    start: int | None
    end: int | None

    def overlaps(self, other: "Period") -> bool:
        a0, a1 = self.start or -10_000, self.end or 10_000
        b0, b1 = other.start or -10_000, other.end or 10_000
        return a0 <= b1 and b0 <= a1

    def label(self) -> str:
        if self.start and self.end and self.start != self.end:
            return f"{self.start}–{self.end}"
        if self.start and self.end:
            return str(self.start)
        if self.start:
            return f"since {self.start}"
        if self.end:
            return f"until {self.end}"
        return "undated"


def parse_period(*texts: str | None) -> Period | None:
    text = " ".join(t for t in texts if t)
    if m := RANGE.search(text):
        a, b = sorted((int(m.group(1)), int(m.group(2))))
        return Period(a, b)
    if m := SINCE.search(text):
        return Period(int(m.group(1)), None)
    if m := UNTIL.search(text):
        return Period(None, int(m.group(1)))
    years = sorted({int(y) for y in YEAR.findall(text)})
    if years:
        return Period(years[0], years[-1])
    return None


def claim_period(claim: Claim) -> Period | None:
    if claim.valid_from_year or claim.valid_to_year:
        return Period(claim.valid_from_year, claim.valid_to_year)
    return None


def annotate(db: Session, claims: list[Claim]) -> int:
    """Fills valid_from_year/valid_to_year from the claim's temporal scope or statement."""
    changed = 0
    for cl in claims:
        if cl.valid_from_year or cl.valid_to_year:
            continue
        p = parse_period(cl.temporal_scope, cl.statement)
        if p:
            cl.valid_from_year, cl.valid_to_year = p.start, p.end
            changed += 1
    db.flush()
    return changed


def _anchor(db: Session, claim: Claim) -> tuple[int | None, str]:
    """The year a claim speaks for: its latest stated year, else its source's publication year."""
    if claim.valid_to_year or claim.valid_from_year:
        return (claim.valid_to_year or claim.valid_from_year), "stated"
    doc = db.get(Document, claim.document_id)
    src = db.get(Source, doc.source_id) if doc else None
    if src and src.published_on:
        return src.published_on.year, "source published"
    return None, "unknown"


def _figures(statement: str) -> list[str]:
    """Numbers in a statement other than years: the values that can change between reports."""
    years = set(YEAR.findall(statement))
    return [n for n in NUMBER.findall(statement) if n not in years]


def _skeleton(statement: str) -> set[str]:
    """The statement's words without numbers or years: two claims with the same skeleton but different
    figures describe the same attribute at different values."""
    return set(tokens(NUMBER.sub(" ", statement)))


def detect_superseded(db: Session, workspace_id: uuid.UUID, investigation_id: uuid.UUID, claim_ids: list[uuid.UUID]) -> list[dict]:
    """Marks older claims superseded by newer claims about the same subject and attribute."""
    if not claim_ids:
        return []
    mine = list(db.scalars(select(Claim).where(Claim.id.in_(claim_ids), Claim.subject_entity_id.is_not(None))))
    subjects = {c.subject_entity_id for c in mine}
    if not subjects:
        return []
    pool = list(db.scalars(select(Claim).where(Claim.workspace_id == workspace_id, Claim.subject_entity_id.in_(subjects))))
    by_subject: dict[uuid.UUID, list[Claim]] = {}
    for c in pool:
        by_subject.setdefault(c.subject_entity_id, []).append(c)
    events = []
    for claims in by_subject.values():
        for i, a in enumerate(claims):
            for b in claims[i + 1 :]:
                if a.document_id == b.document_id and a.normalized_statement == b.normalized_statement:
                    continue
                sa, sb = _skeleton(a.statement), _skeleton(b.statement)
                if not sa or not sb or len(sa & sb) / len(sa | sb) < 0.6:
                    continue
                if _figures(a.statement) == _figures(b.statement):
                    continue  # same figures (years aside): corroboration, not an update
                ya, how_a = _anchor(db, a)
                yb, how_b = _anchor(db, b)
                if ya is None or yb is None or ya == yb:
                    continue
                old, new = (a, b) if ya < yb else (b, a)
                if old.superseded_by_id == new.id:
                    continue
                old.superseded_by_id = new.id
                event = {
                    "superseded_claim_id": str(old.id),
                    "by_claim_id": str(new.id),
                    "old_year": min(ya, yb),
                    "new_year": max(ya, yb),
                    "basis": f"{how_a if old is a else how_b} vs {how_b if new is b else how_a}",
                    "old": old.statement[:200],
                    "new": new.statement[:200],
                }
                events.append(event)
                db.add(
                    GraphChange(
                        workspace_id=workspace_id,
                        investigation_id=investigation_id,
                        change_type=GraphChangeType.entity_updated,
                        target_key=f"ent:{old.subject_entity_id}",
                        details={"kind": "claim_superseded", **event},
                    )
                )
    db.flush()
    return events


def resolve_temporal(a: Claim, b: Claim) -> str | None:
    """If two conflicting claims speak about non-overlapping periods, both can be true."""
    pa, pb = claim_period(a), claim_period(b)
    if pa and pb and not pa.overlaps(pb):
        return f"Different periods ({pa.label()} vs {pb.label()}): both statements can hold at their own time."
    return None


def entity_timeline(db: Session, entity_id: uuid.UUID) -> list[dict]:
    """Claims and graph changes about an entity, ordered by the time they speak for."""
    events = []
    for cl in db.scalars(select(Claim).where(Claim.subject_entity_id == entity_id)):
        year, basis = _anchor(db, cl)
        events.append(
            {
                "type": "claim",
                "year": year,
                "year_basis": basis,
                "period": claim_period(cl).label() if claim_period(cl) else None,
                "claim_id": str(cl.id),
                "statement": cl.statement,
                "superseded_by_id": str(cl.superseded_by_id) if cl.superseded_by_id else None,
                "recorded_at": cl.created_at.isoformat() if cl.created_at else None,
            }
        )
    for ch in db.scalars(select(GraphChange).where(GraphChange.target_key == f"ent:{entity_id}").order_by(GraphChange.created_at)):
        events.append({"type": "change", "change_type": ch.change_type.value, "year": None, "details": ch.details, "recorded_at": ch.created_at.isoformat()})
    now = datetime.now(UTC).year
    return sorted(events, key=lambda e: (e["year"] or now + 1, e.get("recorded_at") or ""))
