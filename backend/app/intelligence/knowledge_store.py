"""Persists research output into the workspace knowledge base (PostgreSQL) and mirrors it to Neo4j.

Deduplication
1. Exact: entities with the same (workspace, type, normalized name) are the same row.
2. Ambiguous: a new name that is close to an existing one (string similarity ≥ 0.86, or one name
   contained in the other) is sent to the Knowledge Agent, which decides same/different.
3. New names that match each other across documents in the same run collapse to one entity.

Provenance: every claim stores ≥1 evidence row (verbatim quote + chunk locator) pointing at the
document; documents point at sources. Relationships carry the claims that assert them.
"""

import difflib
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.graph.model import NodeLabel, RelType, link_key, node_key, relationship_key
from app.intelligence import contracts as c
from app.models import (
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
    RelationshipClaim,
    Source,
)
from app.models.enums import ClaimKind, ClaimStatus, EntityStatus, EvidenceStance, ExtractionMethod, GraphChangeType, RelationshipStatus
from app.models.knowledge import InvestigationClaim, investigation_claim_ids

SIMILARITY_THRESHOLD = 0.86
_PUNCT = re.compile(r"[^\w\s]")


def normalize_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    text = _PUNCT.sub(" ", text)
    words = [w for w in text.split() if w]
    if words and words[0] in ("the", "a", "an") and len(words) > 1:
        words = words[1:]
    if words and len(words[-1]) > 4 and words[-1].endswith("s") and not words[-1].endswith("ss"):
        words[-1] = words[-1][:-1]  # naive singular: "forests" -> "forest"
    return " ".join(words)[:500]


def normalize_statement(text: str) -> str:
    return " ".join(_PUNCT.sub(" ", text.lower()).split())[:600]


@dataclass
class ResearchBatch:
    """One Research Agent output plus what's needed to resolve its references."""

    document: Document
    source: Source
    passages: dict[str, DocumentChunk]  # passage ref -> chunk
    output: c.ResearchOutput
    execution_id: uuid.UUID | None


@dataclass
class ApplySummary:
    entities_created: int = 0
    entities_reused: int = 0
    entities_merged: int = 0
    claims_created: int = 0
    claims_reused: int = 0
    evidence_created: int = 0
    relationships_created: int = 0
    relationships_reinforced: int = 0
    claim_ids: list[uuid.UUID] = field(default_factory=list)
    entity_ids: list[uuid.UUID] = field(default_factory=list)
    relationship_ids: list[uuid.UUID] = field(default_factory=list)

    def as_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if not k.endswith("_ids")}
        d["claims_total"] = len(self.claim_ids)
        d["entities_total"] = len(self.entity_ids)
        d["relationships_total"] = len(self.relationship_ids)
        return d


