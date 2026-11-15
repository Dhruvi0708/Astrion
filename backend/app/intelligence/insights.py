"""Cross-investigation intelligence for one workspace (never across workspaces).

All of it is computed from stored records: which entities and relationships several investigations
share, connections between entities that no single investigation linked, recurring relationship
patterns, knowledge gaps, how hypotheses evolved, and what changed between two investigations.
"""

import uuid
from collections import Counter, defaultdict
from datetime import UTC
from itertools import combinations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.intelligence.retrieval import jaccard
from app.models import (
    Claim,
    Contradiction,
    GraphChange,
    GraphEntity,
    GraphRelationship,
    Hypothesis,
    Investigation,
    InvestigationReport,
    RelationshipClaim,
    VerificationResult,
)
from app.models.knowledge import InvestigationClaim

HYPOTHESIS_MATCH = 0.5


def chronological(invs) -> list[Investigation]:  # noqa: ANN001
    """Oldest first. created_at can tie (second resolution on some databases); the run start breaks ties."""

    def naive(dt):  # noqa: ANN001, ANN202 — SQLite returns naive values, fresh objects are UTC-aware
        return dt.astimezone(UTC).replace(tzinfo=None) if dt is not None and dt.tzinfo else dt

    return sorted(invs, key=lambda i: (naive(i.created_at), i.started_at is None, naive(i.started_at or i.created_at), str(i.id)))


def _claims_by_investigation(db: Session, ws: uuid.UUID) -> dict[uuid.UUID, set[uuid.UUID]]:
    out: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    rows = db.execute(
        select(InvestigationClaim.investigation_id, InvestigationClaim.claim_id)
        .join(Investigation, Investigation.id == InvestigationClaim.investigation_id)
        .where(Investigation.workspace_id == ws)
    )
    for inv_id, claim_id in rows:
        out[inv_id].add(claim_id)
    return out


def _entities_by_investigation(db: Session, claims_by_inv: dict[uuid.UUID, set[uuid.UUID]]) -> dict[uuid.UUID, set[uuid.UUID]]:
    subject = dict(db.execute(select(Claim.id, Claim.subject_entity_id).where(Claim.subject_entity_id.is_not(None))).all())
    return {inv: {subject[c] for c in cs if c in subject} for inv, cs in claims_by_inv.items()}


