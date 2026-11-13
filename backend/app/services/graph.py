"""Workspace knowledge-graph queries (owner-scoped).

The graph is read from Neo4j when it is configured and reachable, otherwise from the PostgreSQL
registry; the response says which (``source``). Both produce the same shape.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.graph.model import ENTITY_PREDICATES, NodeLabel, RelType, node_key
from app.models import Claim, Document, Evidence, GraphEntity, GraphRelationship, Investigation, RelationshipClaim, Source, User
from app.models.knowledge import investigation_claim_ids
from app.services.workspaces import get_owned_workspace


def _entity_scope(db: Session, workspace_id: uuid.UUID, investigation_id: uuid.UUID | None) -> set[uuid.UUID] | None:
    if investigation_id is None:
        return None
    inv = db.get(Investigation, investigation_id)
    if inv is None or inv.workspace_id != workspace_id:
        raise NotFoundError(f"Investigation {investigation_id} was not found.")
    claim_ids = list(db.scalars(investigation_claim_ids(investigation_id)))
    ids = set(db.scalars(select(Claim.subject_entity_id).where(Claim.id.in_(claim_ids), Claim.subject_entity_id.is_not(None)))) if claim_ids else set()
    if claim_ids:
        rel_ids = set(db.scalars(select(RelationshipClaim.relationship_id).where(RelationshipClaim.claim_id.in_(claim_ids))))
        for r in db.scalars(select(GraphRelationship).where(GraphRelationship.id.in_(rel_ids))):
            ids |= {r.source_entity_id, r.target_entity_id}
    return ids


def _from_postgres(db: Session, workspace_id: uuid.UUID, scope: set[uuid.UUID] | None, include_claims: bool, limit: int) -> dict:
    q = select(GraphEntity).where(GraphEntity.workspace_id == workspace_id, GraphEntity.merged_into_id.is_(None))
    if scope is not None:
        q = q.where(GraphEntity.id.in_(scope or {uuid.UUID(int=0)}))
    entities = list(db.scalars(q.order_by(GraphEntity.mention_count.desc(), GraphEntity.name).limit(limit)))
    ids = {e.id for e in entities}
    nodes = [
        {
            "key": e.graph_key,
            "kind": "entity",
            "label": e.name,
            "entity_type": e.entity_type,
            "entity_id": str(e.id),
            "mention_count": e.mention_count,
            "aliases": e.aliases,
        }
        for e in entities
    ]
    edges = []
    rels = (
        db.scalars(
            select(GraphRelationship).where(
                GraphRelationship.workspace_id == workspace_id, GraphRelationship.source_entity_id.in_(ids), GraphRelationship.target_entity_id.in_(ids)
            )
        )
        if ids
        else []
    )
    key_of = {e.id: e.graph_key for e in entities}
    for r in rels:
        claims = [str(c) for c in db.scalars(select(RelationshipClaim.claim_id).where(RelationshipClaim.relationship_id == r.id))]
        edges.append(
            {
                "key": r.graph_key,
                "type": r.relation_type,
                "source": key_of[r.source_entity_id],
                "target": key_of[r.target_entity_id],
                "support_count": r.support_count,
                "claim_ids": claims,
                "confidence": r.confidence,
            }
        )
    if include_claims and ids:
        for cl in db.scalars(select(Claim).where(Claim.workspace_id == workspace_id, Claim.subject_entity_id.in_(ids)).limit(limit)):
            ck = node_key(NodeLabel.CLAIM, cl.id)
            nodes.append({"key": ck, "kind": "claim", "label": cl.statement[:160], "claim_id": str(cl.id), "claim_kind": cl.kind.value})
            edges.append(
                {
                    "key": f"about:{cl.id}",
                    "type": "ABOUT",
                    "source": ck,
                    "target": key_of[cl.subject_entity_id],
                    "support_count": 1,
                    "claim_ids": [str(cl.id)],
                    "confidence": None,
                }
            )
    return {"source": "postgres", "nodes": nodes, "edges": edges}


def _from_neo4j(repo, db: Session, workspace_id: uuid.UUID, scope: set[uuid.UUID] | None, include_claims: bool, limit: int) -> dict:  # noqa: ANN001
    labels = [NodeLabel.ENTITY, *([NodeLabel.CLAIM] if include_claims else [])]
    rel_types = [*ENTITY_PREDICATES, *([RelType.ABOUT] if include_claims else [])]
    raw_nodes, raw_rels = repo.subgraph(str(workspace_id), labels, rel_types, limit=limit * (3 if include_claims else 1))
    allowed = {node_key(NodeLabel.ENTITY, i) for i in scope} if scope is not None else None
    nodes, keep = [], set()
    for n in raw_nodes:
        if n.label == NodeLabel.ENTITY.value:
            if allowed is not None and n.key not in allowed:
                continue
            nodes.append(
                {
                    "key": n.key,
                    "kind": "entity",
                    "label": n.properties.get("name"),
                    "entity_type": n.properties.get("entity_type"),
                    "entity_id": n.key.split(":", 1)[1],
                    "mention_count": n.properties.get("mention_count", 0),
                    "aliases": n.properties.get("aliases", []),
                }
            )
            keep.add(n.key)
    claim_nodes = {n.key: n for n in raw_nodes if n.label == NodeLabel.CLAIM.value}
    edges = []
    for r in raw_rels:
        if r.type == RelType.ABOUT.value:
            if r.to_key in keep and r.from_key in claim_nodes:
                cn = claim_nodes[r.from_key]
                if r.from_key not in keep:
                    nodes.append(
                        {
                            "key": cn.key,
                            "kind": "claim",
                            "label": (cn.properties.get("statement") or "")[:160],
                            "claim_id": cn.key.split(":", 1)[1],
                            "claim_kind": cn.properties.get("kind"),
                        }
                    )
                    keep.add(cn.key)
                edges.append(
                    {
                        "key": r.key,
                        "type": "ABOUT",
                        "source": r.from_key,
                        "target": r.to_key,
                        "support_count": 1,
                        "claim_ids": [cn.key.split(":", 1)[1]],
                        "confidence": None,
                    }
                )
        elif r.from_key in keep and r.to_key in keep:
            edges.append(
                {
                    "key": r.key,
                    "type": r.type,
                    "source": r.from_key,
                    "target": r.to_key,
                    "support_count": r.properties.get("support_count", 0),
                    "claim_ids": r.properties.get("claim_ids", []),
                    "confidence": r.properties.get("confidence"),
                }
            )
    return {"source": "neo4j", "nodes": nodes, "edges": edges}


def workspace_graph(
    db: Session, user: User, workspace_id: uuid.UUID, graph_client, investigation_id: uuid.UUID | None, include_claims: bool, limit: int
) -> dict:  # noqa: ANN001
    get_owned_workspace(db, user, workspace_id)
    scope = _entity_scope(db, workspace_id, investigation_id)
    repo_factory = getattr(graph_client, "repository", None)
    if repo_factory is not None:
        from app.graph.repository import GraphError

        try:
            data = _from_neo4j(repo_factory(), db, workspace_id, scope, include_claims, limit)
            return {**data, "fallback_reason": None}
        except GraphError as exc:
            return {**_from_postgres(db, workspace_id, scope, include_claims, limit), "fallback_reason": f"Neo4j unavailable: {exc}"}
    return {**_from_postgres(db, workspace_id, scope, include_claims, limit), "fallback_reason": "Neo4j is not configured."}


def entity_detail(db: Session, user: User, workspace_id: uuid.UUID, entity_id: uuid.UUID) -> dict:
    """Everything known about one entity, with full provenance for each claim."""
    get_owned_workspace(db, user, workspace_id)
    ent = db.get(GraphEntity, entity_id)
    if ent is None or ent.workspace_id != workspace_id:
        raise NotFoundError(f"Entity {entity_id} was not found.")
    claims = []
    for cl in db.scalars(select(Claim).where(Claim.subject_entity_id == ent.id).order_by(Claim.created_at.desc()).limit(50)):
        doc = db.get(Document, cl.document_id)
        src = db.get(Source, doc.source_id) if doc else None
        claims.append(
            {
                "id": str(cl.id),
                "statement": cl.statement,
                "kind": cl.kind.value,
                "temporal_scope": cl.temporal_scope,
                "investigation_id": str(cl.investigation_id) if cl.investigation_id else None,
                "document": {"id": str(doc.id), "title": doc.title} if doc else None,
                "source": {"id": str(src.id), "title": src.title, "uri": src.uri} if src else None,
                "evidence": [{"quote": e.quote, "locator": e.locator} for e in db.scalars(select(Evidence).where(Evidence.claim_id == cl.id))],
            }
        )
    rels = []
    for r in db.scalars(select(GraphRelationship).where((GraphRelationship.source_entity_id == ent.id) | (GraphRelationship.target_entity_id == ent.id))):
        other_id = r.target_entity_id if r.source_entity_id == ent.id else r.source_entity_id
        other = db.get(GraphEntity, other_id)
        rels.append(
            {
                "id": str(r.id),
                "type": r.relation_type,
                "direction": "out" if r.source_entity_id == ent.id else "in",
                "other": {"id": str(other.id), "name": other.name, "entity_type": other.entity_type, "key": other.graph_key},
                "support_count": r.support_count,
                "confidence": r.confidence,
                "claim_ids": [str(x) for x in db.scalars(select(RelationshipClaim.claim_id).where(RelationshipClaim.relationship_id == r.id))],
                "first_seen_at": r.first_seen_at.isoformat() if r.first_seen_at else None,
                "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            }
        )
    return {
        "id": str(ent.id),
        "key": ent.graph_key,
        "name": ent.name,
        "entity_type": ent.entity_type,
        "description": ent.description,
        "aliases": ent.aliases,
        "mention_count": ent.mention_count,
        "last_seen_at": ent.last_seen_at.isoformat() if ent.last_seen_at else None,
        "graph_synced_at": ent.graph_synced_at.isoformat() if ent.graph_synced_at else None,
        "claims": claims,
        "relationships": rels,
    }


def consistency(db: Session, user: User, workspace_id: uuid.UUID, graph_client) -> dict:  # noqa: ANN001
    get_owned_workspace(db, user, workspace_id)
    repo_factory = getattr(graph_client, "repository", None)
    if repo_factory is None:
        return {"status": "not_configured", "detail": "Neo4j is not configured."}
    from app.graph.repository import GraphError
    from app.intelligence.knowledge_store import consistency_report

    try:
        return {"status": "checked", **consistency_report(db, repo_factory(), workspace_id)}
    except GraphError as exc:
        return {"status": "unavailable", "detail": str(exc)}