class KnowledgeStore:
    def __init__(self, db: Session, investigation: Investigation, extractor: str | None) -> None:
        self.db = db
        self.inv = investigation
        self.ws = investigation.workspace_id
        self.extractor = extractor

    # ------------------------------------------------------------------ entity resolution

    def _existing(self) -> list[GraphEntity]:
        return list(self.db.scalars(select(GraphEntity).where(GraphEntity.workspace_id == self.ws, GraphEntity.merged_into_id.is_(None))))

    def duplicate_questions(self, batches: list[ResearchBatch]) -> tuple[c.KnowledgeInput, dict[str, tuple[str, uuid.UUID]]]:
        """Builds the Knowledge Agent's input: only ambiguous (non-exact) near-duplicates."""
        existing = self._existing()
        exact = {(e.entity_type, e.normalized_name) for e in existing}
        pairs: list[c.DuplicateQuestion] = []
        pair_map: dict[str, tuple[str, uuid.UUID]] = {}  # pair_id -> (new key, existing id)
        asked: set[tuple[str, uuid.UUID]] = set()
        for batch in batches:
            for ent in batch.output.entities:
                norm = normalize_name(ent.name)
                if not norm or (ent.entity_type, norm) in exact:
                    continue
                key = f"{ent.entity_type}|{norm}"
                for other in existing:
                    if other.entity_type != ent.entity_type or (key, other.id) in asked:
                        continue
                    o = other.normalized_name or ""
                    similar = difflib.SequenceMatcher(None, norm, o).ratio() >= SIMILARITY_THRESHOLD
                    contained = len(norm) > 3 and len(o) > 3 and (f" {norm} " in f" {o} " or f" {o} " in f" {norm} ")
                    if similar or contained:
                        pid = f"D{len(pairs) + 1}"
                        asked.add((key, other.id))
                        pair_map[pid] = (key, other.id)
                        pairs.append(
                            c.DuplicateQuestion(
                                pair_id=pid,
                                new_entity=c.EntityCandidate(ref=f"N{len(pairs) + 1}", name=ent.name, entity_type=ent.entity_type, description=ent.description),
                                existing_entity=c.EntityCandidate(
                                    ref=f"K{len(pairs) + 1}", name=other.name, entity_type=other.entity_type, description=other.description or ""
                                ),
                            )
                        )
        return c.KnowledgeInput(question=self.inv.question, pairs=pairs[:40]), pair_map

    # ------------------------------------------------------------------ apply

    def _change(self, change_type: GraphChangeType, target_key: str, **details) -> None:
        self.db.add(GraphChange(workspace_id=self.ws, investigation_id=self.inv.id, change_type=change_type, target_key=target_key, details=details))

    def apply(self, batches: list[ResearchBatch], merges: dict[str, uuid.UUID]) -> ApplySummary:
        """``merges`` maps "type|normalized" of a new entity to the existing entity it duplicates."""
        now = datetime.now(UTC)
        summary = ApplySummary()
        by_key: dict[str, GraphEntity] = {}
        for e in self._existing():
            by_key[f"{e.entity_type}|{e.normalized_name}"] = e

        def resolve_entity(ent: c.ResearchEntity, batch: ResearchBatch) -> GraphEntity | None:
            norm = normalize_name(ent.name)
            if not norm:
                return None
            key = f"{ent.entity_type}|{norm}"
            row = by_key.get(key)
            if row is None and key in merges:
                row = self.db.get(GraphEntity, merges[key])
                if row is not None:
                    if ent.name not in row.aliases and ent.name != row.name:
                        row.aliases = [*row.aliases, ent.name]
                    summary.entities_merged += 1
                    self._change(GraphChangeType.entity_merged, row.graph_key, alias=ent.name, into=row.name)
                    by_key[key] = row
            if row is None:
                eid = uuid.uuid4()
                row = GraphEntity(
                    id=eid,
                    workspace_id=self.ws,
                    graph_key=node_key(NodeLabel.ENTITY, eid),
                    name=ent.name.strip()[:500],
                    entity_type=ent.entity_type,
                    description=ent.description[:2000] or None,
                    status=EntityStatus.active,
                    first_seen_document_id=batch.document.id,
                    normalized_name=norm,
                    aliases=[],
                    mention_count=0,
                    properties={},
                )
                self.db.add(row)
                by_key[key] = row
                summary.entities_created += 1
                self._change(GraphChangeType.entity_created, row.graph_key, name=row.name, entity_type=row.entity_type)
            elif row.id not in summary.entity_ids:
                summary.entities_reused += 1
            row.mention_count += 1
            row.last_seen_at = now
            if row.id not in summary.entity_ids:
                summary.entity_ids.append(row.id)
            return row

        for batch in batches:
            ents = {e.ref: resolve_entity(e, batch) for e in batch.output.entities}
            self.db.flush()
            claim_rows: dict[str, Claim] = {}
            for rc in batch.output.claims:
                norm = normalize_statement(rc.statement)
                claim = self.db.scalar(
                    select(Claim).where(Claim.workspace_id == self.ws, Claim.document_id == batch.document.id, Claim.normalized_statement == norm)
                )
                subject = ents.get(rc.subject_entity_ref) if rc.subject_entity_ref else None
                if claim is None:
                    claim = Claim(
                        workspace_id=self.ws,
                        document_id=batch.document.id,
                        statement=rc.statement[:4000],
                        status=ClaimStatus.extracted,
                        extraction_method=ExtractionMethod.model,
                        extractor=self.extractor,
                        confidence={"low": 0.33, "medium": 0.66, "high": 0.9}[rc.confidence],
                        kind=ClaimKind(rc.kind),
                        investigation_id=self.inv.id,
                        extraction_execution_id=batch.execution_id,
                        subject_entity_id=subject.id if subject else None,
                        temporal_scope=(rc.temporal_scope or None) and rc.temporal_scope[:120],
                        normalized_statement=norm,
                    )
                    self.db.add(claim)
                    self.db.flush()
                    summary.claims_created += 1
                    self._change(
                        GraphChangeType.claim_added, node_key(NodeLabel.CLAIM, claim.id), statement=claim.statement[:200], document=batch.document.title
                    )
                else:
                    summary.claims_reused += 1
                claim_rows[rc.ref] = claim
                if claim.id not in summary.claim_ids:
                    summary.claim_ids.append(claim.id)
                    if self.db.get(InvestigationClaim, (self.inv.id, claim.id)) is None:
                        self.db.add(InvestigationClaim(investigation_id=self.inv.id, claim_id=claim.id))
                existing_quotes = set(self.db.scalars(select(Evidence.quote).where(Evidence.claim_id == claim.id)))
                for ev in rc.evidence:
                    if ev.quote in existing_quotes:
                        continue
                    chunk = batch.passages[ev.passage_ref]
                    self.db.add(
                        Evidence(
                            workspace_id=self.ws,
                            claim_id=claim.id,
                            document_id=batch.document.id,
                            quote=ev.quote,
                            locator={
                                "chunk_id": str(chunk.id),
                                "chunk_index": chunk.chunk_index,
                                "char_start": chunk.char_start,
                                "char_end": chunk.char_end,
                                "page": chunk.page,
                            },
                            stance=EvidenceStance.supports,
                        )
                    )
                    existing_quotes.add(ev.quote)
                    summary.evidence_created += 1
            self.db.flush()
            for rel in batch.output.relationships:
                src, tgt = ents.get(rel.source_entity_ref), ents.get(rel.target_entity_ref)
                if src is None or tgt is None or src.id == tgt.id:
                    continue
                rtype = RelType[rel.predicate.upper()].value
                row = self.db.scalar(
                    select(GraphRelationship).where(
                        GraphRelationship.workspace_id == self.ws,
                        GraphRelationship.source_entity_id == src.id,
                        GraphRelationship.target_entity_id == tgt.id,
                        GraphRelationship.relation_type == rtype,
                    )
                )
                if row is None:
                    rid = uuid.uuid4()
                    row = GraphRelationship(
                        id=rid,
                        workspace_id=self.ws,
                        graph_key=relationship_key(rid),
                        source_entity_id=src.id,
                        target_entity_id=tgt.id,
                        relation_type=rtype,
                        status=RelationshipStatus.extracted,
                        properties={},
                        support_count=0,
                        first_seen_at=now,
                    )
                    self.db.add(row)
                    self.db.flush()
                    summary.relationships_created += 1
                    self._change(GraphChangeType.relationship_created, row.graph_key, source=src.name, target=tgt.name, type=rtype)
                else:
                    summary.relationships_reinforced += 1
                    self._change(GraphChangeType.relationship_reinforced, row.graph_key, source=src.name, target=tgt.name, type=rtype)
                linked = set(self.db.scalars(select(RelationshipClaim.claim_id).where(RelationshipClaim.relationship_id == row.id)))
                for ref in rel.claim_refs:
                    cl = claim_rows.get(ref)
                    if cl and cl.id not in linked:
                        self.db.add(RelationshipClaim(relationship_id=row.id, claim_id=cl.id))
                        linked.add(cl.id)
                row.support_count = len(linked)
                row.last_seen_at = now
                row.confidence = min(0.95, 0.4 + 0.15 * len(linked))
                if row.id not in summary.relationship_ids:
                    summary.relationship_ids.append(row.id)
        self.db.flush()
        return summary


