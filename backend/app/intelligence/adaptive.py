"""Phase 3 behaviour of the orchestrator: memory, adaptive exploration, budgets, temporal and source
intelligence, structured debate and evidence-based consensus.

Mixed into `Orchestrator`; every method below runs inside the orchestrator's single database thread
and records itself as an `agent_executions` step, so it is traced, resumable and idempotent.

Loop control is in code, never delegated to a model: exploration stops when coverage is sufficient,
nothing worth reading remains, the Planner says so, the iteration limit is reached, or the run budget
would be exceeded. Mandatory steps that would exceed the budget fail the run with a clear reason.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.intelligence import contracts as c
from app.intelligence.active_learning import exploration_candidates, recommendations, sufficiency
from app.intelligence.agents import CHALLENGER, DEFENSE, PLANNER
from app.intelligence.memory import MemoryBrief, recall
from app.intelligence.retrieval import BM25
from app.intelligence.source_intel import assess_sources
from app.intelligence.steps import BudgetExhausted, ClaimIndex, StepSpec
from app.intelligence.temporal import annotate, claim_period, detect_superseded, resolve_temporal
from app.models import (
    AgentExecution,
    AgentMessage,
    Claim,
    Contradiction,
    Document,
    DocumentChunk,
    GraphRelationship,
    Hypothesis,
    Investigation,
    InvestigationRun,
    RelationshipClaim,
    Source,
)
from app.models.enums import AgentRole, ClaimKind, ExecutionStatus
from app.models.knowledge import investigation_claim_ids

if TYPE_CHECKING:  # pragma: no cover
    from app.intelligence.orchestrator import Orchestrator

CAUSAL_PREDICATES = {"CAUSES", "INFLUENCES"}
MANDATORY_CALLS = 4  # hypothesis, contradiction, verification, synthesis
DEBATE_CALLS = 2


class AdaptiveMixin:
    # ------------------------------------------------------------------ run record and budget

    def _run_row(self: Orchestrator, db: Session, inv: Investigation) -> InvestigationRun:
        row = db.scalar(select(InvestigationRun).where(InvestigationRun.investigation_id == inv.id, InvestigationRun.run_number == inv.run_count))
        if row is None:
            row = InvestigationRun(
                workspace_id=inv.workspace_id,
                investigation_id=inv.id,
                run_number=inv.run_count,
                provider=self.llm.provider,
                model=self.llm.model,
                started_at=datetime.now(UTC),
            )
            db.add(row)
        row.status = "running"
        row.budget = self._budget()
        db.commit()
        return row

    def _budget(self: Orchestrator) -> dict:
        s = self.settings
        return {"max_llm_calls": s.run_max_llm_calls, "max_tokens": s.run_max_tokens, "max_cost_usd": s.run_max_cost_usd, "max_iterations": s.max_iterations}

    def _usage(self: Orchestrator, db: Session, inv: Investigation) -> dict:
        row = db.execute(
            select(
                func.count(AgentExecution.id),
                func.coalesce(func.sum(AgentExecution.input_tokens), 0),
                func.coalesce(func.sum(AgentExecution.output_tokens), 0),
                func.coalesce(func.sum(AgentExecution.cost_usd), 0.0),
            ).where(
                AgentExecution.investigation_id == inv.id,
                AgentExecution.step_key.like(f"r{inv.run_count}:%"),
                AgentExecution.agent_role != AgentRole.system,
                AgentExecution.status.in_([ExecutionStatus.succeeded, ExecutionStatus.failed, ExecutionStatus.running, ExecutionStatus.cancelled]),
                AgentExecution.step_key.not_like(f"r{inv.run_count}:knowledge"),
                AgentExecution.step_key.not_like(f"r{inv.run_count}:knowledge:i%"),
            )
        ).one()
        return {"llm_calls": int(row[0]), "input_tokens": int(row[1]), "output_tokens": int(row[2]), "cost_usd": round(float(row[3]), 6)}

    def _guard_budget(self: Orchestrator, db: Session, inv: Investigation, new_calls: int) -> None:
        u, b = self._usage(db, inv), self._budget()
        if u["llm_calls"] + new_calls > b["max_llm_calls"]:
            raise BudgetExhausted(
                "budget", f"Run budget exhausted: {u['llm_calls']} of {b['max_llm_calls']} model calls used. Raise ASTRION_RUN_MAX_LLM_CALLS and resume."
            )
        if u["input_tokens"] + u["output_tokens"] >= b["max_tokens"]:
            raise BudgetExhausted("budget", f"Run budget exhausted: {u['input_tokens'] + u['output_tokens']} tokens used (limit {b['max_tokens']}).")
        if u["cost_usd"] >= b["max_cost_usd"]:
            raise BudgetExhausted("budget", f"Run budget exhausted: ${u['cost_usd']:.2f} estimated (limit ${b['max_cost_usd']:.2f}).")

    def _headroom(self: Orchestrator, db: Session, inv: Investigation, calls_needed: int) -> tuple[bool, str]:
        """Whether an optional step fits while keeping enough budget for the mandatory ones."""
        u, b = self._usage(db, inv), self._budget()
        if u["llm_calls"] + calls_needed > b["max_llm_calls"]:
            return False, f"model-call budget ({u['llm_calls']}/{b['max_llm_calls']} used, {calls_needed} needed incl. reserve)"
        if u["input_tokens"] + u["output_tokens"] > 0.7 * b["max_tokens"]:
            return False, f"token budget ({u['input_tokens'] + u['output_tokens']}/{b['max_tokens']})"
        if u["cost_usd"] > 0.7 * b["max_cost_usd"]:
            return False, f"cost budget (${u['cost_usd']:.2f}/${b['max_cost_usd']:.2f})"
        return True, ""

    # ------------------------------------------------------------------ memory

    def _memory_step(self: Orchestrator, db: Session, inv: Investigation) -> MemoryBrief:
        def work() -> tuple[dict, str, ExecutionStatus]:
            brief = recall(db, inv, inv.question, claim_limit=self.settings.memory_claims)
            text = (
                f"Recalled {len(brief.claim_ids)} claims, {len(brief.entity_ids)} entities, {len(brief.hypothesis_ids)} open hypotheses, "
                f"{len(brief.contradiction_ids)} unresolved contradictions and {len(brief.investigation_ids)} earlier outcomes."
            )
            return brief.as_dict(), text, ExecutionStatus.succeeded

        return MemoryBrief.from_dict(self._record_system(db, inv, "memory", ["ingest"], work))

    # ------------------------------------------------------------------ adaptive exploration

    def _scoped_chunks(self: Orchestrator, db: Session, docs: list[Document]) -> list[DocumentChunk]:
        ids = [d.id for d in docs]
        if not ids:
            return []
        return list(db.scalars(select(DocumentChunk).where(DocumentChunk.document_id.in_(ids)).order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)))

    def _initial_chunks(self: Orchestrator, inv: Investigation, plan: c.OrchestratorOutput, chunks: list[DocumentChunk]) -> list[DocumentChunk] | None:
        """None = read everything (fits the initial budget). Otherwise the most relevant passages."""
        if sum(len(ch.text) for ch in chunks) <= self.settings.research_initial_chars:
            return None
        query = " ".join([inv.question, *(q.question for q in plan.sub_questions), *plan.key_terms])
        picked, size = [], 0
        for hit in BM25([ch.text for ch in chunks]).search(query):
            ch = chunks[hit.index]
            if size + len(ch.text) > self.settings.research_initial_chars:
                break
            picked.append(ch)
            size += len(ch.text)
        return picked or chunks[:1]

    def _read_chunk_ids(self: Orchestrator, db: Session, inv: Investigation) -> set[str]:
        read: set[str] = set()
        for inp in db.scalars(
            select(AgentExecution.input).where(AgentExecution.investigation_id == inv.id, AgentExecution.step_key.like(f"r{inv.run_count}:research:%"))
        ):
            read |= set((inp or {}).get("chunk_ids", []))
        return read

    def _explore(
        self: Orchestrator, db: Session, inv: Investigation, plan: c.OrchestratorOutput, docs: list[Document], memory: MemoryBrief
    ) -> c.OrchestratorOutput:
        run = self._run_row(db, inv)
        chunks = self._scoped_chunks(db, docs)
        batches = self._research_steps(db, inv, plan, docs, chunks=self._initial_chunks(inv, plan, chunks), iteration=1)
        self._knowledge_step(db, inv, batches, iteration=1)
        self._graph_sync(db, inv, "graph_sync:knowledge", depends_on=["knowledge"])
        iteration = 1
        while True:
            decision = self._assess(db, inv, plan, chunks, iteration, memory)
            if decision["stop"]:
                stop = decision["reason"]
                break
            out = self._planner_step(db, inv, plan, decision, iteration)
            if out.sufficient or not out.selected_action_ids:
                stop = f"Planner: {out.rationale}"
                break
            plan = self._apply_plan_changes(db, inv, plan, out, iteration)
            selected = {a["id"]: a for a in decision["candidates"] if a["id"] in out.selected_action_ids}
            wanted = {cid for a in selected.values() for cid in a["chunk_ids"]}
            iteration += 1
            batch_chunks = [ch for ch in chunks if str(ch.id) in wanted]
            batches = self._research_steps(db, inv, plan, docs, chunks=batch_chunks, iteration=iteration, depends=f"planner:{iteration - 1}")
            self._knowledge_step(db, inv, batches, iteration=iteration)
            self._graph_sync(db, inv, f"graph_sync:knowledge:i{iteration}", depends_on=[f"knowledge:i{iteration}"])
        run = self._run_row(db, inv)
        run.iterations, run.stop_reason = iteration, stop
        db.commit()
        return plan

    def _assess(
        self: Orchestrator, db: Session, inv: Investigation, plan: c.OrchestratorOutput, chunks: list[DocumentChunk], iteration: int, memory: MemoryBrief
    ) -> dict:
        def work() -> tuple[dict, str, ExecutionStatus]:
            read = self._read_chunk_ids(db, inv)
            sqs = [q.model_dump() for q in plan.sub_questions]
            cands, cov = exploration_candidates(db, inv, sqs, plan.key_terms, chunks, read, self.settings.research_iteration_chars, memory.contradiction_ids)
            stop, reason = sufficiency(cov, cands, self.settings.min_claims_per_subquestion)
            if not stop and iteration >= self.settings.max_iterations:
                stop, reason = True, f"Iteration limit reached ({self.settings.max_iterations})."
            if not stop:
                ok, why = self._headroom(db, inv, 3 + MANDATORY_CALLS)
                if not ok:
                    stop, reason = True, f"Stopped exploring to stay within the {why}."
            data = {
                "iteration": iteration,
                "coverage": cov,
                "candidates": [x.as_dict() for x in cands[:8]],
                "unread_passages": len([ch for ch in chunks if str(ch.id) not in read]),
                "stop": stop,
                "reason": reason,
                "usage": self._usage(db, inv),
            }
            return data, ("Stop: " if stop else "Continue: ") + reason, ExecutionStatus.succeeded

        return self._record_system(db, inv, f"assess:{iteration}", [f"knowledge:i{iteration}" if iteration > 1 else "knowledge"], work)

    def _planner_step(self: Orchestrator, db: Session, inv: Investigation, plan: c.OrchestratorOutput, decision: dict, iteration: int) -> c.PlannerOutput:
        recent = list(
            db.scalars(
                select(Claim.statement)
                .where(Claim.id.in_(investigation_claim_ids(inv.id)))
                .order_by(Claim.created_at.desc(), Claim.normalized_statement)
                .limit(20)
            )
        )
        payload = c.PlannerInput(
            question=inv.question,
            iteration=iteration,
            iterations_left=self.settings.max_iterations - iteration,
            sub_questions=plan.sub_questions,
            coverage=[c.CoverageView(**{k: v for k, v in cv.items() if k in c.CoverageView.model_fields}) for cv in decision["coverage"]],
            candidates=[
                c.CandidateAction(id=a["id"], kind=a["kind"], target=a["target"], explanation=a["explanation"], score=a["score"], passages=len(a["chunk_ids"]))
                for a in decision["candidates"]
            ],
            recent_claims=recent,
            budget_note=f"Used {decision['usage']['llm_calls']} of {self.settings.run_max_llm_calls} model calls.",
        )
        return self._run_steps(
            db,
            inv,
            [
                StepSpec(
                    f"planner:{iteration}",
                    AgentRole.planner,
                    lambda: PLANNER.run(payload, self.llm),
                    payload.model_dump(),
                    c.PlannerOutput,
                    [f"assess:{iteration}"],
                    lambda o: ("Sufficient: " if o.sufficient else f"Selected {', '.join(o.selected_action_ids) or 'nothing'}: ") + o.rationale[:200],
                )
            ],
        )[f"planner:{iteration}"].output  # type: ignore[return-value]

    def _apply_plan_changes(
        self: Orchestrator, db: Session, inv: Investigation, plan: c.OrchestratorOutput, out: c.PlannerOutput, iteration: int
    ) -> c.OrchestratorOutput:
        existing = {q.question.strip().lower() for q in plan.sub_questions}
        added = []
        for nq in out.new_sub_questions:
            if nq.question.strip().lower() in existing:
                continue
            q = c.SubQuestion(
                id=f"Q{len(plan.sub_questions) + len(added) + 1}", question=nq.question, rationale=f"Added in iteration {iteration}: {nq.rationale}"
            )
            added.append(q)
        plan = plan.model_copy(update={"sub_questions": [*plan.sub_questions, *added]})
        inv.plan = plan.model_dump()
        run = self._run_row(db, inv)
        history = list(run.plan_history or [])
        if not any(h.get("iteration") == iteration for h in history):
            history.append(
                {
                    "iteration": iteration,
                    "selected_actions": out.selected_action_ids,
                    "added_sub_questions": [q.model_dump() for q in added],
                    "evidence_gaps": out.evidence_gaps,
                    "rationale": out.rationale,
                }
            )
            run.plan_history = history
        db.commit()
        return plan

    # ------------------------------------------------------------------ temporal and source intelligence

    def _temporal_step(self: Orchestrator, db: Session, inv: Investigation, memory: MemoryBrief) -> None:
        def work() -> tuple[dict, str, ExecutionStatus]:
            own = list(db.scalars(select(Claim).where(Claim.id.in_(investigation_claim_ids(inv.id)))))
            recalled = list(db.scalars(select(Claim).where(Claim.id.in_(memory.claim_ids)))) if memory.claim_ids else []
            dated = annotate(db, own + recalled)
            events = detect_superseded(db, inv.workspace_id, inv.id, [cl.id for cl in own])
            db.commit()
            return (
                {"dated_claims": dated, "superseded": events},
                f"Dated {dated} claim(s); {len(events)} outdated claim(s) superseded by newer ones.",
                ExecutionStatus.succeeded,
            )

        self._record_system(db, inv, "temporal", ["knowledge"], work)

    def _sources_step(self: Orchestrator, db: Session, inv: Investigation) -> list[str]:
        def work() -> tuple[dict, str, ExecutionStatus]:
            own = list(db.scalars(select(Claim).where(Claim.id.in_(investigation_claim_ids(inv.id)))))
            rows = assess_sources(db, inv.workspace_id, inv.id, inv.run_count, own)
            db.commit()
            notes = []
            for r in rows:
                src = db.get(Source, r.source_id)
                notes.append(
                    f"{src.title}: credibility prior {r.credibility} ({src.source_type.value}), recency {r.recency if r.recency is not None else 'unknown'}, "
                    f"independence {r.independence}, corroboration {r.corroboration} — describes the source, not any single claim."
                )
            groups = {str(r.source_id): r.independence_group for r in rows}
            return {"sources": len(rows), "notes": notes, "groups": groups}, f"Assessed {len(rows)} source(s).", ExecutionStatus.succeeded

        return self._record_system(db, inv, "sources", ["temporal"], work).get("notes", [])

    # ------------------------------------------------------------------ hypothesis reasoning guard

    def _guard_reasoning(self: Orchestrator, db: Session, declared: str | None, supporting: list[Claim]) -> tuple[str, str | None]:
        if not supporting:
            return "speculation", "No supporting claim: treated as speculation."
        declared = declared or "inference"
        ids = [cl.id for cl in supporting]
        causal = db.scalar(
            select(func.count())
            .select_from(RelationshipClaim)
            .join(GraphRelationship, GraphRelationship.id == RelationshipClaim.relationship_id)
            .where(RelationshipClaim.claim_id.in_(ids), GraphRelationship.relation_type.in_(CAUSAL_PREDICATES))
        )
        if declared == "causation" and not causal:
            return "correlation", "Declared causation, but no cited claim asserts a causal relationship: downgraded to correlation."
        if declared in ("causation", "correlation") and all(cl.kind == ClaimKind.inferred for cl in supporting):
            return "inference", f"Declared {declared}, but every supporting claim is inferred: downgraded to inference."
        return declared, None

    # ------------------------------------------------------------------ debate

    def _debate_step(self: Orchestrator, db: Session, inv: Investigation, claims: ClaimIndex, hyp_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
        """Challenger raises objections, the hypothesis author answers; both are recorded as messages."""
        n = self.settings.max_debated_hypotheses
        if not hyp_ids or n == 0:
            return {}
        if not (self._succeeded(db, inv, "debate:challenge") or self._succeeded(db, inv, "debate:defense")):
            ok, why = self._headroom(db, inv, DEBATE_CALLS + 2)
            if not ok:
                self._skip(db, inv, "debate:challenge", AgentRole.challenger, f"Debate skipped to stay within the {why}.", ["hypothesis"])
                return {}
        hyps = sorted((db.get(Hypothesis, h) for h in hyp_ids), key=lambda h: (abs((h.confidence or 0) - 0.5), str(h.id)))[:n]
        views, ref_of = [], {}
        for i, h in enumerate(hyps, start=1):
            sup, opp = self._hypothesis_claims(db, claims, h)
            ref = f"H{i}"
            ref_of[ref] = h
            views.append(
                c.HypothesisForDebate(
                    ref=ref,
                    statement=h.statement,
                    rationale=h.rationale or "",
                    reasoning_type=h.reasoning_type or "inference",
                    assumptions=h.assumptions or [],
                    falsification_conditions=h.falsification_conditions or [],
                    supporting=sup,
                    opposing=opp,
                )
            )
        ch_payload = c.ChallengerInput(question=inv.question, hypotheses=views, claims=claims.views)
        ch = self._run_steps(
            db,
            inv,
            [
                StepSpec(
                    "debate:challenge",
                    AgentRole.challenger,
                    lambda: CHALLENGER.run(ch_payload, self.llm),
                    {"hypotheses": {r: str(h.id) for r, h in ref_of.items()}},
                    c.ChallengerOutput,
                    ["hypothesis"],
                    lambda o: f"{sum(len(x.objections) for x in o.challenges)} objections to {len(o.challenges)} hypotheses.",
                )
            ],
        )["debate:challenge"]
        challenge: c.ChallengerOutput = ch.output  # type: ignore[assignment]
        objections, by_id = [], {}
        for chal in challenge.challenges:
            for j, o in enumerate(chal.objections, start=1):
                oid = f"{chal.hypothesis_ref}.O{j}"
                cited = [v for v in claims.views if v.ref in o.cited_claim_refs]
                objections.append(c.ObjectionView(id=oid, hypothesis_ref=chal.hypothesis_ref, kind=o.kind, argument=o.argument, cited_claims=cited))
                by_id[oid] = (chal, o)
        defense: c.DefenseOutput | None = None
        defense_exec = None
        if objections:
            d_payload = c.DefenseInput(question=inv.question, hypotheses=views, objections=objections, claims=claims.views)
            out = self._run_steps(
                db,
                inv,
                [
                    StepSpec(
                        "debate:defense",
                        AgentRole.hypothesis,
                        lambda: DEFENSE.run(d_payload, self.llm),
                        {"objections": len(objections)},
                        c.DefenseOutput,
                        ["debate:challenge"],
                        lambda o: f"{sum(r.stance == 'rebut' for r in o.responses)} rebutted, {sum(r.stance == 'concede' for r in o.responses)} conceded, "
                        f"{sum(r.stance == 'revise' for r in o.responses)} revised.",
                    )
                ],
            )["debate:defense"]
            defense, defense_exec = out.output, out.execution_id  # type: ignore[assignment]
        return self._persist_debate(db, inv, claims, ref_of, challenge, ch.execution_id, defense, defense_exec)

    def _persist_debate(self: Orchestrator, db, inv, claims, ref_of, challenge, ch_exec, defense, defense_exec) -> dict[uuid.UUID, list[str]]:  # noqa: ANN001
        responses = {r.objection_id: r for r in (defense.responses if defense else [])}
        revisions = {r.hypothesis_ref: r for r in (defense.revisions if defense else [])}
        already = db.scalar(select(func.count()).select_from(AgentMessage).where(AgentMessage.execution_id == ch_exec))
        ids = lambda refs: [str(claims.by_ref[r].id) for r in refs if r in claims.by_ref]  # noqa: E731
        transcripts: dict[uuid.UUID, list[str]] = {}

        def msg(execution_id, sender, recipient, kind, h, content, cited) -> None:  # noqa: ANN001
            if not already:
                db.add(
                    AgentMessage(
                        workspace_id=inv.workspace_id,
                        investigation_id=inv.id,
                        run_number=inv.run_count,
                        execution_id=execution_id,
                        sender_role=sender,
                        recipient_role=recipient,
                        kind=kind,
                        subject_type="hypothesis",
                        subject_id=h.id,
                        content=content,
                        cited_claim_ids=cited,
                    )
                )

        for chal in challenge.challenges:
            h = ref_of[chal.hypothesis_ref]
            lines, record = [], []
            for j, o in enumerate(chal.objections, start=1):
                oid = f"{chal.hypothesis_ref}.O{j}"
                msg(ch_exec, "challenger", "hypothesis", "challenge", h, {"objection_id": oid, "kind": o.kind, "argument": o.argument}, ids(o.cited_claim_refs))
                lines.append(f"Objection {oid} ({o.kind}): {o.argument} [{', '.join(o.cited_claim_refs) or 'no citation'}]")
                r = responses.get(oid)
                answered = bool(r and (r.stance == "revise" or (r.stance == "rebut" and r.cited_claim_refs)))
                if r:
                    kind = {"rebut": "rebuttal", "concede": "concession", "revise": "revision"}[r.stance]
                    msg(defense_exec, "hypothesis", "challenger", kind, h, {"objection_id": oid, "argument": r.argument}, ids(r.cited_claim_refs))
                    lines.append(f"Response ({r.stance}): {r.argument} [{', '.join(r.cited_claim_refs) or 'no citation'}]")
                else:
                    lines.append("No response: the objection stands.")
                record.append(
                    {
                        "id": oid,
                        "kind": o.kind,
                        "argument": o.argument,
                        "cited_claim_ids": ids(o.cited_claim_refs),
                        "response": None if r is None else {"stance": r.stance, "argument": r.argument, "cited_claim_ids": ids(r.cited_claim_refs)},
                        "answered_with_evidence": answered,
                    }
                )
            debate = dict(h.debate or {})
            debate.update(
                {
                    "strength": chal.strength,
                    "alternative_hypothesis": chal.alternative_hypothesis,
                    "objections": record,
                    "standing_objections": sum(1 for x in record if not x["answered_with_evidence"]),
                }
            )
            rev = revisions.get(chal.hypothesis_ref)
            if rev and "revision" not in debate:
                sup = [db.get(Claim, uuid.UUID(x)) for x in self._supporting_ids(db, h)]
                rtype, note = self._guard_reasoning(db, rev.revised_reasoning_type, [x for x in sup if x])
                debate["revision"] = {"previous_statement": h.statement, "previous_reasoning_type": h.reasoning_type, "reasoning_check": note}
                if rev.revised_statement.strip():
                    h.statement = rev.revised_statement.strip()[:4000]
                h.reasoning_type = rtype
                lines.append(f"Revised to ({rtype}): {h.statement}")
            h.debate = debate
            transcripts[h.id] = lines
        db.commit()
        return transcripts

    def _supporting_ids(self: Orchestrator, db: Session, h: Hypothesis) -> list[str]:
        from app.models import Evidence, HypothesisEvidence
        from app.models.enums import EvidenceStance

        rows = db.scalars(
            select(Evidence.claim_id)
            .join(HypothesisEvidence, HypothesisEvidence.evidence_id == Evidence.id)
            .where(HypothesisEvidence.hypothesis_id == h.id, HypothesisEvidence.stance == EvidenceStance.supports)
        )
        return sorted({str(x) for x in rows})

    def _consensus(self: Orchestrator, db: Session, inv: Investigation, verdicts: dict[uuid.UUID, str]) -> None:
        """Evidence-based consensus from the independent verdict and the debate outcome."""
        for h in db.scalars(select(Hypothesis).where(Hypothesis.investigation_id == inv.id)):
            v = verdicts.get(h.id)
            if v is None:
                continue
            debated = bool((h.debate or {}).get("objections") is not None)
            standing = (h.debate or {}).get("standing_objections", 0)
            if v in ("contradicted", "unsupported"):
                h.consensus = "rejected"
            elif not debated:
                h.consensus = "unchallenged"
            elif standing:
                h.consensus = "contested"
            elif v in ("supported", "partially_supported"):
                h.consensus = "agreed"
            else:
                h.consensus = "insufficient"
            db.add(
                AgentMessage(
                    workspace_id=inv.workspace_id,
                    investigation_id=inv.id,
                    run_number=inv.run_count,
                    execution_id=None,
                    sender_role="verification",
                    recipient_role="all",
                    kind="verdict",
                    subject_type="hypothesis",
                    subject_id=h.id,
                    content={"verdict": v, "consensus": h.consensus, "standing_objections": standing},
                    cited_claim_ids=[],
                )
            )
        db.commit()

    def _resolve_contradictions_temporally(self: Orchestrator, db: Session, con_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
        notes = {}
        for xid in con_ids:
            x = db.get(Contradiction, xid)
            a, b = db.get(Claim, x.claim_a_id), db.get(Claim, x.claim_b_id)
            note = resolve_temporal(a, b)
            if note:
                notes[xid] = note
                if x.resolution_kind is None:
                    x.resolution_kind, x.resolution = "temporal", note
        db.flush()
        return notes

    # ------------------------------------------------------------------ after the run

    def _next_steps_step(self: Orchestrator, db: Session, inv: Investigation) -> None:
        def work() -> tuple[dict, str, ExecutionStatus]:
            recs = recommendations(db, inv, inv.run_count)
            run = self._run_row(db, inv)
            run.recommendations = recs
            db.commit()
            top = recs[0]["target"] if recs else "nothing outstanding"
            return {"recommendations": len(recs)}, f"{len(recs)} next step(s); top: {top[:160]}", ExecutionStatus.succeeded

        self._record_system(db, inv, "next_steps", ["synthesis"], work)

    def _period_label(self: Orchestrator, cl: Claim) -> str | None:
        p = claim_period(cl)
        return p.label() if p else None
