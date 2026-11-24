"""Investigation use-cases. Every function is scoped to the authenticated user via workspace ownership."""

import uuid
from collections import defaultdict

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError, ConflictError, NotFoundError
from app.models import (
    AgentExecution,
    Claim,
    Contradiction,
    Document,
    Evidence,
    GraphChange,
    GraphEntity,
    Hypothesis,
    Investigation,
    InvestigationReport,
    Source,
    User,
    VerificationResult,
    Workspace,
)
from app.models.enums import AgentRole, ExecutionStatus, InvestigationStatus
from app.models.knowledge import InvestigationClaim, investigation_claim_ids
from app.schemas.investigation import InvestigationCreate, InvestigationDetail, InvestigationRead, StageProgress
from app.services.workspaces import get_owned_workspace

STARTABLE = {
    InvestigationStatus.draft,
    InvestigationStatus.completed,
    InvestigationStatus.failed,
    InvestigationStatus.cancelled,
    InvestigationStatus.interrupted,
}
RESUMABLE = {InvestigationStatus.interrupted, InvestigationStatus.failed}
ACTIVE = {InvestigationStatus.queued, InvestigationStatus.running, InvestigationStatus.cancelling}

STAGES: list[tuple[str, AgentRole]] = [
    ("ingest", AgentRole.system),
    ("memory", AgentRole.system),
    ("orchestrator", AgentRole.orchestrator),
    ("research", AgentRole.research),
    ("knowledge", AgentRole.knowledge),
    ("graph_sync:knowledge", AgentRole.system),
    ("assess", AgentRole.system),
    ("planner", AgentRole.planner),
    ("temporal", AgentRole.system),
    ("sources", AgentRole.system),
    ("hypothesis", AgentRole.hypothesis),
    ("contradiction", AgentRole.contradiction),
    ("debate", AgentRole.challenger),
    ("verification", AgentRole.verification),
    ("synthesis", AgentRole.synthesis),
    ("graph_sync:final", AgentRole.system),
    ("next_steps", AgentRole.system),
]
# Stages that only run when needed (the planner when there is a real choice; the debate when there are
# hypotheses and budget). They are listed only when they actually ran, never shown as "pending".
OPTIONAL_STAGES = {"planner", "debate"}


class ProviderUnavailable(AppError):
    status_code = 503
    code = "llm_unavailable"


class TooManyActive(AppError):
    status_code = 429
    code = "too_many_active_investigations"


def _check_user_capacity(db: Session, user: User) -> None:
    """Each user may have only a few runs in flight (protects the shared runner and the model budget)."""
    from app.core.config import get_settings
    from app.models import Workspace

    limit = get_settings().max_active_investigations_per_user
    active = (
        db.scalar(
            select(func.count())
            .select_from(Investigation)
            .join(Workspace, Workspace.id == Investigation.workspace_id)
            .where(Workspace.owner_id == user.id, Investigation.status.in_(list(ACTIVE)))
        )
        or 0
    )
    if active >= limit:
        raise TooManyActive(f"You already have {active} investigation(s) running (limit {limit}). Wait for one to finish or cancel it.")


def _read(inv: Investigation) -> InvestigationRead:
    return InvestigationRead.model_validate(inv).model_copy(update={"document_ids": [str(d) for d in inv.document_ids]})


def get_owned_investigation(db: Session, user: User, investigation_id: uuid.UUID) -> Investigation:
    inv = db.scalar(
        select(Investigation)
        .join(Workspace, Workspace.id == Investigation.workspace_id)
        .where(Investigation.id == investigation_id, Workspace.owner_id == user.id)
    )
    if inv is None:
        raise NotFoundError(f"Investigation {investigation_id} was not found.")
    return inv