# ---------------------------------------------------------------------- graph sync


def sync_investigation_graph(db: Session, repo, investigation: Investigation) -> dict:  # noqa: ANN001 — GraphRepository
    """Mirrors this investigation's knowledge into Neo4j in one transaction. Idempotent (MERGE on keys).

    Returns counts; raises GraphError on failure (caller records the step as failed or degraded).
    """
    ws = str(investigation.workspace_id)
    now = datetime.now(UTC)
    claims = list(db.scalars(select(Claim).where(Claim.id.in_(investigation_claim_ids(investigation.id)))))
    claim_ids = [cl.id for cl in claims]
    evidence = list(db.scalars(select(Evidence).where(Evidence.claim_id.in_(claim_ids)))) if claim_ids else []
    doc_ids = {cl.document_id for cl in claims}
    docs = {d.id: d for d in db.scalars(select(Document).where(Document.id.in_(doc_ids)))} if doc_ids else {}
    sources = {s.id: s for s in db.scalars(select(Source).where(Source.id.in_({d.source_id for d in docs.values()})))} if docs else {}
    rel_ids = set(db.scalars(select(RelationshipClaim.relationship_id).where(RelationshipClaim.claim_id.in_(claim_ids)))) if claim_ids else set()
    rels = list(db.scalars(select(GraphRelationship).where(GraphRelationship.id.in_(rel_ids)))) if rel_ids else []
    entity_ids = {cl.subject_entity_id for cl in claims if cl.subject_entity_id} | {r.source_entity_id for r in rels} | {r.target_entity_id for r in rels}
    entities = {e.id: e for e in db.scalars(select(GraphEntity).where(GraphEntity.id.in_(entity_ids)))} if entity_ids else {}
    hyps = list(db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == investigation.id)))
    contradictions = list(db.scalars(select(Contradiction).where(Contradiction.investigation_id == investigation.id)))
    counts = {"nodes": 0, "relationships": 0}
    inv_key = node_key(NodeLabel.INVESTIGATION, investigation.id)

    with repo.transaction() as tx:
        tx.upsert_node(ws, NodeLabel.INVESTIGATION, inv_key, {"title": investigation.title, "question": investigation.question[:1000]})
        counts["nodes"] += 1
        for s in sources.values():
            tx.upsert_node(ws, NodeLabel.SOURCE, node_key(NodeLabel.SOURCE, s.id), {"title": s.title, "source_type": s.source_type.value})
        for d in docs.values():
            dk = node_key(NodeLabel.DOCUMENT, d.id)
            sk = node_key(NodeLabel.SOURCE, d.source_id)
            tx.upsert_node(ws, NodeLabel.DOCUMENT, dk, {"title": d.title, "media_type": d.media_type})
            tx.upsert_relationship(ws, RelType.FROM_SOURCE, link_key(RelType.FROM_SOURCE, dk, sk), dk, sk)
        counts["nodes"] += len(sources) + len(docs)
        counts["relationships"] += len(docs)
        for e in entities.values():
            tx.upsert_node(
                ws, NodeLabel.ENTITY, e.graph_key, {"name": e.name, "entity_type": e.entity_type, "mention_count": e.mention_count, "aliases": e.aliases}
            )
            e.graph_synced_at = now
        counts["nodes"] += len(entities)
        for cl in claims:
            ck = node_key(NodeLabel.CLAIM, cl.id)
            tx.upsert_node(ws, NodeLabel.CLAIM, ck, {"statement": cl.statement[:1000], "kind": cl.kind.value, "temporal_scope": cl.temporal_scope})
            tx.upsert_relationship(ws, RelType.FOUND, link_key(RelType.FOUND, inv_key, ck), inv_key, ck)
            if cl.subject_entity_id in entities:
                ek = entities[cl.subject_entity_id].graph_key
                tx.upsert_relationship(ws, RelType.ABOUT, link_key(RelType.ABOUT, ck, ek), ck, ek)
                counts["relationships"] += 1
            cl.graph_synced_at = now
            counts["nodes"] += 1
            counts["relationships"] += 1
        for ev in evidence:
            ck, dk = node_key(NodeLabel.CLAIM, ev.claim_id), node_key(NodeLabel.DOCUMENT, ev.document_id)
            key = link_key(RelType.EVIDENCED_BY, ck, f"{dk}|{ev.id}")
            tx.upsert_relationship(
                ws, RelType.EVIDENCED_BY, key, ck, dk, {"quote": ev.quote[:1000], "chunk_index": ev.locator.get("chunk_index"), "page": ev.locator.get("page")}
            )
            counts["relationships"] += 1
        for r in rels:
            src, tgt = entities.get(r.source_entity_id), entities.get(r.target_entity_id)
            if src is None or tgt is None:
                continue
            supporting = [str(x) for x in db.scalars(select(RelationshipClaim.claim_id).where(RelationshipClaim.relationship_id == r.id))]
            tx.upsert_relationship(
                ws,
                RelType(r.relation_type),
                r.graph_key,
                src.graph_key,
                tgt.graph_key,
                {"support_count": r.support_count, "claim_ids": supporting, "confidence": r.confidence},
            )
            r.graph_synced_at = now
            counts["relationships"] += 1
        for h in hyps:
            hk = node_key(NodeLabel.HYPOTHESIS, h.id)
            tx.upsert_node(ws, NodeLabel.HYPOTHESIS, hk, {"statement": h.statement[:1000], "status": h.status.value, "confidence": h.confidence})
            tx.upsert_relationship(ws, RelType.PROPOSED, link_key(RelType.PROPOSED, inv_key, hk), inv_key, hk)
            counts["nodes"] += 1
            counts["relationships"] += 1
            links = db.execute(
                select(HypothesisEvidence.stance, Evidence.claim_id)
                .join(Evidence, Evidence.id == HypothesisEvidence.evidence_id)
                .where(HypothesisEvidence.hypothesis_id == h.id)
            )
            for stance, claim_id in {(s, cid) for s, cid in links}:
                rt = RelType.SUPPORTED_BY if stance == EvidenceStance.supports else RelType.OPPOSED_BY
                ck = node_key(NodeLabel.CLAIM, claim_id)
                tx.upsert_relationship(ws, rt, link_key(rt, hk, ck), hk, ck)
                counts["relationships"] += 1
        for x in contradictions:
            a, b = node_key(NodeLabel.CLAIM, x.claim_a_id), node_key(NodeLabel.CLAIM, x.claim_b_id)
            tx.upsert_relationship(
                ws,
                RelType.CONTRADICTS,
                relationship_key(x.id),
                a,
                b,
                {"kind": x.kind.value, "is_genuine": x.is_genuine, "severity": x.severity, "explanation": x.explanation[:500]},
            )
            counts["relationships"] += 1
    db.flush()
    return counts


