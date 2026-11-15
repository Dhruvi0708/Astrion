"""Evaluation metrics. Every metric is computed from stored records against gold annotations, and
every score comes with the counts it was derived from."""

import uuid
from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.intelligence.retrieval import jaccard
from app.models import (
    AgentExecution,
    Claim,
    Contradiction,
    Evidence,
    GraphEntity,
    GraphRelationship,
    Hypothesis,
    Investigation,
    InvestigationReport,
    InvestigationRun,
    RelationshipClaim,
)
from app.models.enums import AgentRole, ExecutionStatus

FACT_MATCH = 0.6


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def _ratio(n: int, d: int) -> float | None:
    return round(n / d, 4) if d else None


def compute(db: Session, ws: uuid.UUID, invs: list[Investigation], dataset: dict, texts: dict[str, str]) -> dict:
    gold = dataset["gold"]
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ws)))
    evidence = list(db.scalars(select(Evidence).where(Evidence.workspace_id == ws)))
    entities = list(db.scalars(select(GraphEntity).where(GraphEntity.workspace_id == ws, GraphEntity.merged_into_id.is_(None))))
    rels = list(db.scalars(select(GraphRelationship).where(GraphRelationship.workspace_id == ws)))
    hyps = list(db.scalars(select(Hypothesis).where(Hypothesis.workspace_id == ws)))
    cons = list(db.scalars(select(Contradiction).where(Contradiction.workspace_id == ws)))
    execs = list(db.scalars(select(AgentExecution).where(AgentExecution.workspace_id == ws)))
    doc_text = {}
    from app.models import Document

    for d in db.scalars(select(Document).where(Document.workspace_id == ws)):
        doc_text[d.id] = _norm(texts.get(d.title, ""))

    # 1. Evidence coverage: gold facts captured by a claim with evidence.
    statements = [cl.statement for cl in claims]
    covered = [f["id"] for f in gold.get("facts", []) if any(jaccard(f["text"], s) >= FACT_MATCH for s in statements)]
    evidence_coverage = {"score": _ratio(len(covered), len(gold.get("facts", []))), "covered": covered, "total": len(gold.get("facts", []))}

    # 2. Claim support: every evidence quote must be verbatim in its document.
    by_claim = defaultdict(list)
    for e in evidence:
        by_claim[e.claim_id].append(e)
    supported = sum(1 for cl in claims if by_claim[cl.id] and all(_norm(e.quote) in doc_text.get(e.document_id, "") for e in by_claim[cl.id]))
    claim_support = {"score": _ratio(supported, len(claims)), "claims": len(claims), "verbatim_supported": supported}

    # 3. Entity resolution: each gold concept should map to one entity, never to duplicates.
    norm_names = Counter(e.normalized_name for e in entities)
    clusters = []
    for g in gold.get("entities", []):
        aliases = [a.lower() for a in g["aliases"]]
        matched = [e.name for e in entities if any(a == (e.normalized_name or "") or a in (e.normalized_name or "").split() for a in aliases)]
        clusters.append({"gold": g["name"], "entities": sorted(matched), "found": bool(matched), "fragmented": len(matched) > 1})
    entity_resolution = {
        "found": _ratio(sum(c["found"] for c in clusters), len(clusters)),
        "fragmentation_rate": _ratio(sum(c["fragmented"] for c in clusters), sum(c["found"] for c in clusters)),
        "exact_duplicates": sum(n - 1 for n in norm_names.values() if n > 1),
        "clusters": clusters,
    }

    # 4. Contradiction detection against gold conflict pairs.
    def pair_match(x: Contradiction, g: dict) -> bool:
        a, b = db.get(Claim, x.claim_a_id).statement.lower(), db.get(Claim, x.claim_b_id).statement.lower()
        return (g["a"].lower() in a and g["b"].lower() in b) or (g["a"].lower() in b and g["b"].lower() in a)

    gold_pairs = gold.get("contradictions", [])
    detected = [g for g in gold_pairs if any(pair_match(x, g) for x in cons)]
    correct_resolution = [g for g in detected if g.get("resolution") is None or any(pair_match(x, g) and x.resolution_kind == g["resolution"] for x in cons)]
    genuine = [x for x in cons if x.is_genuine]
    matched_genuine = [x for x in genuine if any(pair_match(x, g) for g in gold_pairs)]
    contradiction_detection = {
        "recall": _ratio(len(detected), len(gold_pairs)),
        "precision_genuine": _ratio(len(matched_genuine), len(genuine)),
        "resolution_accuracy": _ratio(len(correct_resolution), len(detected)),
        "detected": len(cons),
        "genuine": len(genuine),
    }

    # Temporal: gold supersessions.
    sup_hits = 0
    for g in gold.get("superseded", []):
        if any(cl.superseded_by_id and g["old"] in cl.statement and g["new"] in db.get(Claim, cl.superseded_by_id).statement for cl in claims):
            sup_hits += 1
    temporal = {"supersession_recall": _ratio(sup_hits, len(gold.get("superseded", []))), "dated_claims": sum(1 for cl in claims if cl.valid_from_year)}

    # 5. Hypothesis quality (structural; reasoning quality needs a real model and human review).
    from app.models import HypothesisEvidence
    from app.models.enums import EvidenceStance

    causal_claims = {
        cid
        for (cid,) in db.execute(
            select(RelationshipClaim.claim_id)
            .join(GraphRelationship, GraphRelationship.id == RelationshipClaim.relationship_id)
            .where(GraphRelationship.workspace_id == ws, GraphRelationship.relation_type.in_(["CAUSES", "INFLUENCES"]))
        )
    }
    causal = [h for h in hyps if h.reasoning_type == "causation"]
    causal_backed = 0
    for h in causal:
        sup = set(
            db.scalars(
                select(Evidence.claim_id)
                .join(HypothesisEvidence, HypothesisEvidence.evidence_id == Evidence.id)
                .where(HypothesisEvidence.hypothesis_id == h.id, HypothesisEvidence.stance == EvidenceStance.supports)
            )
        )
        causal_backed += 1 if sup & causal_claims else 0
    hypothesis_quality = {
        "causation_backed_by_causal_claims": _ratio(causal_backed, len(causal)),
        "count": len(hyps),
        "with_support": _ratio(sum(1 for h in hyps if (h.confidence_method or {}).get("inputs", {}).get("supporting_claims", 0) > 0), len(hyps)),
        "with_falsification": _ratio(sum(1 for h in hyps if h.falsification_conditions), len(hyps)),
        "reasoning_types": dict(Counter(h.reasoning_type for h in hyps)),
        "downgraded_by_guard": sum(1 for h in hyps if (h.debate or {}).get("reasoning_check")),
        "consensus": dict(Counter(h.consensus for h in hyps)),
        "mean_confidence": round(sum(h.confidence or 0 for h in hyps) / len(hyps), 4) if hyps else None,
    }

    # 6. Graph consistency (registry invariants).
    rel_with_claims = {r for (r,) in db.execute(select(RelationshipClaim.relationship_id))}
    used_entities = {cl.subject_entity_id for cl in claims if cl.subject_entity_id} | {r.source_entity_id for r in rels} | {r.target_entity_id for r in rels}
    graph_consistency = {
        "relationships_with_claims": _ratio(sum(1 for r in rels if r.id in rel_with_claims), len(rels)),
        "orphan_entities": sum(1 for e in entities if e.id not in used_entities),
        "claims_with_evidence": _ratio(sum(1 for cl in claims if by_claim[cl.id]), len(claims)),
        "consistent": all(r.id in rel_with_claims for r in rels) and all(e.id in used_entities for e in entities) and all(by_claim[cl.id] for cl in claims),
    }

    # 7. Agent reliability per role.
    roles = defaultdict(lambda: Counter())
    for e in execs:
        if e.agent_role == AgentRole.system:
            continue
        r = roles[e.agent_role.value]
        r["executions"] += 1
        r[e.status.value] += 1
        r["retries"] += 1 if e.attempt > 1 else 0
        r["validation_notes"] += len((e.output or {}).get("notes", []) or [])
    agent_reliability = {
        role: {**dict(c), "success_rate": _ratio(c[ExecutionStatus.succeeded.value], c["executions"] - c[ExecutionStatus.skipped.value])}
        for role, c in sorted(roles.items())
    }

    # 8. Investigation quality.
    quality = []
    for inv in invs:
        rep = db.scalar(select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id).order_by(InvestigationReport.run_number.desc()))
        run = db.scalar(select(InvestigationRun).where(InvestigationRun.investigation_id == inv.id))
        content = rep.content if rep else {}
        findings = content.get("key_findings", [])
        cited = [f for f in findings if f.get("claim_refs") and all(r in content.get("citations", {}) for r in f["claim_refs"])]
        quality.append(
            {
                "title": inv.title,
                "status": inv.status.value,
                "answer_status": content.get("answer_status"),
                "findings": len(findings),
                "cited_findings": _ratio(len(cited), len(findings)),
                "unresolved_questions": len(content.get("unresolved_questions", [])),
                "iterations": run.iterations if run else None,
                "stop_reason": run.stop_reason if run else None,
                "usage": run.usage if run else None,
                "recommendations": len(run.recommendations) if run else 0,
            }
        )
    return {
        "evidence_coverage": evidence_coverage,
        "claim_support": claim_support,
        "entity_resolution": entity_resolution,
        "contradiction_detection": contradiction_detection,
        "temporal": temporal,
        "hypothesis_quality": hypothesis_quality,
        "graph_consistency": graph_consistency,
        "agent_reliability": agent_reliability,
        "investigation_quality": quality,
    }
