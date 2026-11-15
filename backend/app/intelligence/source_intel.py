"""Source intelligence: relevance, credibility, recency, independence and corroboration per source.

These scores describe *sources*. They never overwrite the confidence of an individual claim: a weak
source can contain a well-corroborated claim, and a strong source can contain a single unsupported one.
Claim-level corroboration (how many independent source groups state it) is computed separately.
"""

import uuid
from collections import defaultdict
from datetime import UTC, date, datetime
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.intelligence.retrieval import tokens
from app.models import Claim, Document, Source, SourceAssessment
from app.models.enums import SourceType

METHOD = "astrion-source-v1"
# Prior by source type. A prior, not a verdict: it is shown as such and can be wrong for any given source.
TYPE_PRIOR = {
    SourceType.paper: 0.8,
    SourceType.dataset: 0.75,
    SourceType.report: 0.7,
    SourceType.article: 0.55,
    SourceType.document: 0.5,
    SourceType.web: 0.4,
    SourceType.other: 0.4,
}
CORROBORATION_SIMILARITY = 0.6


def _host(uri: str | None) -> str | None:
    if not uri:
        return None
    host = urlparse(uri if "://" in uri else f"https://{uri}").hostname
    return host.removeprefix("www.") if host else None


def independence_groups(db: Session, sources: list[Source]) -> dict[uuid.UUID, str]:
    """Union-find over sources that share a web host, an author or identical document content."""
    parent = {s.id: s.id for s in sources}

    def find(x: uuid.UUID) -> uuid.UUID:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: uuid.UUID, b: uuid.UUID) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb, key=str)] = min(ra, rb, key=str)

    seen: dict[str, uuid.UUID] = {}
    for s in sources:
        keys = [f"host:{h}"] if (h := _host(s.uri)) else []
        keys += [f"author:{a.strip().lower()}" for a in (s.authors or []) if a and a.strip()]
        keys += [f"hash:{h}" for h in db.scalars(select(Document.content_hash).where(Document.source_id == s.id, Document.content_hash.is_not(None)))]
        for k in keys:
            if k in seen:
                union(seen[k], s.id)
            else:
                seen[k] = s.id
    return {s.id: f"g:{find(s.id)}"[:64] for s in sources}


def claim_corroboration(db: Session, workspace_id: uuid.UUID, claims: list[Claim]) -> dict[uuid.UUID, int]:
    """Number of independent source groups (workspace-wide) that state each claim."""
    pool = list(db.scalars(select(Claim).where(Claim.workspace_id == workspace_id).limit(5000)))
    doc_source = dict(db.execute(select(Document.id, Document.source_id).where(Document.workspace_id == workspace_id)).all())
    sources = list(db.scalars(select(Source).where(Source.workspace_id == workspace_id)))
    groups = independence_groups(db, sources)
    pool_tokens = [(o, set(tokens(o.statement))) for o in pool]
    out = {}
    for c in claims:
        g = {groups.get(doc_source.get(c.document_id))}
        mine = set(tokens(c.statement))
        for other, theirs in pool_tokens:
            if other.id == c.id:
                continue
            same = other.normalized_statement and other.normalized_statement == c.normalized_statement
            if same or (mine and theirs and len(mine & theirs) / len(mine | theirs) >= CORROBORATION_SIMILARITY):
                g.add(groups.get(doc_source.get(other.document_id)))
        out[c.id] = len({x for x in g if x})
    return out


def assess_sources(db: Session, workspace_id: uuid.UUID, investigation_id: uuid.UUID, run_number: int, claims: list[Claim]) -> list[SourceAssessment]:
    """Writes one assessment per source used by the investigation's claims (idempotent per run)."""
    existing = list(
        db.scalars(select(SourceAssessment).where(SourceAssessment.investigation_id == investigation_id, SourceAssessment.run_number == run_number))
    )
    if existing:
        return existing
    doc_source = {d.id: d.source_id for d in db.scalars(select(Document).where(Document.workspace_id == workspace_id))}
    all_sources = list(db.scalars(select(Source).where(Source.workspace_id == workspace_id)))
    groups = independence_groups(db, all_sources)
    group_size = defaultdict(int)
    for g in groups.values():
        group_size[g] += 1
    corroboration = claim_corroboration(db, workspace_id, claims)
    per_source: dict[uuid.UUID, list[Claim]] = defaultdict(list)
    for c in claims:
        if (sid := doc_source.get(c.document_id)) is not None:
            per_source[sid].append(c)
    top = max((len(v) for v in per_source.values()), default=1)
    today = datetime.now(UTC).date()
    rows = []
    for src in all_sources:
        mine = per_source.get(src.id)
        if not mine:
            continue
        age = (today - src.published_on).days / 365.25 if isinstance(src.published_on, date) else None
        corroborated = sum(1 for c in mine if corroboration.get(c.id, 1) >= 2)
        row = SourceAssessment(
            workspace_id=workspace_id,
            investigation_id=investigation_id,
            run_number=run_number,
            source_id=src.id,
            independence_group=groups[src.id],
            relevance=round(len(mine) / top, 3),
            credibility=TYPE_PRIOR.get(src.source_type, 0.4),
            recency=None if age is None else round(max(0.0, 1 - age / 10), 3),
            independence=round(1 / group_size[groups[src.id]], 3),
            corroboration=round(corroborated / len(mine), 3),
            details={
                "method": METHOD,
                "claims": len(mine),
                "corroborated_claims": corroborated,
                "credibility_basis": f"prior for source type '{src.source_type.value}' (not a verified rating)",
                "published_on": src.published_on.isoformat() if src.published_on else None,
                "recency_basis": "unknown publication date" if age is None else f"{age:.1f} years old (linear decay over 10 years)",
                "independent_of_others": group_size[groups[src.id]] == 1,
                "shares_origin_with": group_size[groups[src.id]] - 1,
            },
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows
