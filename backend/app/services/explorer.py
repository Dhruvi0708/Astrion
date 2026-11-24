"""Workspace-level views: dashboard, intelligence explorer, graph search/neighbourhoods, document
processing and report export. Everything is owner-scoped and computed from stored records."""

import uuid
from collections import Counter

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.graph.model import ENTITY_PREDICATES, NodeLabel, node_key
from app.models import (
    AgentExecution,
    Claim,
    Contradiction,
    Document,
    DocumentChunk,
    Evidence,
    GraphChange,
    GraphEntity,
    GraphRelationship,
    Hypothesis,
    HypothesisEvidence,
    Investigation,
    InvestigationReport,
    RelationshipClaim,
    Source,
    User,
)
from app.models.enums import DocumentProcessingStatus, InvestigationStatus, VerificationStatus
from app.models.knowledge import InvestigationClaim
from app.services.workspaces import get_owned_workspace

ACTIVE = [InvestigationStatus.queued, InvestigationStatus.running, InvestigationStatus.cancelling]
OPEN_HYPOTHESIS = [VerificationStatus.unverified, VerificationStatus.conditional, VerificationStatus.in_review]


def _count(db: Session, stmt) -> int:  # noqa: ANN001
    return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0


# --------------------------------------------------------------------------- dashboard


def dashboard(db: Session, user: User, ws: uuid.UUID) -> dict:
    get_owned_workspace(db, user, ws)
    by_status = dict(db.execute(select(Investigation.status, func.count()).where(Investigation.workspace_id == ws).group_by(Investigation.status)).all())
    titles = dict(db.execute(select(Investigation.id, Investigation.title).where(Investigation.workspace_id == ws)).all())
    findings = 0
    for inv_id in db.scalars(select(Investigation.id).where(Investigation.workspace_id == ws, Investigation.status == InvestigationStatus.completed)):
        rep = db.scalar(select(InvestigationReport).where(InvestigationReport.investigation_id == inv_id).order_by(InvestigationReport.run_number.desc()))
        if rep:
            findings += sum(1 for f in (rep.content or {}).get("key_findings", []) if f.get("claim_refs"))
    hyp_rows = db.execute(select(Hypothesis.status, Hypothesis.consensus).where(Hypothesis.workspace_id == ws)).all()
    entity_types = dict(
        db.execute(
            select(GraphEntity.entity_type, func.count())
            .where(GraphEntity.workspace_id == ws, GraphEntity.merged_into_id.is_(None))
            .group_by(GraphEntity.entity_type)
        ).all()
    )
    top_entities = [
        {"id": str(e.id), "name": e.name, "entity_type": e.entity_type, "mention_count": e.mention_count}
        for e in db.scalars(
            select(GraphEntity)
            .where(GraphEntity.workspace_id == ws, GraphEntity.merged_into_id.is_(None))
            .order_by(GraphEntity.mention_count.desc(), GraphEntity.name)
            .limit(8)
        )
    ]
    discoveries = [
        {
            "change_type": c.change_type.value,
            "target_key": c.target_key,
            "details": c.details,
            "investigation": {"id": str(c.investigation_id), "title": titles.get(c.investigation_id)} if c.investigation_id else None,
            "created_at": c.created_at.isoformat(),
        }
        for c in db.scalars(
            select(GraphChange)
            .where(
                GraphChange.workspace_id == ws,
                GraphChange.change_type.in_(["relationship_created", "hypothesis_added", "contradiction_linked", "entity_created"]),
            )
            .order_by(GraphChange.created_at.desc(), GraphChange.id)
            .limit(12)
        )
    ]
    activity = [
        {
            "investigation": {"id": str(e.investigation_id), "title": titles.get(e.investigation_id)},
            "step_key": e.step_key,
            "agent_role": e.agent_role.value,
            "status": e.status.value,
            "summary": e.summary,
            "error": e.error,
            "finished_at": e.finished_at.isoformat() if e.finished_at else None,
        }
        for e in db.scalars(
            select(AgentExecution).where(AgentExecution.workspace_id == ws).order_by(AgentExecution.created_at.desc(), AgentExecution.attempt.desc()).limit(12)
        )
    ]
    docs = dict(db.execute(select(Document.processing_status, func.count()).where(Document.workspace_id == ws).group_by(Document.processing_status)).all())
    return {
        "investigations": {
            "total": sum(by_status.values()),
            "active": sum(by_status.get(s, 0) for s in ACTIVE),
            "completed": by_status.get(InvestigationStatus.completed, 0),
            "failed": by_status.get(InvestigationStatus.failed, 0),
            "by_status": {k.value: v for k, v in by_status.items()},
        },
        "knowledge": {
            "entities": sum(entity_types.values()),
            "relationships": _count(db, select(GraphRelationship.id).where(GraphRelationship.workspace_id == ws)),
            "claims": _count(db, select(Claim.id).where(Claim.workspace_id == ws)),
            "entity_types": entity_types,
            "top_entities": top_entities,
        },
        "findings": {
            "cited_findings": findings,  # key findings in completed reports that cite evidence
            "agreed_hypotheses": sum(1 for _, c in hyp_rows if c == "agreed"),
            "human_verified_hypotheses": sum(1 for s, _ in hyp_rows if s == VerificationStatus.verified),
            "unresolved_hypotheses": sum(1 for s, c in hyp_rows if s in OPEN_HYPOTHESIS and c != "rejected"),
            "unresolved_contradictions": _count(
                db,
                select(Contradiction.id).where(Contradiction.workspace_id == ws, Contradiction.is_genuine.is_(True), Contradiction.resolution_kind.is_(None)),
            ),
        },
        "documents": {"total": sum(docs.values()), "by_status": {k.value: v for k, v in docs.items()}},
        "recent_discoveries": discoveries,
        "recent_activity": activity,
    }