def workspace_insights(db: Session, ws: uuid.UUID) -> dict:
    invs = {i.id: i for i in db.scalars(select(Investigation).where(Investigation.workspace_id == ws))}
    claims_by_inv = _claims_by_investigation(db, ws)
    ents_by_inv = _entities_by_investigation(db, claims_by_inv)
    entities = {e.id: e for e in db.scalars(select(GraphEntity).where(GraphEntity.workspace_id == ws, GraphEntity.merged_into_id.is_(None)))}
    rels = list(db.scalars(select(GraphRelationship).where(GraphRelationship.workspace_id == ws)))
    rel_claims: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for rid, cid in db.execute(select(RelationshipClaim.relationship_id, RelationshipClaim.claim_id)):
        rel_claims[rid].add(cid)
    claim_inv: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for inv_id, cs in claims_by_inv.items():
        for c in cs:
            claim_inv[c].add(inv_id)

    def name(eid: uuid.UUID) -> str:
        return entities[eid].name if eid in entities else "?"

    # Entities that several investigations reached independently.
    shared = Counter(e for es in ents_by_inv.values() for e in es)
    bridges = [
        {"entity_id": str(e), "name": name(e), "investigations": [invs[i].title for i, es in ents_by_inv.items() if e in es and i in invs]}
        for e, n in shared.most_common()
        if n >= 2 and e in entities
    ][:30]

    # Relationships corroborated by claims from more than one investigation.
    corroborated = []
    for r in rels:
        found_by = {i for c in rel_claims.get(r.id, ()) for i in claim_inv.get(c, ())}
        if len(found_by) >= 2:
            corroborated.append(
                {
                    "relationship_id": str(r.id),
                    "source": name(r.source_entity_id),
                    "type": r.relation_type,
                    "target": name(r.target_entity_id),
                    "investigations": sorted(invs[i].title for i in found_by if i in invs),
                    "support_count": r.support_count,
                }
            )

    # Unnoticed connections: entities first reached by different investigations, linked only through a
    # shared intermediate entity (a two-step path), with no direct relationship of their own.
    adj: dict[uuid.UUID, dict[uuid.UUID, str]] = defaultdict(dict)
    for r in rels:
        adj[r.source_entity_id][r.target_entity_id] = r.relation_type
        adj[r.target_entity_id][r.source_entity_id] = r.relation_type
    home: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for inv_id, es in ents_by_inv.items():
        for e in es:
            home[e].add(inv_id)
    connections = []
    for mid, nbrs in sorted(adj.items(), key=lambda kv: (name(kv[0]), str(kv[0]))):
        for a, b in combinations(sorted(nbrs, key=lambda e: (name(e), str(e))), 2):
            if b in adj[a] or not home[a] or not home[b] or home[a] & home[b]:
                continue
            connections.append(
                {
                    "from": name(a),
                    "to": name(b),
                    "via": name(mid),
                    "path": f"{name(a)} —{nbrs[a].lower()}— {name(mid)} —{nbrs[b].lower()}— {name(b)}",
                    "from_investigations": sorted(invs[i].title for i in home[a] if i in invs),
                    "to_investigations": sorted(invs[i].title for i in home[b] if i in invs),
                    "explanation": "Found by different investigations and never linked directly; connected through a shared entity.",
                }
            )
    connections = connections[:30]

    # Recurring patterns: the same (type —predicate→ type) shape across several investigations.
    pattern_invs: dict[tuple[str, str, str], set[uuid.UUID]] = defaultdict(set)
    for r in rels:
        if r.source_entity_id in entities and r.target_entity_id in entities:
            key = (entities[r.source_entity_id].entity_type, r.relation_type, entities[r.target_entity_id].entity_type)
            for c in rel_claims.get(r.id, ()):
                pattern_invs[key] |= claim_inv.get(c, set())
    patterns = sorted(
        ({"pattern": f"{a} —{p.lower()}→ {b}", "investigations": len(v)} for (a, p, b), v in pattern_invs.items() if len(v) >= 2),
        key=lambda x: -x["investigations"],
    )

    # Knowledge gaps.
    single_claim_entities = [
        {"entity_id": str(e.id), "name": e.name}
        for e in entities.values()
        if db.scalar(select(Claim.id).where(Claim.subject_entity_id == e.id).limit(2).offset(1)) is None
    ][:30]
    weak_relationships = [
        {"source": name(r.source_entity_id), "type": r.relation_type, "target": name(r.target_entity_id)} for r in rels if r.support_count <= 1
    ][:30]
    open_hypotheses = [
        {"id": str(h.id), "statement": h.statement, "status": h.status.value, "consensus": h.consensus, "investigation": invs[h.investigation_id].title}
        for h in db.scalars(select(Hypothesis).where(Hypothesis.workspace_id == ws, Hypothesis.status.in_(["unverified", "conditional", "in_review"])))
        if h.investigation_id in invs
    ][:30]
    open_contradictions = [
        {"id": str(x.id), "kind": x.kind.value, "a": db.get(Claim, x.claim_a_id).statement, "b": db.get(Claim, x.claim_b_id).statement}
        for x in db.scalars(
            select(Contradiction).where(Contradiction.workspace_id == ws, Contradiction.is_genuine.is_(True), Contradiction.resolution_kind.is_(None))
        )
    ][:30]
    unanswered = []
    for inv in invs.values():
        sqs = (inv.plan or {}).get("sub_questions", [])
        covered = {
            q for row in db.scalars(select(InvestigationClaim.sub_question_ids).where(InvestigationClaim.investigation_id == inv.id)) for q in (row or [])
        }
        unanswered += [{"investigation": inv.title, "sub_question": q["question"]} for q in sqs if q["id"] not in covered]

    return {
        "method": "astrion-insights-v1",
        "investigations": len(invs),
        "bridging_entities": bridges,
        "corroborated_relationships": corroborated[:30],
        "connections": connections,
        "patterns": patterns[:20],
        "hypothesis_evolution": hypothesis_evolution(db, ws),
        "gaps": {
            "single_claim_entities": single_claim_entities,
            "weakly_supported_relationships": weak_relationships,
            "open_hypotheses": open_hypotheses,
            "unresolved_contradictions": open_contradictions,
            "unanswered_sub_questions": unanswered[:30],
        },
    }


def hypothesis_evolution(db: Session, ws: uuid.UUID) -> list[dict]:
    """Chains of hypotheses across investigations: explicit revisions plus near-identical statements."""
    invs = chronological(db.scalars(select(Investigation).where(Investigation.workspace_id == ws)))
    order = {inv.id: n for n, inv in enumerate(invs)}
    titles = {inv.id: inv.title for inv in invs}
    hyps = sorted(
        db.scalars(select(Hypothesis).where(Hypothesis.workspace_id == ws)), key=lambda h: (order.get(h.investigation_id, 0), h.created_at, str(h.id))
    )
    chains = []
    for later in hyps:
        earlier = next((h for h in hyps if h.id == later.revises_hypothesis_id), None)
        how = "revision"
        if earlier is None:
            earlier = next(
                (
                    h
                    for h in hyps
                    if order.get(h.investigation_id, 0) < order.get(later.investigation_id, 0) and jaccard(h.statement, later.statement) >= HYPOTHESIS_MATCH
                ),
                None,
            )
            how = "similar statement"
        if earlier is None:
            continue
        chains.append(
            {
                "from": {
                    "id": str(earlier.id),
                    "statement": earlier.statement,
                    "status": earlier.status.value,
                    "confidence": earlier.confidence,
                    "investigation": titles.get(earlier.investigation_id),
                },
                "to": {
                    "id": str(later.id),
                    "statement": later.statement,
                    "status": later.status.value,
                    "confidence": later.confidence,
                    "investigation": titles.get(later.investigation_id),
                },
                "link": how,
                "confidence_change": None if earlier.confidence is None or later.confidence is None else round(later.confidence - earlier.confidence, 4),
                "status_changed": earlier.status != later.status,
            }
        )
    return chains[:40]


