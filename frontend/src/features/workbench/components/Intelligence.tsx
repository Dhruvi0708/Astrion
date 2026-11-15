import { Check, Compass, Gauge, MessageSquareWarning, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import type { Assessment, ClaimRecord, DebateRecord, Recommendation, RunRecord, SourceAssessmentRecord } from '@/lib/api/types';
import { formatCost } from '../status';

const FACTOR_LABEL: Record<string, string> = {
  uncertainty: 'Uncertainty',
  relevance: 'Relevance',
  information_gain: 'Info gain',
  evidence_quality: 'Weak evidence',
  contradiction: 'Conflict',
};

function Bar({ value, max = 1, label }: { value: number; max?: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="flex items-center gap-2 text-2xs" title={`${label}: ${value}`}>
      <span className="w-20 shrink-0 text-ink-faint">{label}</span>
      <span className="h-1.5 flex-1 rounded bg-raised">
        <span className={cn('block h-1.5 rounded', pct > 85 ? 'bg-caution' : 'bg-cyan/70')} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-ink-muted">{value}</span>
    </div>
  );
}

function Factors({ factors }: { factors: Record<string, number> }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {Object.entries(factors).map(([k, v]) => (
        <Bar key={k} label={FACTOR_LABEL[k] ?? k} value={v} />
      ))}
    </div>
  );
}