# --------------------------------------------------------------------------- explorer


def _inv_titles(db: Session, ws: uuid.UUID) -> dict[uuid.UUID, str]:
    return dict(db.execute(select(Investigation.id, Investigation.title).where(Investigation.workspace_id == ws)).all())


def entities(db: Session, user: User, ws: uuid.UUID, q: str | None, entity_type: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
    get_owned_workspace(db, user, ws)
    stmt = select(GraphEntity).where(GraphEntity.workspace_id == ws, GraphEntity.merged_into_id.is_(None))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(GraphEntity.name).like(like), GraphEntity.normalized_name.like(like)))
    if entity_type:
        stmt = stmt.where(GraphEntity.entity_type == entity_type)
    total = _count(db, stmt)
    rows = list(db.scalars(stmt.order_by(GraphEntity.mention_count.desc(), GraphEntity.name).limit(limit).offset(offset)))
    titles = _inv_titles(db, ws)
    out = []
    for e in rows:
        claim_ids = list(db.scalars(select(Claim.id).where(Claim.subject_entity_id == e.id)))
        invs = set(db.scalars(select(InvestigationClaim.investigation_id).where(InvestigationClaim.claim_id.in_(claim_ids)))) if claim_ids else set()
        rels = _count(db, select(GraphRelationship.id).where((GraphRelationship.source_entity_id == e.id) | (GraphRelationship.target_entity_id == e.id)))
        out.append(
            {
                "id": str(e.id),
                "key": e.graph_key,
                "name": e.name,
                "entity_type": e.entity_type,
                "aliases": e.aliases,
                "mention_count": e.mention_count,
                "claims": len(claim_ids),
                "relationships": rels,
                "investigations": sorted(({"id": str(i), "title": titles.get(i)} for i in invs), key=lambda x: x["title"] or ""),
            }
        )
    return out, total


def hypotheses(
    db: Session, user: User, ws: uuid.UUID, q: str | None, status: str | None, consensus: str | None, limit: int, offset: int
) -> tuple[list[dict], int]:
    from app.services.investigations import hypotheses as inv_hypotheses

    get_owned_workspace(db, user, ws)
    stmt = select(Hypothesis).where(Hypothesis.workspace_id == ws)
    if q:
        stmt = stmt.where(func.lower(Hypothesis.statement).like(f"%{q.lower()}%"))
    if status:
        stmt = stmt.where(Hypothesis.status == status)
    if consensus:
        stmt = stmt.where(Hypothesis.consensus == consensus)
    total = _count(db, stmt)
    titles = _inv_titles(db, ws)
    rows = list(db.scalars(stmt.order_by(Hypothesis.created_at.desc(), Hypothesis.id).limit(limit).offset(offset)))
    payload = {}
    for inv_id in {h.investigation_id for h in rows}:
        for h in inv_hypotheses(db, user, inv_id):
            payload[h["id"]] = {**h, "investigation": {"id": str(inv_id), "title": titles.get(inv_id)}}
    return [payload[str(h.id)] for h in rows if str(h.id) in payload], total


def contradictions(db: Session, user: User, ws: uuid.UUID, resolved: bool | None, limit: int, offset: int) -> tuple[list[dict], int]:
    from app.services.investigations import contradictions as inv_contradictions

    get_owned_workspace(db, user, ws)
    stmt = select(Contradiction).where(Contradiction.workspace_id == ws)
    if resolved is True:
        stmt = stmt.where(Contradiction.resolution_kind.is_not(None))
    elif resolved is False:
        stmt = stmt.where(Contradiction.resolution_kind.is_(None))
    total = _count(db, stmt)
    titles = _inv_titles(db, ws)
    rows = list(db.scalars(stmt.order_by(Contradiction.created_at.desc(), Contradiction.id).limit(limit).offset(offset)))
    wanted = {r.id for r in rows}
    by_id = {}
    for inv_id in {r.investigation_id for r in rows}:
        for x in inv_contradictions(db, user, inv_id):
            if uuid.UUID(x["id"]) in wanted:
                by_id[x["id"]] = {**x, "investigation": {"id": str(inv_id), "title": titles.get(inv_id)}}
    return [by_id[str(r.id)] for r in rows if str(r.id) in by_id], total


def evidence(db: Session, user: User, ws: uuid.UUID, q: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
    get_owned_workspace(db, user, ws)
    stmt = select(Evidence, Claim).join(Claim, Claim.id == Evidence.claim_id).where(Evidence.workspace_id == ws)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Evidence.quote).like(like), func.lower(Claim.statement).like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    titles = _inv_titles(db, ws)
    out = []
    for ev, cl in db.execute(stmt.order_by(Evidence.created_at.desc(), Evidence.id).limit(limit).offset(offset)).all():
        doc = db.get(Document, ev.document_id)
        src = db.get(Source, doc.source_id) if doc else None
        subject = db.get(GraphEntity, cl.subject_entity_id) if cl.subject_entity_id else None
        invs = list(db.scalars(select(InvestigationClaim.investigation_id).where(InvestigationClaim.claim_id == cl.id)))
        hyp_ids = set(db.scalars(select(HypothesisEvidence.hypothesis_id).where(HypothesisEvidence.evidence_id == ev.id)))
        out.append(
            {
                "id": str(ev.id),
                "quote": ev.quote,
                "locator": ev.locator,
                "stance": ev.stance.value,
                "claim": {
                    "id": str(cl.id),
                    "statement": cl.statement,
                    "kind": cl.kind.value,
                    "status": cl.status.value,
                    "superseded": cl.superseded_by_id is not None,
                    "period": [cl.valid_from_year, cl.valid_to_year] if cl.valid_from_year or cl.valid_to_year else None,
                    "extractor": cl.extractor,
                },
                "entity": {"id": str(subject.id), "name": subject.name, "entity_type": subject.entity_type} if subject else None,
                "document": {"id": str(doc.id), "title": doc.title, "media_type": doc.media_type} if doc else None,
                "source": {"id": str(src.id), "title": src.title, "uri": src.uri, "source_type": src.source_type.value} if src else None,
                "investigations": [{"id": str(i), "title": titles.get(i)} for i in invs],
                "used_by_hypotheses": len(hyp_ids),
            }
        )
    return out, total


# --------------------------------------------------------------------------- graph search and neighbourhoods


def _node_payload(e: GraphEntity) -> dict:
    return {
        "key": e.graph_key,
        "kind": "entity",
        "label": e.name,
        "entity_type": e.entity_type,
        "entity_id": str(e.id),
        "mention_count": e.mention_count,
        "aliases": e.aliases,
    }


def graph_search(db: Session, user: User, ws: uuid.UUID, q: str, limit: int = 20) -> list[dict]:
    items, _ = entities(db, user, ws, q, None, limit, 0)
    return items


def neighbourhood(db: Session, user: User, ws: uuid.UUID, entity_id: uuid.UUID, depth: int, graph_client) -> dict:  # noqa: ANN001
    """An entity and everything within `depth` hops: Neo4j when available, otherwise the PostgreSQL registry."""
    get_owned_workspace(db, user, ws)
    ent = db.get(GraphEntity, entity_id)
    if ent is None or ent.workspace_id != ws:
        raise NotFoundError(f"Entity {entity_id} was not found.")
    depth = max(1, min(depth, 3))
    repo_factory = getattr(graph_client, "repository", None)
    if repo_factory is not None:
        from app.graph.repository import GraphError

        try:
            nodes, rels = repo_factory().neighbourhood(str(ws), node_key(NodeLabel.ENTITY, ent.id), ENTITY_PREDICATES, depth=depth)
            return {
                "source": "neo4j",
                "center": ent.graph_key,
                "nodes": [
                    {
                        "key": n.key,
                        "kind": "entity",
                        "label": n.properties.get("name"),
                        "entity_type": n.properties.get("entity_type"),
                        "entity_id": n.key.split(":", 1)[1],
                        "mention_count": n.properties.get("mention_count", 0),
                        "aliases": n.properties.get("aliases", []),
                    }
                    for n in nodes
                    if n.label == NodeLabel.ENTITY.value
                ],
                "edges": [
                    {
                        "key": r.key,
                        "type": r.type,
                        "source": r.from_key,
                        "target": r.to_key,
                        "support_count": r.properties.get("support_count", 0),
                        "claim_ids": r.properties.get("claim_ids", []),
                        "confidence": r.properties.get("confidence"),
                    }
                    for r in rels
                ],
                "fallback_reason": None,
            }
        except GraphError as exc:
            fallback = f"Neo4j unavailable: {exc}"
    else:
        fallback = "Neo4j is not configured."
    seen, frontier, edges = {ent.id}, {ent.id}, {}
    for _ in range(depth):
        rels = list(
            db.scalars(
                select(GraphRelationship).where(
                    GraphRelationship.workspace_id == ws,
                    or_(GraphRelationship.source_entity_id.in_(frontier), GraphRelationship.target_entity_id.in_(frontier)),
                )
            )
        )
        nxt = set()
        for r in rels:
            edges[r.id] = r
            for x in (r.source_entity_id, r.target_entity_id):
                if x not in seen:
                    nxt.add(x)
        seen |= nxt
        frontier = nxt
        if not frontier:
            break
    ents = {e.id: e for e in db.scalars(select(GraphEntity).where(GraphEntity.id.in_(seen)))}
    return {
        "source": "postgres",
        "center": ent.graph_key,
        "nodes": [_node_payload(e) for e in ents.values()],
        "edges": [
            {
                "key": r.graph_key,
                "type": r.relation_type,
                "source": ents[r.source_entity_id].graph_key,
                "target": ents[r.target_entity_id].graph_key,
                "support_count": r.support_count,
                "claim_ids": [str(c) for c in db.scalars(select(RelationshipClaim.claim_id).where(RelationshipClaim.relationship_id == r.id))],
                "confidence": r.confidence,
            }
            for r in edges.values()
            if r.source_entity_id in ents and r.target_entity_id in ents
        ],
        "fallback_reason": fallback,
    }


def entity_context(db: Session, ws: uuid.UUID, entity_id: uuid.UUID) -> dict:
    """Hypotheses and investigations connected to an entity through its claims."""
    claim_ids = list(db.scalars(select(Claim.id).where(Claim.subject_entity_id == entity_id)))
    if not claim_ids:
        return {"hypotheses": [], "investigations": []}
    ev_ids = list(db.scalars(select(Evidence.id).where(Evidence.claim_id.in_(claim_ids))))
    hyp_ids = set(db.scalars(select(HypothesisEvidence.hypothesis_id).where(HypothesisEvidence.evidence_id.in_(ev_ids)))) if ev_ids else set()
    titles = _inv_titles(db, ws)
    hyps = [
        {
            "id": str(h.id),
            "statement": h.statement,
            "status": h.status.value,
            "consensus": h.consensus,
            "confidence": h.confidence,
            "investigation_id": str(h.investigation_id),
        }
        for h in db.scalars(select(Hypothesis).where(Hypothesis.id.in_(hyp_ids)))
    ]
    invs = set(db.scalars(select(InvestigationClaim.investigation_id).where(InvestigationClaim.claim_id.in_(claim_ids))))
    return {"hypotheses": hyps, "investigations": [{"id": str(i), "title": titles.get(i)} for i in invs]}


# --------------------------------------------------------------------------- documents


def process_document(db: Session, user: User, storage, document_id: uuid.UUID) -> dict:  # noqa: ANN001
    """Extracts a stored document's text into passages now (the same extraction investigations use)."""
    from app.intelligence.text import ExtractionError, chunk, extract_segments
    from app.services.sources import get_owned_document

    doc = get_owned_document(db, user, document_id)
    existing = db.scalar(select(func.count()).select_from(DocumentChunk).where(DocumentChunk.document_id == doc.id)) or 0
    if existing:
        doc.processing_status, doc.processing_error = DocumentProcessingStatus.processed, None
        db.commit()
        return document_intelligence(db, user, document_id)
    if not doc.storage_key:
        doc.processing_status = DocumentProcessingStatus.failed
        doc.processing_error = "No file is stored for this document (metadata only); there is nothing to extract."
        db.commit()
        return document_intelligence(db, user, document_id)
    try:
        passages = chunk(extract_segments(b"".join(storage.open(doc.storage_key)), doc.media_type))
    except ExtractionError as exc:
        doc.processing_status, doc.processing_error = DocumentProcessingStatus.failed, str(exc)[:2000]
        db.commit()
        return document_intelligence(db, user, document_id)
    if not passages:
        doc.processing_status, doc.processing_error = DocumentProcessingStatus.failed, "The file contains no extractable text."
        db.commit()
        return document_intelligence(db, user, document_id)
    for p in passages:
        db.add(
            DocumentChunk(
                workspace_id=doc.workspace_id, document_id=doc.id, chunk_index=p.index, text=p.text, char_start=p.char_start, char_end=p.char_end, page=p.page
            )
        )
    doc.processing_status, doc.processing_error = DocumentProcessingStatus.processed, None
    db.commit()
    return document_intelligence(db, user, document_id)


def document_intelligence(db: Session, user: User, document_id: uuid.UUID) -> dict:
    from app.services.sources import get_owned_document

    doc = get_owned_document(db, user, document_id)
    chunks = db.execute(select(func.count(), func.coalesce(func.sum(func.length(DocumentChunk.text)), 0)).where(DocumentChunk.document_id == doc.id)).one()
    claims = list(db.scalars(select(Claim).where(Claim.document_id == doc.id).order_by(Claim.created_at, Claim.normalized_statement)))
    claim_ids = [c.id for c in claims]
    subjects = Counter(c.subject_entity_id for c in claims if c.subject_entity_id)
    ents = {e.id: e for e in db.scalars(select(GraphEntity).where(GraphEntity.id.in_(list(subjects))))} if subjects else {}
    titles = _inv_titles(db, doc.workspace_id)
    used_by = set(db.scalars(select(InvestigationClaim.investigation_id).where(InvestigationClaim.claim_id.in_(claim_ids)))) if claim_ids else set()
    scoped = {
        i.id
        for i in db.scalars(select(Investigation).where(Investigation.workspace_id == doc.workspace_id))
        if str(doc.id) in [str(x) for x in (i.document_ids or [])]
    }
    return {
        "document_id": str(doc.id),
        "processing_status": doc.processing_status.value,
        "processing_error": doc.processing_error,
        "passages": int(chunks[0]),
        "extracted_characters": int(chunks[1]),
        "claims": [{"id": str(c.id), "statement": c.statement, "kind": c.kind.value, "superseded": c.superseded_by_id is not None} for c in claims[:100]],
        "claim_count": len(claims),
        "entities": [
            {"id": str(e.id), "name": e.name, "entity_type": e.entity_type, "claims": subjects[e.id]}
            for e in sorted(ents.values(), key=lambda e: -subjects[e.id])
        ],
        "investigations": [
            {"id": str(i), "title": titles.get(i), "relation": "found claims" if i in used_by else "in scope"} for i in sorted(used_by | scoped, key=str)
        ],
    }