def diff_investigations(db: Session, older: Investigation, newer: Investigation) -> dict:
    """What changed from one investigation to a later one in the same workspace."""
    claims_by_inv = _claims_by_investigation(db, older.workspace_id)
    ents = _entities_by_investigation(db, claims_by_inv)
    ea, eb = ents.get(older.id, set()), ents.get(newer.id, set())
    names = dict(db.execute(select(GraphEntity.id, GraphEntity.name).where(GraphEntity.id.in_(ea | eb))).all()) if ea | eb else {}

    def rels_of(inv_id: uuid.UUID) -> set[uuid.UUID]:
        cs = claims_by_inv.get(inv_id, set())
        return set(db.scalars(select(RelationshipClaim.relationship_id).where(RelationshipClaim.claim_id.in_(cs)))) if cs else set()

    ra, rb = rels_of(older.id), rels_of(newer.id)
    new_rels = []
    for rid in rb - ra:
        r = db.get(GraphRelationship, rid)
        new_rels.append(
            {
                "source": names.get(r.source_entity_id) or db.get(GraphEntity, r.source_entity_id).name,
                "type": r.relation_type,
                "target": names.get(r.target_entity_id) or db.get(GraphEntity, r.target_entity_id).name,
            }
        )

    ha = list(db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == older.id)))
    hb = list(db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == newer.id)))
    changed = []
    for h in hb:
        match = next((x for x in ha if x.id == h.revises_hypothesis_id), None) or max(ha, key=lambda x: jaccard(x.statement, h.statement), default=None)
        if match and (match.id == h.revises_hypothesis_id or jaccard(match.statement, h.statement) >= HYPOTHESIS_MATCH):
            changed.append(
                {
                    "before": {"statement": match.statement, "status": match.status.value, "confidence": match.confidence, "consensus": match.consensus},
                    "after": {"statement": h.statement, "status": h.status.value, "confidence": h.confidence, "consensus": h.consensus},
                    "confidence_change": None if match.confidence is None or h.confidence is None else round(h.confidence - match.confidence, 4),
                }
            )

    def pairs(inv_id: uuid.UUID) -> dict[frozenset, Contradiction]:
        return {frozenset((x.claim_a_id, x.claim_b_id)): x for x in db.scalars(select(Contradiction).where(Contradiction.investigation_id == inv_id))}

    xa, xb = pairs(older.id), pairs(newer.id)
    resolved, new_conflicts = [], []
    for key, x in xa.items():
        if not x.is_genuine:
            continue
        later = xb.get(key)
        verdict = db.scalar(select(VerificationResult.verdict).where(VerificationResult.target_id == later.id)) if later else None
        if later is not None and (not later.is_genuine or later.resolution_kind or (verdict and verdict.value == "unsupported")):
            resolved.append(
                {
                    "a": db.get(Claim, x.claim_a_id).statement,
                    "b": db.get(Claim, x.claim_b_id).statement,
                    "how": later.resolution or (verdict.value if verdict else "no longer judged genuine"),
                }
            )
    for key, x in xb.items():
        if key not in xa and x.is_genuine:
            new_conflicts.append({"a": db.get(Claim, x.claim_a_id).statement, "b": db.get(Claim, x.claim_b_id).statement, "kind": x.kind.value})

    def change_counts(inv_id: uuid.UUID) -> dict[str, int]:
        return dict(Counter(c.change_type.value for c in db.scalars(select(GraphChange).where(GraphChange.investigation_id == inv_id))))

    def answer(inv_id: uuid.UUID) -> str | None:
        r = db.scalar(select(InvestigationReport).where(InvestigationReport.investigation_id == inv_id).order_by(InvestigationReport.run_number.desc()))
        return (r.content or {}).get("answer_status") if r else None

    return {
        "from": {"id": str(older.id), "title": older.title, "answer_status": answer(older.id)},
        "to": {"id": str(newer.id), "title": newer.title, "answer_status": answer(newer.id)},
        "shared_entities": sorted(names.get(e, "?") for e in ea & eb),
        "new_entities": sorted(names.get(e, "?") for e in eb - ea),
        "new_relationships": new_rels,
        "changed_hypotheses": changed,
        "resolved_contradictions": resolved,
        "new_conflicts": new_conflicts,
        "knowledge_evolution": {"from": change_counts(older.id), "to": change_counts(newer.id)},
    }
