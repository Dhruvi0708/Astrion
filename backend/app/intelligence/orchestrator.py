"""Durable orchestration engine for investigations.

Pipeline (one run):

    ingest ─► orchestrator ─► research[doc/part] ×N (parallel) ─► knowledge ─► graph_sync:knowledge
                                                                   └─► hypothesis ∥ contradiction (parallel)
                                                                        └─► verification ─► synthesis ─► graph_sync:final

Guarantees
* Every step is an ``agent_executions`` row with a stable ``step_key`` (``r<run>:<name>``); each retry
  is a new row (``attempt``). Provider, model, tokens, estimated cost, duration and status are recorded.
* Resume: a step that already succeeded in the current run is not executed again — its stored output is
  reused. Steps that failed or never ran are executed.
* Retries: retryable provider errors (rate limits, outages, timeouts, schema violations) are retried with
  exponential backoff up to ``ASTRION_AGENT_MAX_ATTEMPTS``. Anything else fails the step immediately.
* Cancellation is checked before every step and after every parallel completion.
* The investigation is marked ``completed`` only if every step succeeded or was legitimately skipped.
  Any failed step marks it ``failed`` (partial results are kept and the run can be resumed).
* Agents are pure; this class is the only writer to the database during a run, and it runs in a
  single thread. Parallel steps only parallelise model calls.
"""

import logging
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.ai.llm import ProviderError
from app.core.config import Settings
from app.intelligence import contracts as c
from app.intelligence.agents import AGENTS, AgentRun
from app.intelligence.confidence import ClaimWeight, hypothesis_confidence
from app.intelligence.knowledge_store import KnowledgeStore, ResearchBatch, sync_investigation_graph
from app.intelligence.llm import StructuredLLM
from app.intelligence.text import ExtractionError, chunk, extract_segments
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
    VerificationResult,
)
from app.models.enums import (
    AgentRole,
    ContradictionKind,
    DocumentProcessingStatus,
    EvidenceStance,
    ExecutionStatus,
    GraphChangeType,
    HypothesisOrigin,
    InvestigationStatus,
    VerificationStatus,
    VerificationVerdict,
)
from app.models.knowledge import investigation_claim_ids

logger = logging.getLogger("astrion.orchestrator")

VERDICT_TO_STATUS = {
    "supported": VerificationStatus.in_review,  # passed agent review; a human still has to verify
    "partially_supported": VerificationStatus.conditional,
    "contradicted": VerificationStatus.refuted,
    "unsupported": VerificationStatus.unverified,
    "insufficient_evidence": VerificationStatus.unverified,
}


class Cancelled(Exception):
    pass


class StepFailed(Exception):
    def __init__(self, step_key: str, message: str) -> None:
        super().__init__(f"{step_key}: {message}")
        self.step_key = step_key


@dataclass
class StepSpec:
    name: str
    role: AgentRole
    call: Callable[[], AgentRun]
    input: dict
    output_type: type[BaseModel]
    depends_on: list[str] = field(default_factory=list)
    summarize: Callable[[BaseModel], str] = lambda o: ""


@dataclass
class StepOutcome:
    output: BaseModel
    execution_id: uuid.UUID
    reused: bool


@dataclass
class ClaimIndex:
    """Short refs (C1…) shown to agents, mapped to claims."""

    by_ref: dict[str, Claim] = field(default_factory=dict)
    views: list[c.ClaimView] = field(default_factory=list)
    source_of: dict[str, uuid.UUID] = field(default_factory=dict)

    def ref_of(self, claim_id: uuid.UUID) -> str | None:
        return next((r for r, cl in self.by_ref.items() if cl.id == claim_id), None)