def consistency_report(db: Session, repo, workspace_id: uuid.UUID) -> dict:  # noqa: ANN001
    """Compares the PostgreSQL registry with Neo4j for a workspace."""
    ws = str(workspace_id)
    pg_entities = {e.graph_key for e in db.scalars(select(GraphEntity).where(GraphEntity.workspace_id == workspace_id, GraphEntity.merged_into_id.is_(None)))}
    pg_rels = set(db.scalars(select(GraphRelationship.graph_key).where(GraphRelationship.workspace_id == workspace_id)))
    pg_claims = {
        node_key(NodeLabel.CLAIM, cid) for cid in db.scalars(select(Claim.id).where(Claim.workspace_id == workspace_id, Claim.investigation_id.is_not(None)))
    }
    unsynced = (
        db.scalar(select(func.count()).select_from(GraphEntity).where(GraphEntity.workspace_id == workspace_id, GraphEntity.graph_synced_at.is_(None))) or 0
    )
    neo_entities = set(repo.keys(ws, NodeLabel.ENTITY))
    neo_claims = set(repo.keys(ws, NodeLabel.CLAIM))
    neo_rels = set(repo.relationship_keys(ws, [r for r in RelType if r.value in {p.upper() for p in c.Predicate.__args__}]))
    return {
        "entities": {
            "postgres": len(pg_entities),
            "neo4j": len(neo_entities),
            "missing_in_neo4j": sorted(pg_entities - neo_entities)[:50],
            "orphaned_in_neo4j": sorted(neo_entities - pg_entities)[:50],
        },
        "claims": {"postgres": len(pg_claims), "neo4j": len(neo_claims), "missing_in_neo4j": sorted(pg_claims - neo_claims)[:50]},
        "relationships": {
            "postgres": len(pg_rels),
            "neo4j": len(neo_rels),
            "missing_in_neo4j": sorted(pg_rels - neo_rels)[:50],
            "orphaned_in_neo4j": sorted(neo_rels - pg_rels)[:50],
        },
        "entities_never_synced": unsynced,
        "consistent": pg_entities == neo_entities and pg_rels == neo_rels and pg_claims <= neo_claims,
    }