/** How the run planned itself: budget use, each assessment, what the planner chose and why it stopped. */
export function PlanningView({ run, assessments }: { run?: RunRecord; assessments: Assessment[] }) {
  if (!run) return <EmptyState icon={<Compass size={18} />} title="No run yet" description="Planning decisions are recorded once the investigation runs." />;
  const chosen = new Map(run.plan_history.map((h) => [h.iteration, new Set(h.selected_actions)]));
  return (
    <div className="space-y-5" data-testid="planning">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <div className="space-y-2 rounded-lg border border-line bg-surface/60 p-3.5">
          <p className="eyebrow flex items-center gap-1.5">
            <Gauge size={12} /> Budget for run {run.run_number}
          </p>
          <Bar label="Model calls" value={run.usage.llm_calls ?? 0} max={run.budget.max_llm_calls} />
          <Bar label="Tokens" value={(run.usage.input_tokens ?? 0) + (run.usage.output_tokens ?? 0)} max={run.budget.max_tokens} />
          <Bar label="Est. cost" value={run.usage.cost_usd ?? 0} max={run.budget.max_cost_usd} />
          <p className="text-2xs text-ink-faint">
            Limits: {run.budget.max_llm_calls} calls · {run.budget.max_tokens.toLocaleString()} tokens · {formatCost(run.budget.max_cost_usd)} ·{' '}
            {run.budget.max_iterations} iterations. Hard stops enforced in code.
          </p>
        </div>
        <div className="space-y-1.5 rounded-lg border border-line bg-surface/60 p-3.5">
          <p className="eyebrow">Exploration</p>
          <p className="text-sm text-ink">
            {run.iterations} research iteration{run.iterations === 1 ? '' : 's'}
          </p>
          <p className="text-xs leading-relaxed text-ink-muted" data-testid="stop-reason">
            Stopped because: {run.stop_reason ?? 'still running'}
          </p>
        </div>
      </div>
      {assessments.map((a) => (
        <section key={a.iteration} className="rounded-lg border border-line bg-surface/40 p-3.5" data-testid="assessment">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm text-ink">Assessment after iteration {a.iteration}</span>
            <Badge tone={a.stop ? 'neutral' : 'cyan'}>{a.stop ? 'stop' : 'continue'}</Badge>
            <span className="text-2xs text-ink-faint">{a.unread_passages} unread passage(s)</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{a.reason}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <p className="eyebrow mb-1">Coverage</p>
              <ul className="space-y-1 text-xs">
                {a.coverage.map((q) => (
                  <li key={q.sub_question_id} className="flex gap-2">
                    <span className="font-mono text-2xs text-cyan">{q.sub_question_id}</span>
                    <span className="flex-1 text-ink-muted">{q.question}</span>
                    <span className={cn('shrink-0 font-mono text-2xs', q.claims ? 'text-verified' : 'text-caution')}>
                      {q.claims} claims · {q.documents} doc
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-1">Candidate next steps (scored)</p>
              {a.candidates.length ? (
                <ul className="space-y-2">
                  {a.candidates.map((cand) => {
                    const picked = chosen.get(a.iteration)?.has(cand.id);
                    return (
                      <li key={cand.id} className={cn('rounded-md border p-2.5', picked ? 'border-cyan/50 bg-cyan/[0.04]' : 'border-line')}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-2xs text-ink-faint">{cand.id}</span>
                          <span className="text-2xs uppercase tracking-wider text-ink-faint">{cand.kind.replace(/_/g, ' ')}</span>
                          {picked && (
                            <Badge tone="cyan">
                              <Check size={10} /> chosen by planner
                            </Badge>
                          )}
                          <span className="ml-auto font-mono text-2xs text-ink">{cand.score}</span>
                        </div>
                        <p className="mt-1 text-xs text-ink-muted">{cand.explanation}</p>
                        <div className="mt-1.5">
                          <Factors factors={cand.factors} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-ink-muted">No unread passage was worth reading.</p>
              )}
            </div>
          </div>
          {run.plan_history
            .filter((h) => h.iteration === a.iteration)
            .map((h) => (
              <div key={h.iteration} className="mt-3 border-t border-line pt-2 text-xs text-ink-muted">
                <span className="text-ink">Planner:</span> {h.rationale}
                {h.added_sub_questions.length > 0 && <span> · added {h.added_sub_questions.map((q) => q.question).join('; ')}</span>}
                {h.evidence_gaps.length > 0 && <span className="text-ink-faint"> · gaps: {h.evidence_gaps.join(', ')}</span>}
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}

/** Active-learning recommendations: what would most improve the investigation, and why. */
export function NextSteps({ recs }: { recs: Recommendation[] }) {
  if (!recs.length) return <p className="text-sm text-ink-muted">No next steps recorded for this run.</p>;
  return (
    <ol className="space-y-2" aria-label="Recommended next steps">
      {recs.map((r, i) => (
        <li key={`${r.kind}-${i}`} className="rounded-lg border border-line bg-surface/60 p-3" data-testid="next-step">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-cyan" />
            <span className="text-2xs uppercase tracking-wider text-ink-faint">{r.kind.replace(/_/g, ' ')}</span>
            <span className="ml-auto font-mono text-2xs text-ink">score {r.score}</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{r.target}</p>
          <p className="mt-1 text-2xs text-ink-faint">{r.explanation.replace(`${r.target} — `, '')}</p>
          <div className="mt-2">
            <Factors factors={r.factors} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Pct({ value }: { value: number | null }) {
  return <span className="font-mono">{value == null ? '—' : `${Math.round(value * 100)}%`}</span>;
}

/** Source intelligence. Explicitly separate from the confidence of any individual claim. */
export function SourcesView({ sources }: { sources: SourceAssessmentRecord[] }) {
  if (!sources.length)
    return <EmptyState icon={<ShieldCheck size={18} />} title="No sources assessed" description="Sources are assessed once claims have been extracted." />;
  return (
    <div className="space-y-3" data-testid="sources">
      <p className="text-xs leading-relaxed text-ink-muted">
        These scores describe <em>sources</em>, not claims. A weak source can hold a well-corroborated claim and a strong source a single unsupported one, so
        they never change a claim&apos;s or hypothesis&apos;s confidence. Credibility is a prior by source type, not a verified rating.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-2xs uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="py-2 pr-3 font-medium">Source</th>
              <th className="py-2 pr-3 font-medium">Relevance</th>
              <th className="py-2 pr-3 font-medium">Credibility (prior)</th>
              <th className="py-2 pr-3 font-medium">Recency</th>
              <th className="py-2 pr-3 font-medium">Independence</th>
              <th className="py-2 font-medium">Corroboration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sources.map((s) => (
              <tr key={s.source.id}>
                <td className="py-2 pr-3">
                  <p className="text-ink">{s.source.title}</p>
                  <p className="text-2xs text-ink-faint">
                    {s.source.source_type} · {s.source.published_on ?? 'date unknown'}
                    {s.details.shares_origin_with > 0 && ` · shares origin with ${s.details.shares_origin_with} other source(s)`}
                  </p>
                </td>
                <td className="py-2 pr-3 text-ink-muted">
                  <Pct value={s.relevance} /> <span className="text-2xs text-ink-faint">({s.details.claims} claims)</span>
                </td>
                <td className="py-2 pr-3 text-ink-muted" title={s.details.credibility_basis}>
                  <Pct value={s.credibility} />
                </td>
                <td className="py-2 pr-3 text-ink-muted" title={s.details.recency_basis}>
                  <Pct value={s.recency} />
                </td>
                <td className="py-2 pr-3 text-ink-muted">
                  <Pct value={s.independence} />
                </td>
                <td className="py-2 text-ink-muted" title={`${s.details.corroborated_claims} of ${s.details.claims} claims stated by an independent source`}>
                  <Pct value={s.corroboration} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STANCE_TONE = { rebut: 'verified', concede: 'conflict', revise: 'cyan' } as const;

/** Challenger objections and the author's responses, as recorded. */
export function DebateThread({ debate, claimsById }: { debate: DebateRecord; claimsById: Map<string, ClaimRecord> }) {
  if (!debate.objections) return null;
  const cite = (ids: string[]) =>
    ids.length ? (
      <ul className="mt-1 space-y-0.5">
        {ids.map((id) => (
          <li key={id} className="text-2xs text-ink-faint">
            — {claimsById.get(id)?.statement ?? 'claim from earlier knowledge'}
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <div className="rounded-md border border-line bg-deep/40 p-2.5" data-testid="debate">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow flex items-center gap-1">
          <MessageSquareWarning size={11} /> Debate
        </span>
        {debate.strength && <Badge tone="neutral">challenge {debate.strength}</Badge>}
        <span className="text-2xs text-ink-faint">{debate.standing_objections ?? 0} objection(s) standing</span>
      </div>
      {debate.objections.length === 0 && <p className="mt-1.5 text-xs text-ink-muted">The challenger raised no objection.</p>}
      <ol className="mt-2 space-y-2">
        {debate.objections.map((o) => (
          <li key={o.id} className="text-xs">
            <p className="text-ink">
              <span className="font-mono text-2xs text-ink-faint">{o.id}</span> <span className="text-conflict">{o.kind.replace(/_/g, ' ')}</span> —{' '}
              {o.argument}
            </p>
            {cite(o.cited_claim_ids)}
            {o.response ? (
              <div className="ml-3 mt-1 border-l border-line pl-2">
                <Badge tone={STANCE_TONE[o.response.stance]}>{o.response.stance}</Badge> <span className="text-ink-muted">{o.response.argument}</span>
                {cite(o.response.cited_claim_ids)}
                {!o.answered_with_evidence && <p className="text-2xs text-caution">Not counted as answered: no evidence cited.</p>}
              </div>
            ) : (
              <p className="ml-3 mt-1 text-2xs text-caution">No response — the objection stands.</p>
            )}
          </li>
        ))}
      </ol>
      {debate.alternative_hypothesis && <p className="mt-2 text-2xs text-ink-faint">Challenger&apos;s alternative: {debate.alternative_hypothesis}</p>}
      {debate.revision && (
        <p className="mt-2 text-2xs text-ink-faint">
          Revised from: “{debate.revision.previous_statement}” ({debate.revision.previous_reasoning_type ?? 'n/a'})
        </p>
      )}
    </div>
  );
}