def create(db: Session, user: User, workspace_id: uuid.UUID, payload: InvestigationCreate) -> InvestigationRead:
    ws = get_owned_workspace(db, user, workspace_id)
    if payload.document_ids:
        found = set(db.scalars(select(Document.id).where(Document.workspace_id == ws.id, Document.id.in_(payload.document_ids))))
        missing = [str(d) for d in payload.document_ids if d not in found]
        if missing:  # never accept documents from another workspace (or another user)
            raise NotFoundError("Some selected documents were not found in this workspace.", details={"document_ids": missing})
    inv = Investigation(
        workspace_id=ws.id,
        created_by_id=user.id,
        title=payload.title,
        question=payload.question,
        document_ids=[str(d) for d in dict.fromkeys(payload.document_ids)],
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _read(inv)


def list_for_workspace(
    db: Session, user: User, workspace_id: uuid.UUID, limit: int, offset: int, status: str | None = None, q: str | None = None
) -> tuple[list[InvestigationRead], int]:
    get_owned_workspace(db, user, workspace_id)
    where = [Investigation.workspace_id == workspace_id]
    if status == "active":
        where.append(Investigation.status.in_(list(ACTIVE)))
    elif status:
        where.append(Investigation.status == status)
    if q:
        like = f"%{q.lower()}%"
        where.append(func.lower(Investigation.title).like(like) | func.lower(Investigation.question).like(like))
    total = db.scalar(select(func.count()).select_from(Investigation).where(*where)) or 0
    rows = db.scalars(select(Investigation).where(*where).order_by(Investigation.created_at.desc(), Investigation.id).limit(limit).offset(offset))
    return [_read(r) for r in rows], total


def progress(db: Session, inv: Investigation) -> list[StageProgress]:
    prefix = f"r{inv.run_count}:"
    rows = list(
        db.scalars(
            select(AgentExecution)
            .where(AgentExecution.investigation_id == inv.id, AgentExecution.step_key.like(f"{prefix}%"))
            .order_by(AgentExecution.created_at)
        )
    )
    latest: dict[str, AgentExecution] = {}
    for r in rows:
        key = r.step_key[len(prefix) :]
        if key not in latest or r.attempt >= latest[key].attempt:
            latest[key] = r
    out = []
    for stage, role in STAGES:
        group = [r for k, r in latest.items() if k == stage or k.startswith(f"{stage}:")]
        if not group and stage in OPTIONAL_STAGES:
            continue
        statuses = [r.status for r in group]
        if not group:
            status = "pending"
        elif ExecutionStatus.failed in statuses:
            status = "failed"
        elif ExecutionStatus.running in statuses:
            status = "running"
        elif ExecutionStatus.cancelled in statuses:
            status = "cancelled"
        elif all(s == ExecutionStatus.skipped for s in statuses):
            status = "skipped"
        else:
            status = "succeeded"
        main = next((r for r in group if r.step_key.endswith(f":{stage}")), group[-1] if group else None)
        out.append(
            StageProgress(
                stage=stage,
                role=role,
                status=status,
                steps=len(group),
                succeeded=sum(1 for s in statuses if s == ExecutionStatus.succeeded),
                failed=sum(1 for s in statuses if s == ExecutionStatus.failed),
                summary=main.summary or main.error if main else None,
            )
        )
    return out


def detail(db: Session, user: User, investigation_id: uuid.UUID) -> InvestigationDetail:
    inv = get_owned_investigation(db, user, investigation_id)
    counts = {
        "claims": db.scalar(select(func.count()).select_from(InvestigationClaim).where(InvestigationClaim.investigation_id == inv.id)) or 0,
        "hypotheses": db.scalar(select(func.count()).select_from(Hypothesis).where(Hypothesis.investigation_id == inv.id)) or 0,
        "contradictions": db.scalar(select(func.count()).select_from(Contradiction).where(Contradiction.investigation_id == inv.id)) or 0,
        "verifications": db.scalar(select(func.count()).select_from(VerificationResult).where(VerificationResult.investigation_id == inv.id)) or 0,
        "reports": db.scalar(select(func.count()).select_from(InvestigationReport).where(InvestigationReport.investigation_id == inv.id)) or 0,
        "graph_changes": db.scalar(select(func.count()).select_from(GraphChange).where(GraphChange.investigation_id == inv.id)) or 0,
        "executions": db.scalar(select(func.count()).select_from(AgentExecution).where(AgentExecution.investigation_id == inv.id)) or 0,
    }
    base = _read(inv).model_dump()
    return InvestigationDetail(
        **base,
        plan=inv.plan,
        progress=progress(db, inv) if inv.run_count else [],
        counts=counts,
        can_start=inv.status in STARTABLE,
        can_resume=inv.status in RESUMABLE and inv.run_count > 0,
        can_cancel=inv.status in ACTIVE,
    )


def _transition(db: Session, inv: Investigation, allowed: set[InvestigationStatus], new_run: bool) -> None:
    """Atomic compare-and-set so two concurrent start requests can't both launch a run."""
    values: dict = {"status": InvestigationStatus.queued, "cancel_requested": False, "error": None, "finished_at": None}
    if new_run:
        values |= {"run_count": inv.run_count + 1, "started_at": None, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    result = db.execute(update(Investigation).where(Investigation.id == inv.id, Investigation.status.in_(list(allowed))).values(**values))
    db.commit()
    if result.rowcount != 1:
        db.refresh(inv)
        raise ConflictError(f"Investigation is {inv.status.value}; it can't be {'started' if new_run else 'resumed'} now.")
    db.refresh(inv)


def start(db: Session, user: User, investigation_id: uuid.UUID, llm_available: bool) -> Investigation:
    inv = get_owned_investigation(db, user, investigation_id)
    if not llm_available:
        raise ProviderUnavailable(
            "No LLM provider is configured. Set ANTHROPIC_API_KEY on the server (or ASTRION_LLM_PROVIDER=fixture for offline development)."
        )
    _check_user_capacity(db, user)
    _transition(db, inv, STARTABLE, new_run=True)
    return inv


def resume(db: Session, user: User, investigation_id: uuid.UUID, llm_available: bool) -> Investigation:
    inv = get_owned_investigation(db, user, investigation_id)
    if not llm_available:
        raise ProviderUnavailable("No LLM provider is configured.")
    if inv.run_count == 0:
        raise ConflictError("This investigation has never run; start it instead.")
    _check_user_capacity(db, user)
    _transition(db, inv, RESUMABLE, new_run=False)
    return inv


def cancel(db: Session, user: User, investigation_id: uuid.UUID) -> Investigation:
    inv = get_owned_investigation(db, user, investigation_id)
    if inv.status not in ACTIVE:
        raise ConflictError(f"Investigation is {inv.status.value}; there is nothing to cancel.")
    # A queued run that hasn't started is cancelled immediately; a running one stops at the next step.
    db.execute(
        update(Investigation).where(Investigation.id == inv.id, Investigation.status == InvestigationStatus.queued).values(status=InvestigationStatus.cancelled)
    )
    db.execute(
        update(Investigation)
        .where(Investigation.id == inv.id, Investigation.status == InvestigationStatus.running)
        .values(status=InvestigationStatus.cancelling)
    )
    db.execute(update(Investigation).where(Investigation.id == inv.id).values(cancel_requested=True))
    db.commit()
    db.refresh(inv)
    return inv


def executions(db: Session, user: User, investigation_id: uuid.UUID) -> list[AgentExecution]:
    inv = get_owned_investigation(db, user, investigation_id)
    return list(db.scalars(select(AgentExecution).where(AgentExecution.investigation_id == inv.id).order_by(AgentExecution.created_at, AgentExecution.attempt)))


def _claim_payload(db: Session, claim: Claim) -> dict:
    doc = db.get(Document, claim.document_id)
    src = db.get(Source, doc.source_id) if doc else None
    subject = db.get(GraphEntity, claim.subject_entity_id) if claim.subject_entity_id else None
    return {
        "id": str(claim.id),
        "statement": claim.statement,
        "kind": claim.kind.value,
        "confidence": claim.confidence,
        "temporal_scope": claim.temporal_scope,
        "extractor": claim.extractor,
        "subject": {"id": str(subject.id), "name": subject.name, "entity_type": subject.entity_type} if subject else None,
        "document": {"id": str(doc.id), "title": doc.title} if doc else None,
        "source": {"id": str(src.id), "title": src.title, "uri": src.uri} if src else None,
        "evidence": [
            {"id": str(e.id), "quote": e.quote, "locator": e.locator, "stance": e.stance.value}
            for e in db.scalars(select(Evidence).where(Evidence.claim_id == claim.id))
        ],
        "investigation_id": str(claim.investigation_id) if claim.investigation_id else None,
        "created_at": claim.created_at.isoformat(),
        "valid_from_year": claim.valid_from_year,
        "valid_to_year": claim.valid_to_year,
        "superseded_by_id": str(claim.superseded_by_id) if claim.superseded_by_id else None,
    }


def claims(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    inv = get_owned_investigation(db, user, investigation_id)
    return [
        _claim_payload(db, cl)
        for cl in db.scalars(select(Claim).where(Claim.id.in_(investigation_claim_ids(inv.id))).order_by(Claim.created_at, Claim.normalized_statement))
    ]


def hypotheses(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    from app.models import HypothesisEvidence

    inv = get_owned_investigation(db, user, investigation_id)
    out = []
    for h in db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == inv.id).order_by(Hypothesis.created_at)):
        links = db.execute(
            select(HypothesisEvidence.stance, Evidence.claim_id)
            .join(Evidence, Evidence.id == HypothesisEvidence.evidence_id)
            .where(HypothesisEvidence.hypothesis_id == h.id)
        )
        sup, opp = set(), set()
        for stance, cid in links:
            (sup if stance.value == "supports" else opp).add(str(cid))
        verdict = db.scalar(select(VerificationResult).where(VerificationResult.target_id == h.id).order_by(VerificationResult.created_at.desc()))
        out.append(
            {
                "id": str(h.id),
                "statement": h.statement,
                "rationale": h.rationale,
                "test_plan": h.test_plan,
                "origin": h.origin.value,
                "status": h.status.value,
                "confidence": h.confidence,
                "confidence_method": h.confidence_method,
                "supporting_claim_ids": sorted(sup),
                "opposing_claim_ids": sorted(opp),
                "verification": _verification_payload(verdict) if verdict else None,
                "generated_by_execution_id": str(h.generated_by_execution_id) if h.generated_by_execution_id else None,
                "reasoning_type": h.reasoning_type,
                "assumptions": h.assumptions or [],
                "falsification_conditions": h.falsification_conditions or [],
                "consensus": h.consensus,
                "debate": h.debate or {},
                "revises_hypothesis_id": str(h.revises_hypothesis_id) if h.revises_hypothesis_id else None,
            }
        )
    return out


def _verification_payload(v: VerificationResult) -> dict:
    return {
        "id": str(v.id),
        "target_type": v.target_type,
        "target_id": str(v.target_id),
        "verdict": v.verdict.value,
        "reasoning": v.reasoning,
        "issues": v.issues,
        "missing_evidence": v.missing_evidence,
        "unsupported_claim_ids": v.checked_claim_ids,
        "execution_id": str(v.execution_id) if v.execution_id else None,
    }


def contradictions(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    inv = get_owned_investigation(db, user, investigation_id)
    out = []
    for x in db.scalars(select(Contradiction).where(Contradiction.investigation_id == inv.id).order_by(Contradiction.created_at)):
        verdict = db.scalar(select(VerificationResult).where(VerificationResult.target_id == x.id).order_by(VerificationResult.created_at.desc()))
        out.append(
            {
                "id": str(x.id),
                "kind": x.kind.value,
                "is_genuine": x.is_genuine,
                "severity": x.severity,
                "explanation": x.explanation,
                "claim_a": _claim_payload(db, db.get(Claim, x.claim_a_id)),
                "claim_b": _claim_payload(db, db.get(Claim, x.claim_b_id)),
                "resolution_kind": x.resolution_kind,
                "resolution": x.resolution,
                "verification": _verification_payload(verdict) if verdict else None,
            }
        )
    return out


def verifications(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    inv = get_owned_investigation(db, user, investigation_id)
    return [
        _verification_payload(v)
        for v in db.scalars(select(VerificationResult).where(VerificationResult.investigation_id == inv.id).order_by(VerificationResult.created_at))
    ]


def reports(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    inv = get_owned_investigation(db, user, investigation_id)
    return [
        {"id": str(r.id), "run_number": r.run_number, "provider": r.provider, "model": r.model, "created_at": r.created_at.isoformat(), "content": r.content}
        for r in db.scalars(select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id).order_by(InvestigationReport.run_number.desc()))
    ]


def graph_changes(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    inv = get_owned_investigation(db, user, investigation_id)
    return [
        {"id": str(g.id), "change_type": g.change_type.value, "target_key": g.target_key, "details": g.details, "created_at": g.created_at.isoformat()}
        for g in db.scalars(select(GraphChange).where(GraphChange.investigation_id == inv.id).order_by(GraphChange.created_at, GraphChange.id))
    ]


def compare(db: Session, user: User, workspace_id: uuid.UUID, ids: list[uuid.UUID]) -> dict:
    """Findings side by side: shared entities, overlapping documents, hypotheses and report status."""
    get_owned_workspace(db, user, workspace_id)
    invs = [get_owned_investigation(db, user, i) for i in ids]
    if any(i.workspace_id != workspace_id for i in invs):
        raise NotFoundError("Investigations must belong to this workspace.")
    entities_by_inv: dict[str, set[str]] = defaultdict(set)
    names: dict[str, str] = {}
    out_invs = []
    for inv in invs:
        for cl in db.scalars(select(Claim).where(Claim.id.in_(investigation_claim_ids(inv.id)), Claim.subject_entity_id.is_not(None))):
            ent = db.get(GraphEntity, cl.subject_entity_id)
            if ent:
                entities_by_inv[str(inv.id)].add(str(ent.id))
                names[str(ent.id)] = ent.name
        latest = db.scalar(select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id).order_by(InvestigationReport.run_number.desc()))
        out_invs.append(
            {
                "id": str(inv.id),
                "title": inv.title,
                "status": inv.status.value,
                "answer_status": latest.content.get("answer_status") if latest else None,
                "hypotheses": [
                    {"id": str(h.id), "statement": h.statement, "status": h.status.value, "confidence": h.confidence}
                    for h in db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == inv.id))
                ],
                "entity_count": len(entities_by_inv[str(inv.id)]),
            }
        )
    sets = [entities_by_inv[str(i.id)] for i in invs]
    shared = set.intersection(*sets) if sets else set()
    return {
        "investigations": out_invs,
        "shared_entities": [{"id": e, "name": names[e]} for e in sorted(shared, key=lambda e: names[e])],
        "evolution": compare_diff(db, user, workspace_id, ids),
    }


# --------------------------------------------------------------------------- Phase 3


def runs(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    from app.models import InvestigationRun

    inv = get_owned_investigation(db, user, investigation_id)
    return [
        {
            "run_number": r.run_number,
            "status": r.status,
            "provider": r.provider,
            "model": r.model,
            "budget": r.budget,
            "usage": r.usage,
            "iterations": r.iterations,
            "stop_reason": r.stop_reason,
            "plan_history": r.plan_history,
            "recommendations": r.recommendations,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in db.scalars(select(InvestigationRun).where(InvestigationRun.investigation_id == inv.id).order_by(InvestigationRun.run_number.desc()))
    ]


def assessments(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    """Exploration decisions (coverage, scored candidates, stop reason) for the latest run."""
    inv = get_owned_investigation(db, user, investigation_id)
    rows = db.scalars(
        select(AgentExecution)
        .where(AgentExecution.investigation_id == inv.id, AgentExecution.step_key.like(f"r{inv.run_count}:assess:%"))
        .order_by(AgentExecution.created_at)
    )
    return [r.output for r in rows if r.output]


def messages(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    from app.models import AgentMessage

    inv = get_owned_investigation(db, user, investigation_id)
    return [
        {
            "id": str(m.id),
            "run_number": m.run_number,
            "sender_role": m.sender_role,
            "recipient_role": m.recipient_role,
            "kind": m.kind,
            "subject_type": m.subject_type,
            "subject_id": str(m.subject_id),
            "content": m.content,
            "cited_claim_ids": m.cited_claim_ids,
            "execution_id": str(m.execution_id) if m.execution_id else None,
            "created_at": m.created_at.isoformat(),
        }
        for m in db.scalars(select(AgentMessage).where(AgentMessage.investigation_id == inv.id).order_by(AgentMessage.created_at, AgentMessage.id))
    ]


def source_assessments(db: Session, user: User, investigation_id: uuid.UUID) -> list[dict]:
    from app.models import SourceAssessment

    inv = get_owned_investigation(db, user, investigation_id)
    out = []
    for a in db.scalars(
        select(SourceAssessment)
        .where(SourceAssessment.investigation_id == inv.id, SourceAssessment.run_number == inv.run_count)
        .order_by(SourceAssessment.relevance.desc())
    ):
        src = db.get(Source, a.source_id)
        out.append(
            {
                "source": {
                    "id": str(src.id),
                    "title": src.title,
                    "source_type": src.source_type.value,
                    "uri": src.uri,
                    "published_on": src.published_on.isoformat() if src.published_on else None,
                },
                "independence_group": a.independence_group,
                "relevance": a.relevance,
                "credibility": a.credibility,
                "recency": a.recency,
                "independence": a.independence,
                "corroboration": a.corroboration,
                "details": a.details,
            }
        )
    return out


def compare_diff(db: Session, user: User, workspace_id: uuid.UUID, ids: list[uuid.UUID]) -> list[dict]:
    """Pairwise evolution between consecutive investigations (oldest first)."""
    from app.intelligence.insights import chronological, diff_investigations

    invs = chronological(get_owned_investigation(db, user, i) for i in ids)
    if any(i.workspace_id != workspace_id for i in invs):
        raise NotFoundError("Investigations must belong to this workspace.")
    return [diff_investigations(db, a, b) for a, b in zip(invs, invs[1:], strict=False)]