class Orchestrator:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        llm: StructuredLLM,
        settings: Settings,
        storage: Any,
        graph_repo: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.sessions = session_factory
        self.llm = llm
        self.settings = settings
        self.storage = storage
        self.graph = graph_repo
        self.sleep = sleep

    # ================================================================== entry point

    def run(self, investigation_id: uuid.UUID) -> InvestigationStatus:
        db = self.sessions()
        try:
            inv = db.get(Investigation, investigation_id)
            if inv is None or inv.status != InvestigationStatus.queued:
                return inv.status if inv else InvestigationStatus.failed
            inv.status = InvestigationStatus.running
            inv.started_at = inv.started_at or datetime.now(UTC)
            inv.error = None
            inv.llm_provider, inv.llm_model = self.llm.provider, self.llm.model
            db.commit()
            try:
                self._pipeline(db, inv)
            except Cancelled:
                self._mark_pending_cancelled(db, inv)
                inv.status = InvestigationStatus.cancelled
            except StepFailed as exc:
                inv.status = InvestigationStatus.failed
                inv.error = str(exc)[:4000]
            except Exception as exc:  # unexpected bug: never leave the run looking successful
                logger.exception("investigation crashed", extra={"investigation_id": str(inv.id)})
                db.rollback()
                inv = db.get(Investigation, investigation_id)
                inv.status = InvestigationStatus.failed
                inv.error = f"Internal error: {type(exc).__name__}: {exc}"[:4000]
            else:
                inv.status = InvestigationStatus.completed
            inv.finished_at = datetime.now(UTC)
            inv.cancel_requested = False
            db.commit()
            logger.info("investigation finished", extra={"investigation_id": str(inv.id), "status": inv.status.value})
            return inv.status
        finally:
            db.close()

    # ================================================================== pipeline

    def _pipeline(self, db: Session, inv: Investigation) -> None:
        documents = self._ingest(db, inv)
        plan = self._orchestrator_step(db, inv, documents)
        batches = self._research_steps(db, inv, plan, documents)
        self._knowledge_step(db, inv, batches)
        self._graph_sync(db, inv, "graph_sync:knowledge", depends_on=["knowledge"])
        claims = self._claim_index(db, inv)
        hyp_ids, con_ids = self._reasoning_steps(db, inv, plan, claims)
        self._verification_step(db, inv, claims, hyp_ids, con_ids)
        self._synthesis_step(db, inv, plan, claims, documents)
        self._graph_sync(db, inv, "graph_sync:final", depends_on=["synthesis"])

    # ------------------------------------------------------------------ execution bookkeeping

    def _key(self, inv: Investigation, name: str) -> str:
        return f"r{inv.run_count}:{name}"

    def _check_cancel(self, db: Session, inv: Investigation) -> None:
        db.refresh(inv, attribute_names=["cancel_requested"])
        if inv.cancel_requested:
            raise Cancelled()

    def _succeeded(self, db: Session, inv: Investigation, name: str) -> AgentExecution | None:
        return db.scalar(
            select(AgentExecution)
            .where(
                AgentExecution.investigation_id == inv.id,
                AgentExecution.step_key == self._key(inv, name),
                AgentExecution.status.in_([ExecutionStatus.succeeded, ExecutionStatus.skipped]),
            )
            .order_by(AgentExecution.attempt.desc())
        )

    def _parent(self, db: Session, inv: Investigation, depends_on: list[str]) -> uuid.UUID | None:
        for dep in depends_on:
            row = self._succeeded(db, inv, dep)
            if row:
                return row.id
        return None

    def _new_execution(self, db: Session, inv: Investigation, name: str, role: AgentRole, payload: dict, depends_on: list[str]) -> AgentExecution:
        key = self._key(inv, name)
        attempt = (
            db.scalar(select(func.max(AgentExecution.attempt)).where(AgentExecution.investigation_id == inv.id, AgentExecution.step_key == key)) or 0
        ) + 1
        row = AgentExecution(
            workspace_id=inv.workspace_id,
            investigation_id=inv.id,
            parent_execution_id=self._parent(db, inv, depends_on),
            agent_role=role,
            status=ExecutionStatus.running,
            step_key=key,
            attempt=attempt,
            depends_on=[self._key(inv, d) for d in depends_on],
            input=payload,
            started_at=datetime.now(UTC),
        )
        db.add(row)
        db.commit()
        return row

    def _finish(
        self,
        db: Session,
        inv: Investigation,
        row: AgentExecution,
        status: ExecutionStatus,
        *,
        run: AgentRun | None = None,
        output: dict | None = None,
        error: str | None = None,
        summary: str | None = None,
    ) -> None:
        row.status = status
        row.finished_at = datetime.now(UTC)
        started = row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=UTC)
        row.duration_ms = int((row.finished_at - started).total_seconds() * 1000)
        row.error = error
        row.summary = summary
        if run is not None:
            row.output = {"result": run.output.model_dump(), "notes": run.notes}
            if run.result is not None:
                r = run.result
                row.provider, row.model_requested, row.model = r.provider, r.model_requested, r.model_served
                row.provider_request_id = r.request_id
                row.input_tokens, row.output_tokens, row.cost_usd = r.input_tokens, r.output_tokens, r.cost_usd
                inv.input_tokens += r.input_tokens
                inv.output_tokens += r.output_tokens
                inv.cost_usd = round(inv.cost_usd + (r.cost_usd or 0.0), 6)
        elif output is not None:
            row.output = output
        db.commit()

    def _record_system(self, db: Session, inv: Investigation, name: str, depends_on: list[str], fn: Callable[[], tuple[dict, str, ExecutionStatus]]) -> dict:
        """Runs a deterministic (non-agent) step in this thread."""
        done = self._succeeded(db, inv, name)
        if done:
            return done.output or {}
        self._check_cancel(db, inv)
        row = self._new_execution(db, inv, name, AgentRole.system, {}, depends_on)
        try:
            output, summary, status = fn()
        except StepFailed as exc:
            db.rollback()
            self._finish(db, inv, row, ExecutionStatus.failed, error=str(exc))
            raise
        except Exception as exc:
            db.rollback()
            self._finish(db, inv, row, ExecutionStatus.failed, error=f"{type(exc).__name__}: {exc}")
            raise StepFailed(row.step_key, str(exc)) from exc
        self._finish(db, inv, row, status, output=output, summary=summary)
        return output

    def _run_steps(self, db: Session, inv: Investigation, steps: list[StepSpec]) -> dict[str, StepOutcome]:
        """Runs agent steps, in parallel when more than one, with retries and timeouts."""
        results: dict[str, StepOutcome] = {}
        todo: list[StepSpec] = []
        for spec in steps:
            done = self._succeeded(db, inv, spec.name)
            if done and done.output and "result" in done.output:
                results[spec.name] = StepOutcome(spec.output_type.model_validate(done.output["result"]), done.id, reused=True)
            else:
                todo.append(spec)
        if not todo:
            return results
        self._check_cancel(db, inv)

        attempts: dict[str, int] = {}
        pool = ThreadPoolExecutor(max_workers=min(self.settings.agent_max_parallel, len(todo)), thread_name_prefix="astrion-agent")
        running: dict[str, tuple[Future, AgentExecution, StepSpec, float]] = {}
        failure: StepFailed | None = None
        try:

            def submit(spec: StepSpec) -> None:
                row = self._new_execution(db, inv, spec.name, spec.role, spec.input, spec.depends_on)
                attempts[spec.name] = row.attempt
                running[spec.name] = (pool.submit(spec.call), row, spec, time.monotonic())

            for spec in todo:
                submit(spec)
            while running:
                for name in list(running):
                    future, row, spec, started = running[name]
                    remaining = self.settings.agent_timeout_seconds - (time.monotonic() - started)
                    try:
                        run = future.result(timeout=max(0.05, min(remaining, 0.25)))
                    except FutureTimeout:
                        if remaining <= 0:
                            future.cancel()
                            del running[name]
                            self._finish(db, inv, row, ExecutionStatus.failed, error=f"Timed out after {self.settings.agent_timeout_seconds:.0f}s.")
                            failure = failure or StepFailed(row.step_key, "timed out")
                        continue
                    except ProviderError as exc:
                        del running[name]
                        detail = f"{type(exc).__name__}: {exc} (status={exc.status_code}, request_id={exc.request_id})"
                        self._finish(db, inv, row, ExecutionStatus.failed, error=detail)
                        if exc.retryable and attempts[name] < self.settings.agent_max_attempts and failure is None:
                            self.sleep(self.settings.agent_retry_backoff_seconds * (2 ** (attempts[name] - 1)))
                            self._check_cancel(db, inv)
                            submit(spec)
                        else:
                            failure = failure or StepFailed(row.step_key, detail)
                        continue
                    except Exception as exc:
                        del running[name]
                        self._finish(db, inv, row, ExecutionStatus.failed, error=f"{type(exc).__name__}: {exc}")
                        failure = failure or StepFailed(row.step_key, f"{type(exc).__name__}: {exc}")
                        continue
                    del running[name]
                    self._finish(db, inv, row, ExecutionStatus.succeeded, run=run, summary=spec.summarize(run.output))
                    results[name] = StepOutcome(run.output, row.id, reused=False)
                db.refresh(inv, attribute_names=["cancel_requested"])
                if inv.cancel_requested:
                    for future, row, _, _ in list(running.values()):
                        future.cancel()
                        self._finish(db, inv, row, ExecutionStatus.cancelled, error="Cancelled by user.")
                    running.clear()
                    raise Cancelled()
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        if failure:
            raise failure
        return results

    def _skip(self, db: Session, inv: Investigation, name: str, role: AgentRole, reason: str, depends_on: list[str]) -> None:
        if self._succeeded(db, inv, name):
            return
        row = self._new_execution(db, inv, name, role, {}, depends_on)
        self._finish(db, inv, row, ExecutionStatus.skipped, output={"skipped": reason}, summary=reason)

    def _mark_pending_cancelled(self, db: Session, inv: Investigation) -> None:
        db.rollback()
        for row in db.scalars(
            select(AgentExecution).where(
                AgentExecution.investigation_id == inv.id, AgentExecution.status.in_([ExecutionStatus.running, ExecutionStatus.pending])
            )
        ):
            row.status = ExecutionStatus.cancelled
            row.finished_at = datetime.now(UTC)
        db.commit()

    # ------------------------------------------------------------------ 1. ingest (deterministic)

    def _scope_documents(self, db: Session, inv: Investigation) -> list[Document]:
        q = select(Document).where(Document.workspace_id == inv.workspace_id)
        if inv.document_ids:
            q = q.where(Document.id.in_([uuid.UUID(str(d)) for d in inv.document_ids]))
        return list(db.scalars(q.order_by(Document.created_at)))

    def _ingest(self, db: Session, inv: Investigation) -> list[Document]:
        docs = self._scope_documents(db, inv)

        def work() -> tuple[dict, str, ExecutionStatus]:
            report = []
            for doc in docs:
                existing = db.scalar(select(func.count()).select_from(DocumentChunk).where(DocumentChunk.document_id == doc.id)) or 0
                if existing:
                    report.append({"document_id": str(doc.id), "title": doc.title, "status": "ready", "passages": existing})
                    continue
                if not doc.storage_key:
                    report.append({"document_id": str(doc.id), "title": doc.title, "status": "no_content", "reason": "metadata only; no file stored"})
                    continue
                try:
                    data = b"".join(self.storage.open(doc.storage_key))
                    passages = chunk(extract_segments(data, doc.media_type))
                except ExtractionError as exc:
                    doc.processing_status = DocumentProcessingStatus.failed
                    doc.processing_error = str(exc)
                    report.append({"document_id": str(doc.id), "title": doc.title, "status": "unreadable", "reason": str(exc)})
                    continue
                for p in passages:
                    db.add(
                        DocumentChunk(
                            workspace_id=inv.workspace_id,
                            document_id=doc.id,
                            chunk_index=p.index,
                            text=p.text,
                            char_start=p.char_start,
                            char_end=p.char_end,
                            page=p.page,
                        )
                    )
                doc.processing_status = DocumentProcessingStatus.processed
                doc.processing_error = None
                report.append({"document_id": str(doc.id), "title": doc.title, "status": "extracted", "passages": len(passages)})
            db.flush()
            usable = sum(1 for r in report if r["status"] in ("ready", "extracted"))
            return {"documents": report}, f"{usable} of {len(docs)} document(s) have readable text.", ExecutionStatus.succeeded

        self._record_system(db, inv, "ingest", [], work)
        return docs

    # ------------------------------------------------------------------ 2. orchestrator

    def _doc_label(self, db: Session, doc: Document) -> str:
        src = db.get(Source, doc.source_id)
        return f"{doc.title} — {src.title if src else 'unknown source'}"

    def _orchestrator_step(self, db: Session, inv: Investigation, docs: list[Document]) -> c.OrchestratorOutput:
        payload = c.OrchestratorInput(question=inv.question, documents=[self._doc_label(db, d) for d in docs])
        agent = AGENTS[AgentRole.orchestrator]
        out = self._run_steps(
            db,
            inv,
            [
                StepSpec(
                    "orchestrator",
                    AgentRole.orchestrator,
                    lambda: agent.run(payload, self.llm),
                    payload.model_dump(),
                    c.OrchestratorOutput,
                    ["ingest"],
                    lambda o: f"{len(o.sub_questions)} sub-questions defined.",
                )
            ],
        )["orchestrator"]
        plan: c.OrchestratorOutput = out.output  # type: ignore[assignment]
        inv.plan = plan.model_dump()
        db.commit()
        return plan

    # ------------------------------------------------------------------ 3. research (parallel)

    def _research_parts(self, db: Session, doc: Document) -> list[list[DocumentChunk]]:
        chunks = list(db.scalars(select(DocumentChunk).where(DocumentChunk.document_id == doc.id).order_by(DocumentChunk.chunk_index)))
        parts, current, size = [], [], 0
        for ch in chunks:
            if current and size + len(ch.text) > self.settings.research_chars_per_call:
                parts.append(current)
                current, size = [], 0
            current.append(ch)
            size += len(ch.text)
        if current:
            parts.append(current)
        return parts

    def _research_steps(self, db: Session, inv: Investigation, plan: c.OrchestratorOutput, docs: list[Document]) -> list[ResearchBatch]:
        agent = AGENTS[AgentRole.research]
        specs, contexts = [], {}
        for doc in docs:
            source = db.get(Source, doc.source_id)
            for i, part in enumerate(self._research_parts(db, doc), start=1):
                passages = {f"P{ch.chunk_index + 1}": ch for ch in part}
                payload = c.ResearchInput(
                    question=inv.question,
                    sub_questions=plan.sub_questions,
                    document_title=doc.title,
                    source_title=source.title if source else "unknown",
                    passages=[c.PassageView(ref=ref, text=ch.text) for ref, ch in passages.items()],
                )
                name = f"research:{doc.id}:{i}"
                contexts[name] = (doc, source, passages)
                specs.append(
                    StepSpec(
                        name,
                        AgentRole.research,
                        (lambda p=payload: agent.run(p, self.llm)),
                        {"document_id": str(doc.id), "document": doc.title, "part": i, "passages": len(passages)},
                        c.ResearchOutput,
                        ["orchestrator"],
                        lambda o: f"{len(o.claims)} claims, {len(o.entities)} entities, {len(o.relationships)} relationships (relevance {o.relevance}).",
                    )
                )
        if not specs:
            self._skip(db, inv, "research", AgentRole.research, "No document in scope has readable text.", ["orchestrator"])
            return []
        outcomes = self._run_steps(db, inv, specs)
        return [
            ResearchBatch(document=contexts[n][0], source=contexts[n][1], passages=contexts[n][2], output=o.output, execution_id=o.execution_id)
            for n, o in outcomes.items()
        ]  # type: ignore[arg-type]

    # ------------------------------------------------------------------ 4. knowledge

    def _knowledge_step(self, db: Session, inv: Investigation, batches: list[ResearchBatch]) -> None:
        if self._succeeded(db, inv, "knowledge"):
            return
        store = KnowledgeStore(db, inv, extractor=f"{self.llm.provider}:{self.llm.model}")
        payload, pair_map = store.duplicate_questions(batches)
        merges: dict[str, uuid.UUID] = {}
        if payload.pairs:
            agent = AGENTS[AgentRole.knowledge]
            out = self._run_steps(
                db,
                inv,
                [
                    StepSpec(
                        "knowledge:resolve",
                        AgentRole.knowledge,
                        lambda: agent.run(payload, self.llm),
                        payload.model_dump(),
                        c.KnowledgeOutput,
                        ["research"],
                        lambda o: f"{sum(d.same_entity for d in o.decisions)} of {len(o.decisions)} candidate pairs merged.",
                    )
                ],
            )["knowledge:resolve"]
            for d in out.output.decisions:  # type: ignore[attr-defined]
                if d.same_entity and d.pair_id in pair_map:
                    new_key, existing_id = pair_map[d.pair_id]
                    merges[new_key] = existing_id

        def work() -> tuple[dict, str, ExecutionStatus]:
            summary = store.apply(batches, merges)
            data = summary.as_dict() | {"ambiguous_pairs": len(payload.pairs), "merged_by_agent": len(merges)}
            text = (
                f"{summary.claims_created} new claims ({summary.claims_reused} already known), "
                f"{summary.entities_created} new entities ({summary.entities_reused} reused, {summary.entities_merged} merged), "
                f"{summary.relationships_created} new relationships."
            )
            return data, text, ExecutionStatus.succeeded

        # Persisting knowledge is the deterministic half of the Knowledge Agent's responsibility.
        done = self._succeeded(db, inv, "knowledge")
        if done:
            return
        self._check_cancel(db, inv)
        row = self._new_execution(db, inv, "knowledge", AgentRole.knowledge, {"batches": len(batches), "ambiguous_pairs": len(payload.pairs)}, ["research"])
        try:
            data, text, status = work()
        except Exception as exc:
            db.rollback()
            self._finish(db, inv, row, ExecutionStatus.failed, error=f"{type(exc).__name__}: {exc}")
            raise StepFailed(row.step_key, str(exc)) from exc
        self._finish(db, inv, row, status, output=data, summary=text)

    # ------------------------------------------------------------------ graph sync

    def _graph_sync(self, db: Session, inv: Investigation, name: str, depends_on: list[str]) -> None:
        def work() -> tuple[dict, str, ExecutionStatus]:
            if self.graph is None:
                return {"status": "not_configured"}, "Neo4j is not configured; PostgreSQL remains the record.", ExecutionStatus.skipped
            from app.graph.repository import GraphError

            try:
                counts = sync_investigation_graph(db, self.graph, inv)
            except GraphError as exc:
                raise StepFailed(self._key(inv, name), f"Neo4j sync failed: {exc}. Knowledge is saved in PostgreSQL; resume to retry.") from exc
            db.commit()
            return (
                {"status": "synced", **counts},
                f"Synced {counts['nodes']} nodes and {counts['relationships']} relationships to Neo4j.",
                ExecutionStatus.succeeded,
            )

        self._record_system(db, inv, name, depends_on, work)

    # ------------------------------------------------------------------ claim index

    def _claim_index(self, db: Session, inv: Investigation) -> ClaimIndex:
        """Claims from this investigation, plus earlier workspace claims about the same entities."""
        found = investigation_claim_ids(inv.id)
        own = list(db.scalars(select(Claim).where(Claim.id.in_(found)).order_by(Claim.created_at, Claim.id)))
        entity_ids = {cl.subject_entity_id for cl in own if cl.subject_entity_id}
        prior: list[Claim] = []
        if entity_ids:
            prior = list(
                db.scalars(
                    select(Claim)
                    .where(Claim.workspace_id == inv.workspace_id, Claim.subject_entity_id.in_(entity_ids), Claim.id.not_in(found))
                    .order_by(Claim.created_at.desc())
                    .limit(self.settings.max_claims_for_reasoning // 4)
                )
            )
        index = ClaimIndex()
        for cl in [*own, *prior][: self.settings.max_claims_for_reasoning]:
            ref = f"C{len(index.by_ref) + 1}"
            doc = db.get(Document, cl.document_id)
            src = db.get(Source, doc.source_id) if doc else None
            quotes = list(db.scalars(select(Evidence.quote).where(Evidence.claim_id == cl.id).limit(3)))
            index.by_ref[ref] = cl
            index.source_of[ref] = src.id if src else doc.id
            index.views.append(
                c.ClaimView(
                    ref=ref,
                    statement=cl.statement,
                    kind=cl.kind.value,
                    document=doc.title if doc else "?",
                    source=src.title if src else "?",
                    temporal_scope=cl.temporal_scope,
                    quotes=quotes,
                )
            )
        return index

    # ------------------------------------------------------------------ 5. hypotheses ∥ contradictions

    def _relationship_lines(self, db: Session, claims: ClaimIndex) -> list[str]:
        ids = [cl.id for cl in claims.by_ref.values()]
        if not ids:
            return []
        lines = []
        rows = db.execute(select(RelationshipClaim.relationship_id, RelationshipClaim.claim_id).where(RelationshipClaim.claim_id.in_(ids)))
        grouped: dict[uuid.UUID, list[str]] = {}
        for rel_id, claim_id in rows:
            ref = claims.ref_of(claim_id)
            if ref:
                grouped.setdefault(rel_id, []).append(ref)
        for rel_id, refs in grouped.items():
            rel = db.get(GraphRelationship, rel_id)
            a, b = db.get(GraphEntity, rel.source_entity_id), db.get(GraphEntity, rel.target_entity_id)
            lines.append(f"{a.name} —{rel.relation_type.lower()}→ {b.name} ({', '.join(sorted(refs))})")
        return lines[:60]

    def _reasoning_steps(self, db: Session, inv: Investigation, plan: c.OrchestratorOutput, claims: ClaimIndex) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
        if not claims.views:
            for name, role in (("hypothesis", AgentRole.hypothesis), ("contradiction", AgentRole.contradiction)):
                self._skip(db, inv, name, role, "No evidenced claims were extracted, so there is nothing to reason over.", ["knowledge"])
            return [], []
        h_payload = c.HypothesisInput(
            question=inv.question, sub_questions=plan.sub_questions, claims=claims.views, relationships=self._relationship_lines(db, claims)
        )
        x_payload = c.ContradictionInput(question=inv.question, claims=claims.views)
        ha, xa = AGENTS[AgentRole.hypothesis], AGENTS[AgentRole.contradiction]
        ref_map = {r: str(cl.id) for r, cl in claims.by_ref.items()}
        specs = [
            StepSpec(
                "hypothesis",
                AgentRole.hypothesis,
                lambda: ha.run(h_payload, self.llm),
                {"claims": len(claims.views), "claim_refs": ref_map},
                c.HypothesisOutput,
                ["knowledge"],
                lambda o: f"{len(o.hypotheses)} hypotheses proposed.",
            ),
            StepSpec(
                "contradiction",
                AgentRole.contradiction,
                lambda: xa.run(x_payload, self.llm),
                {"claims": len(claims.views), "claim_refs": ref_map},
                c.ContradictionOutput,
                ["knowledge"],
                lambda o: f"{len(o.contradictions)} conflicts found ({sum(x.is_genuine for x in o.contradictions)} genuine).",
            ),
        ]
        outcomes = self._run_steps(db, inv, specs)
        hyp_ids = self._persist_hypotheses(db, inv, claims, outcomes["hypothesis"])
        con_ids = self._persist_contradictions(db, inv, claims, outcomes["contradiction"])
        db.commit()
        return hyp_ids, con_ids

    def _claim_weights(self, claims: ClaimIndex, refs: list[str]) -> list[ClaimWeight]:
        return [ClaimWeight(explicit=claims.by_ref[r].kind.value == "explicit", source_id=str(claims.source_of[r])) for r in refs if r in claims.by_ref]

    def _persist_hypotheses(self, db: Session, inv: Investigation, claims: ClaimIndex, outcome: StepOutcome) -> list[uuid.UUID]:
        existing = list(db.scalars(select(Hypothesis.id).where(Hypothesis.generated_by_execution_id == outcome.execution_id)))
        if existing:  # resumed run: already persisted
            return existing
        ids = []
        for h in outcome.output.hypotheses:  # type: ignore[attr-defined]
            method = hypothesis_confidence(
                self._claim_weights(claims, h.supporting_claim_refs), self._claim_weights(claims, h.opposing_claim_refs), None, h.plausibility
            )
            row = Hypothesis(
                workspace_id=inv.workspace_id,
                investigation_id=inv.id,
                generated_by_execution_id=outcome.execution_id,
                statement=h.statement,
                rationale=h.rationale + (f"\n\nAssumptions: {'; '.join(h.assumptions)}" if h.assumptions else ""),
                origin=HypothesisOrigin.ai_generated,
                status=VerificationStatus.unverified,
                confidence=method["score"],
                confidence_method=method,
                test_plan=h.test_plan,
            )
            db.add(row)
            db.flush()
            for refs, stance in ((h.supporting_claim_refs, EvidenceStance.supports), (h.opposing_claim_refs, EvidenceStance.contradicts)):
                for r in refs:
                    for ev_id in db.scalars(select(Evidence.id).where(Evidence.claim_id == claims.by_ref[r].id)):
                        db.merge(HypothesisEvidence(hypothesis_id=row.id, evidence_id=ev_id, stance=stance))
            db.add(
                GraphChange(
                    workspace_id=inv.workspace_id,
                    investigation_id=inv.id,
                    change_type=GraphChangeType.hypothesis_added,
                    target_key=f"hyp:{row.id}",
                    details={"statement": row.statement[:200]},
                )
            )
            ids.append(row.id)
        return ids

    def _persist_contradictions(self, db: Session, inv: Investigation, claims: ClaimIndex, outcome: StepOutcome) -> list[uuid.UUID]:
        existing = list(db.scalars(select(Contradiction.id).where(Contradiction.execution_id == outcome.execution_id)))
        if existing:
            return existing
        ids = []
        for x in outcome.output.contradictions:  # type: ignore[attr-defined]
            a, b = sorted([claims.by_ref[x.claim_a_ref].id, claims.by_ref[x.claim_b_ref].id], key=str)
            row = db.scalar(select(Contradiction).where(Contradiction.investigation_id == inv.id, Contradiction.claim_a_id == a, Contradiction.claim_b_id == b))
            if row is None:
                row = Contradiction(
                    workspace_id=inv.workspace_id,
                    investigation_id=inv.id,
                    execution_id=outcome.execution_id,
                    claim_a_id=a,
                    claim_b_id=b,
                    kind=ContradictionKind(x.kind),
                    is_genuine=x.is_genuine,
                    explanation=x.explanation,
                    severity=x.severity,
                )
                db.add(row)
                db.flush()
                db.add(
                    GraphChange(
                        workspace_id=inv.workspace_id,
                        investigation_id=inv.id,
                        change_type=GraphChangeType.contradiction_linked,
                        target_key=f"rel:{row.id}",
                        details={"kind": x.kind, "is_genuine": x.is_genuine},
                    )
                )
            ids.append(row.id)
        return ids

    # ------------------------------------------------------------------ 6. verification

    def _view(self, claims: ClaimIndex, claim_id: uuid.UUID) -> c.ClaimView | None:
        ref = claims.ref_of(claim_id)
        return next((v for v in claims.views if v.ref == ref), None)

    def _hypothesis_claims(self, db: Session, claims: ClaimIndex, h: Hypothesis) -> tuple[list[c.ClaimView], list[c.ClaimView]]:
        rows = db.execute(
            select(HypothesisEvidence.stance, Evidence.claim_id)
            .join(Evidence, Evidence.id == HypothesisEvidence.evidence_id)
            .where(HypothesisEvidence.hypothesis_id == h.id)
        )
        sup, opp = [], []
        for stance, claim_id in sorted({(s.value, cid) for s, cid in rows}, key=lambda t: (t[0], str(t[1]))):
            v = self._view(claims, claim_id)
            if v and v not in sup and v not in opp:
                (sup if stance == "supports" else opp).append(v)
        return sup, opp

    def _verification_step(self, db: Session, inv: Investigation, claims: ClaimIndex, hyp_ids: list[uuid.UUID], con_ids: list[uuid.UUID]) -> None:
        if not hyp_ids and not con_ids:
            self._skip(db, inv, "verification", AgentRole.verification, "No hypotheses or contradictions to verify.", ["hypothesis", "contradiction"])
            return
        targets: dict[str, tuple[str, uuid.UUID]] = {}
        hyps, cons = [], []
        for i, hid in enumerate(hyp_ids, start=1):
            h = db.get(Hypothesis, hid)
            sup, opp = self._hypothesis_claims(db, claims, h)
            hyps.append(c.HypothesisForReview(ref=f"H{i}", statement=h.statement, rationale=h.rationale or "", supporting=sup, opposing=opp))
            targets[f"H{i}"] = ("hypothesis", hid)
        for i, xid in enumerate(con_ids, start=1):
            x = db.get(Contradiction, xid)
            va, vb = self._view(claims, x.claim_a_id), self._view(claims, x.claim_b_id)
            if va and vb:
                cons.append(
                    c.ContradictionForReview(ref=f"X{i}", claim_a=va, claim_b=vb, kind=x.kind.value, is_genuine=x.is_genuine, explanation=x.explanation)
                )
                targets[f"X{i}"] = ("contradiction", xid)
        payload = c.VerificationInput(question=inv.question, hypotheses=hyps, contradictions=cons)
        agent = AGENTS[AgentRole.verification]
        outcome = self._run_steps(
            db,
            inv,
            [
                StepSpec(
                    "verification",
                    AgentRole.verification,
                    lambda: agent.run(payload, self.llm),
                    {"targets": {k: str(v[1]) for k, v in targets.items()}},
                    c.VerificationOutput,
                    ["hypothesis", "contradiction"],
                    lambda o: ", ".join(f"{r.target_ref} {r.verdict}" for r in o.reviews),
                )
            ],
        )["verification"]
        if db.scalar(select(func.count()).select_from(VerificationResult).where(VerificationResult.execution_id == outcome.execution_id)):
            return
        for r in outcome.output.reviews:  # type: ignore[attr-defined]
            kind, target_id = targets[r.target_ref]
            checked = [str(claims.by_ref[x].id) for x in r.unsupported_claim_refs if x in claims.by_ref]
            db.add(
                VerificationResult(
                    workspace_id=inv.workspace_id,
                    investigation_id=inv.id,
                    execution_id=outcome.execution_id,
                    target_type=kind,
                    target_id=target_id,
                    verdict=VerificationVerdict(r.verdict),
                    reasoning=r.reasoning,
                    issues=r.issues,
                    missing_evidence=r.missing_evidence,
                    checked_claim_ids=checked,
                )
            )
            if kind == "hypothesis":
                h = db.get(Hypothesis, target_id)
                sup, opp = self._hypothesis_claims(db, claims, h)
                method = hypothesis_confidence(
                    self._claim_weights(claims, [v.ref for v in sup]),
                    self._claim_weights(claims, [v.ref for v in opp]),
                    r.verdict,
                    (h.confidence_method or {}).get("inputs", {}).get("model_plausibility"),
                )
                h.confidence, h.confidence_method = method["score"], method
                h.status = VERDICT_TO_STATUS[r.verdict]
                h.verification_note = r.reasoning[:4000]
        db.commit()

    # ------------------------------------------------------------------ 7. synthesis

    def _synthesis_step(self, db: Session, inv: Investigation, plan: c.OrchestratorOutput, claims: ClaimIndex, docs: list[Document]) -> None:
        hyps = list(db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == inv.id).order_by(Hypothesis.created_at)))
        cons = list(db.scalars(select(Contradiction).where(Contradiction.investigation_id == inv.id).order_by(Contradiction.created_at)))
        verdicts = {v.target_id: v for v in db.scalars(select(VerificationResult).where(VerificationResult.investigation_id == inv.id))}
        h_views, x_views, h_map, x_map = [], [], {}, {}
        for i, h in enumerate(hyps, start=1):
            sup, opp = self._hypothesis_claims(db, claims, h)
            v = verdicts.get(h.id)
            h_views.append(
                c.VerifiedHypothesisView(
                    ref=f"H{i}",
                    statement=h.statement,
                    verdict=v.verdict.value if v else "not_verified",
                    confidence=(h.confidence_method or {}).get("band", "low"),
                    supporting_claim_refs=[x.ref for x in sup],
                    opposing_claim_refs=[x.ref for x in opp],
                )
            )
            h_map[f"H{i}"] = h
        for i, x in enumerate(cons, start=1):
            ra, rb = claims.ref_of(x.claim_a_id), claims.ref_of(x.claim_b_id)
            if ra and rb:
                v = verdicts.get(x.id)
                x_views.append(
                    c.ContradictionView(
                        ref=f"X{i}",
                        claim_a_ref=ra,
                        claim_b_ref=rb,
                        kind=x.kind.value,
                        is_genuine=x.is_genuine,
                        verdict=v.verdict.value if v else None,
                        explanation=x.explanation,
                    )
                )
                x_map[f"X{i}"] = x
        cited_docs = {cl.document_id for cl in claims.by_ref.values()}
        no_evidence = [d.title for d in docs if d.id not in cited_docs]
        ver = db.scalar(
            select(AgentExecution).where(
                AgentExecution.investigation_id == inv.id,
                AgentExecution.step_key == self._key(inv, "verification"),
                AgentExecution.status == ExecutionStatus.succeeded,
            )
        )
        summary = (ver.output or {}).get("result", {}).get("overall_assessment", "") if ver else "Verification did not run."
        payload = c.SynthesisInput(
            question=inv.question,
            objective=plan.objective,
            sub_questions=plan.sub_questions,
            claims=claims.views,
            hypotheses=h_views,
            contradictions=x_views,
            verification_summary=summary,
            documents_without_evidence=no_evidence,
        )
        agent = AGENTS[AgentRole.synthesis]
        outcome = self._run_steps(
            db,
            inv,
            [
                StepSpec(
                    "synthesis",
                    AgentRole.synthesis,
                    lambda: agent.run(payload, self.llm),
                    {"claims": len(claims.views), "hypotheses": len(h_views), "contradictions": len(x_views)},
                    c.SynthesisOutput,
                    ["verification"],
                    lambda o: f"{o.answer_status}: {len(o.key_findings)} findings, {len(o.unresolved_questions)} open questions.",
                )
            ],
        )["synthesis"]
        if db.scalar(select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id, InvestigationReport.run_number == inv.run_count)):
            return
        report: c.SynthesisOutput = outcome.output  # type: ignore[assignment]
        cited = sorted(
            {r for f in report.key_findings for r in f.claim_refs}
            | {r for h in h_views for r in h.supporting_claim_refs + h.opposing_claim_refs}
            | {r for x in x_views for r in (x.claim_a_ref, x.claim_b_ref)}
        )
        citations = {ref: self._citation(db, claims.by_ref[ref]) for ref in cited if ref in claims.by_ref}
        exec_row = db.get(AgentExecution, outcome.execution_id)
        content = {
            **report.model_dump(),
            "citations": citations,
            "hypothesis_ids": {k: str(v.id) for k, v in h_map.items()},
            "contradiction_ids": {k: str(v.id) for k, v in x_map.items()},
            "documents_without_evidence": no_evidence,
            "generated_by": {"provider": exec_row.provider, "model": exec_row.model, "is_fixture": exec_row.provider == "fixture"},
        }
        inv.summary = report.executive_summary[:4000]
        db.add(
            InvestigationReport(
                workspace_id=inv.workspace_id,
                investigation_id=inv.id,
                execution_id=outcome.execution_id,
                run_number=inv.run_count,
                content=content,
                provider=exec_row.provider,
                model=exec_row.model,
            )
        )
        db.commit()

    def _citation(self, db: Session, claim: Claim) -> dict:
        """Claim → Evidence → Document → Source, the provenance chain shown in the report."""
        doc = db.get(Document, claim.document_id)
        src = db.get(Source, doc.source_id) if doc else None
        return {
            "claim_id": str(claim.id),
            "statement": claim.statement,
            "kind": claim.kind.value,
            "temporal_scope": claim.temporal_scope,
            "document": {"id": str(doc.id), "title": doc.title} if doc else None,
            "source": {"id": str(src.id), "title": src.title, "uri": src.uri} if src else None,
            "evidence": [{"quote": e.quote, "locator": e.locator} for e in db.scalars(select(Evidence).where(Evidence.claim_id == claim.id))],
        }