# --------------------------------------------------------------------------- report export


def report_markdown(db: Session, user: User, investigation_id: uuid.UUID, run_number: int | None) -> tuple[str, str]:
    """A complete Markdown report (all 14 sections), built from stored records only."""
    from app.services import investigations as svc

    inv = svc.get_owned_investigation(db, user, investigation_id)
    q = select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id)
    if run_number:
        q = q.where(InvestigationReport.run_number == run_number)
    rep = db.scalar(q.order_by(InvestigationReport.run_number.desc()))
    if rep is None:
        raise NotFoundError("This investigation has no report yet. Reports are written only when a run completes.")
    c = rep.content or {}
    cites = c.get("citations", {})
    hyps = svc.hypotheses(db, user, inv.id)
    cons = svc.contradictions(db, user, inv.id)
    claims = svc.claims(db, user, inv.id)
    verifs = {v["target_id"]: v for v in svc.verifications(db, user, inv.id)}
    plan = inv.plan or {}
    gen = c.get("generated_by", {})
    ents = Counter(cl["subject"]["name"] for cl in claims if cl.get("subject"))
    rel_rows = []
    for rid in (
        set(db.scalars(select(RelationshipClaim.relationship_id).where(RelationshipClaim.claim_id.in_([uuid.UUID(cl["id"]) for cl in claims]))))
        if claims
        else set()
    ):
        r = db.get(GraphRelationship, rid)
        a, b = db.get(GraphEntity, r.source_entity_id), db.get(GraphEntity, r.target_entity_id)
        rel_rows.append(f"- {a.name} — {r.relation_type.lower().replace('_', ' ')} → {b.name} (supported by {r.support_count} claim(s))")
    run_steps = db.scalars(
        select(AgentExecution.agent_role).where(AgentExecution.investigation_id == inv.id, AgentExecution.step_key.like(f"r{rep.run_number}:%"))
    ).all()

    def cite(ref: str) -> str:
        x = cites.get(ref)
        if not x:
            return ""
        q = (x.get("evidence") or [{}])[0].get("quote", "")
        return f'    - [{ref}] "{q}" — {(x.get("document") or {}).get("title", "?")}, {(x.get("source") or {}).get("title", "?")}'

    lines = [
        f"# {c.get('title') or inv.title}",
        "",
        f"*Investigation:* {inv.title}  ",
        f"*Run:* {rep.run_number} · *Report generated:* {rep.created_at.isoformat()}  ",
        f"*Produced by:* {gen.get('provider')}/{gen.get('model')}" + (" — **deterministic fixture rules, not AI**" if gen.get("is_fixture") else ""),
        f"*Answer status:* {c.get('answer_status', 'unknown').replace('_', ' ')}",
        "",
        "> Labels used: **Finding** = stated with cited evidence; **Hypothesis** = a proposal awaiting verification (with its reasoning type: correlation, causation, inference or speculation). Nothing here has been verified by a person unless stated.",
        "",
        "## 1. Executive summary",
        c.get("executive_summary", ""),
        "",
        "## 2. Research objective",
        f"**Question:** {inv.question}",
        f"**Objective:** {plan.get('objective', inv.question)}",
        *[f"- {sq['id']}: {sq['question']}" for sq in plan.get("sub_questions", [])],
        "",
        "## 3. Methodology",
        f"Documents in scope: {'all workspace documents' if not inv.document_ids else len(inv.document_ids)}. Agent steps recorded for this run: {len(run_steps)} "
        f"({', '.join(f'{k.value} ×{v}' for k, v in Counter(run_steps).most_common())}). Every claim is backed by a verbatim quote checked against its passage; "
        "hypotheses were challenged in a debate and reviewed by an independent verification agent.",
        "",
        "## 4. Key discoveries",
        *(
            [
                f"{n}. **Finding** ({f.get('confidence')} confidence): {f['statement']}\n" + "\n".join(filter(None, (cite(r) for r in f.get("claim_refs", []))))
                for n, f in enumerate(c.get("key_findings", []), start=1)
            ]
            or ["No finding could be stated with cited evidence."]
        ),
        "",
        "## 5. Important entities",
        *([f"- {name} ({n} claim(s))" for name, n in ents.most_common(15)] or ["None extracted."]),
        "",
        "## 6. Discovered relationships",
        *(rel_rows or ["None asserted by the evidence."]),
        "",
        "## 7. Verified findings",
        "Findings in section 4 cite evidence and passed automated provenance checks. Hypotheses below with consensus **agreed** were supported by the independent "
        "verifier and survived the debate; none of them has been verified by a person.",
        *[f"- {h['statement']} — consensus **{h.get('consensus')}**, status {h['status']}" for h in hyps if h.get("consensus") == "agreed"],
        "",
        "## 8. Generated hypotheses",
    ]
    for h in hyps:
        m = h.get("confidence_method") or {}
        v = h.get("verification") or {}
        lines += [
            f"### {h['statement']}",
            f"- Reasoning type: **{h.get('reasoning_type') or 'n/a'}** · status {h['status']} · consensus {h.get('consensus') or 'n/a'} · confidence {m.get('score', 'n/a')} ({m.get('band', '')}, method {m.get('method', '')})",
            f"- Rationale: {h.get('rationale', '')}",
            *[f"- Would be falsified by: {f}" for f in h.get("falsification_conditions") or []],
            *[f"- Unresolved assumption: {a}" for a in h.get("assumptions") or []],
            f"- Verification: {v.get('verdict', 'not verified')} — {v.get('reasoning', '')}",
            f"- Debate: {(h.get('debate') or {}).get('standing_objections', 0)} objection(s) standing",
            "",
        ]
    lines += ["## 9. Contradictions"]
    for x in cons or []:
        lines += [
            f"- **{x['kind']}** ({'genuine' if x['is_genuine'] else 'apparent'}, {x['severity']}): \"{x['claim_a']['statement']}\" vs \"{x['claim_b']['statement']}\"",
            f"  - {x['explanation']}",
            f"  - Resolution: {x.get('resolution') or 'unresolved'}",
            f"  - Verification: {(verifs.get(x['id']) or {}).get('verdict', 'not verified')}",
        ]
    if not cons:
        lines.append("None detected.")
    lines += ["", "## 10. Supporting and opposing evidence"]
    for cl in claims[:60]:
        lines.append(f"- {cl['statement']} ({cl['kind']}{', outdated' if cl.get('superseded_by_id') else ''})")
        for e in cl["evidence"][:2]:
            lines.append(f'    - "{e["quote"]}" — {(cl.get("document") or {}).get("title", "?")}, {(cl.get("source") or {}).get("title", "?")}')
    lines += [
        "",
        "## 11. Confidence assessments",
        "Hypothesis confidence is computed from evidence (method astrion-evidence-v2): explicit claims weigh 1, inferred 0.5, superseded claims half; "
        "diversity counts independent source groups; the verifier's verdict scales the result. Source reliability is assessed separately and never alters these scores.",
        *[f"- {h['statement'][:120]}: {(h.get('confidence_method') or {}).get('score', 'n/a')}" for h in hyps],
        "",
        "## 12. Unresolved questions",
        *([f"- {u}" for u in c.get("unresolved_questions", [])] or ["None recorded."]),
        "",
        "## 13. Limitations",
        *[f"- {lim}" for lim in c.get("limitations", [])],
        *[f"- No usable evidence in: {d}" for d in c.get("documents_without_evidence", [])],
        "",
        "## 14. Conclusions",
        f"Answer status: **{c.get('answer_status', 'unknown').replace('_', ' ')}**. " + (c.get("executive_summary", "")),
        "",
    ]
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in inv.title.lower())[:60] or "report"
    return "\n".join(lines), f"astrion-{safe}-run{rep.run_number}.md"
