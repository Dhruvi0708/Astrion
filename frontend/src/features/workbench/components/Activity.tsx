import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, Bot, ChevronRight, Cpu, FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { AgentExecution, InvestigationDetail, IntelligenceStatus } from '@/lib/api/types';
import { EXECUTION_STATUS, ROLE, STAGE_LABEL, formatCost, formatDuration, stageName } from '../status';

/** States which provider runs (or ran) the investigation. Fixture output is always flagged as not AI. */
export function ProviderNotice({ status, detail }: { status?: IntelligenceStatus; detail?: InvestigationDetail }) {
  const provider = detail?.llm_provider ?? status?.provider ?? null;
  const model = detail?.llm_model ?? status?.model ?? null;
  if (provider === 'fixture') {
    return (
      <div role="note" className="flex items-start gap-2.5 rounded-md border border-caution/40 bg-caution/[0.07] px-3.5 py-2.5 text-[0.8rem] text-ink-muted">
        <FlaskConical size={15} className="mt-0.5 shrink-0 text-caution" />
        <p>
          <span className="font-medium text-caution">Fixture provider — not AI.</span>{' '}
          {detail ? 'Every agent step here was produced' : 'Investigations on this server are run'} by deterministic keyword rules (model{' '}
          <code className="font-mono">{model}</code>) for development and testing. The pipeline, persistence and provenance are real; the reasoning is not.
        </p>
      </div>
    );
  }
  if (!detail?.llm_provider && status && !status.configured) {
    return (
      <div role="note" className="flex items-start gap-2.5 rounded-md border border-conflict/35 bg-conflict/[0.06] px-3.5 py-2.5 text-[0.8rem] text-ink-muted">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-conflict" />
        <p>
          <span className="font-medium text-conflict">No AI provider configured.</span> {status.detail} Investigations can be drafted but not run.
        </p>
      </div>
    );
  }
  if (provider) {
    return (
      <p className="flex items-center gap-2 text-2xs text-ink-faint">
        <Bot size={12} /> Agents run on <span className="font-mono text-ink-muted">{model}</span> via {provider}
      </p>
    );
  }
  return null;
}

const STAGE_DOT: Record<string, string> = {
  pending: 'border border-dashed border-ink-faint',
  running: 'bg-verified animate-pulse-dot',
  succeeded: 'bg-verified',
  failed: 'bg-conflict',
  cancelled: 'bg-ink-faint',
  skipped: 'border border-ink-faint',
};

/** The pipeline's stages exactly as the server reports them for the current run. */
export function StagePipeline({ detail }: { detail: InvestigationDetail }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10" aria-label="Pipeline stages">
      {detail.progress.map((p) => (
        <li
          key={p.stage}
          className={cn('rounded-md border px-2.5 py-2', p.status === 'failed' ? 'border-conflict/40 bg-conflict/[0.05]' : 'border-line bg-deep/50')}
          title={p.summary ?? undefined}
          data-stage={p.stage}
          data-status={p.status}
        >
          <div className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', STAGE_DOT[p.status])} />
            <span className="truncate text-2xs font-medium text-ink">{STAGE_LABEL[p.stage] ?? p.stage}</span>
          </div>
          <p className="mt-1 text-2xs text-ink-faint">
            {EXECUTION_STATUS[p.status].label}
            {p.steps > 1 ? ` · ${p.succeeded}/${p.steps}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-line bg-void/60 p-2.5 font-mono text-[11px] leading-relaxed text-ink-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ExecutionRow({ e, attempts }: { e: AgentExecution; attempts: number }) {
  const [open, setOpen] = useState(false);
  const role = ROLE[e.agent_role];
  const notes = (e.output?.notes as string[] | undefined) ?? [];
  return (
    <li className="rounded-lg border border-line bg-surface/60" data-testid="execution" data-step={e.step_key ?? ''} data-status={e.status}>
      <button className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight size={14} className={cn('mt-0.5 shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-ink">{role.label}</span>
            <span className="font-mono text-2xs text-ink-faint">{stageName(e.step_key)}</span>
            {attempts > 1 && <Badge tone="unverified">attempt {e.attempt}</Badge>}
            <Badge tone={EXECUTION_STATUS[e.status].tone} dot={e.status === 'running'}>
              {EXECUTION_STATUS[e.status].label}
            </Badge>
          </div>
          {e.summary && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{e.summary}</p>}
          {e.error && <p className="mt-1 break-words text-xs leading-relaxed text-conflict">{e.error}</p>}
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-2xs text-ink-faint">
            <span>{formatDuration(e.duration_ms)}</span>
            {e.provider ? (
              <>
                <span>
                  {e.provider}/{e.model}
                </span>
                <span>
                  {e.input_tokens ?? 0} in · {e.output_tokens ?? 0} out tokens
                </span>
                <span>{formatCost(e.cost_usd)}</span>
                {e.provider_request_id && <span className="font-mono">{e.provider_request_id}</span>}
              </>
            ) : (
              <span className="flex items-center gap-1">
                <Cpu size={11} /> no model call
              </span>
            )}
          </p>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 pb-3 pt-3">
          <p className="text-2xs text-ink-faint">{role.duty}.</p>
          {e.depends_on.length > 0 && <p className="text-2xs text-ink-faint">Depends on: {e.depends_on.map(stageName).join(', ')}</p>}
          {notes.length > 0 && (
            <div>
              <p className="eyebrow mb-1">Validation notes</p>
              <ul className="list-disc space-y-0.5 pl-4 text-2xs text-caution">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="eyebrow mb-1">Input</p>
            <Json value={e.input} />
          </div>
          {e.output && (
            <div>
              <p className="eyebrow mb-1">Output</p>
              <Json value={'result' in e.output ? e.output.result : e.output} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Every recorded agent execution for the current run, in order, with hand-offs between stages. */
export function AgentTimeline({ executions, runCount }: { executions: AgentExecution[]; runCount: number }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => executions.filter((e) => showAll || e.step_key?.startsWith(`r${runCount}:`)), [executions, runCount, showAll]);
  const attempts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of executions) m.set(e.step_key ?? e.id, (m.get(e.step_key ?? e.id) ?? 0) + 1);
    return m;
  }, [executions]);
  if (!executions.length) return <p className="text-sm text-ink-muted">No agent has run yet. Start the investigation to record its execution trace.</p>;
  return (
    <div className="space-y-2">
      {runCount > 1 && (
        <label className="flex items-center gap-2 text-2xs text-ink-muted">
          <input type="checkbox" checked={showAll} onChange={(ev) => setShowAll(ev.target.checked)} /> Show earlier runs
        </label>
      )}
      <ol className="space-y-1.5" aria-label="Agent execution trace">
        {rows.map((e, i) => {
          const prev = rows[i - 1];
          const handoff = prev && prev.agent_role !== e.agent_role;
          return (
            <div key={e.id}>
              {handoff && (
                <p className="flex items-center gap-1.5 py-1 pl-4 text-2xs text-ink-faint">
                  <ArrowDown size={11} /> hand-off to {ROLE[e.agent_role].label}
                </p>
              )}
              <ExecutionRow e={e} attempts={attempts.get(e.step_key ?? e.id) ?? 1} />
            </div>
          );
        })}
      </ol>
    </div>
  );
}
