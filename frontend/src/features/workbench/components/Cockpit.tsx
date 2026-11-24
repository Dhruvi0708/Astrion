import { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, Clock, Cpu, Lightbulb, Quote, Radio, RefreshCw, Scale, Share2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { AgentExecution, AgentRole, InvestigationDetail } from '@/lib/api/types';
import type { LiveState } from '@/lib/api/hooks';
import { formatDate, parseTime } from '@/lib/format';
import { EXECUTION_STATUS, ROLE, formatDuration } from '../status';

const ROSTER: AgentRole[] = ['orchestrator', 'research', 'knowledge', 'planner', 'hypothesis', 'contradiction', 'challenger', 'verification', 'synthesis'];

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

const LIVE_LABEL: Record<LiveState, { label: string; tone: 'live' | 'cyan' | 'neutral' | 'unverified' }> = {
  live: { label: 'Live · server events', tone: 'live' },
  connecting: { label: 'Connecting…', tone: 'cyan' },
  polling: { label: 'Live · polling', tone: 'unverified' },
  ended: { label: 'Recorded', tone: 'neutral' },
};

/** Created date, duration, progress and connection state, all from the server's records. */
export function RunMeta({ detail, liveState, active }: { detail: InvestigationDetail; liveState: LiveState; active: boolean }) {
  const now = useNow(active);
  const started = detail.started_at ? parseTime(detail.started_at).getTime() : null;
  const finished = detail.finished_at ? parseTime(detail.finished_at).getTime() : null;
  const duration = started ? (finished && !active ? finished : now) - started : null;
  const stages = detail.progress;
  const done = stages.filter((p) => ['succeeded', 'skipped', 'failed', 'cancelled'].includes(p.status)).length;
  const pct = stages.length ? Math.round((done / stages.length) * 100) : 0;
  const live = LIVE_LABEL[active ? liveState : 'ended'];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-2xs text-ink-faint" data-testid="run-meta">
      <span>Created {formatDate(detail.created_at)}</span>
      <span className="flex items-center gap-1">
        <Clock size={11} /> {duration != null && duration >= 0 ? formatDuration(duration) : 'not started'}
      </span>
      {stages.length > 0 && (
        <span className="flex items-center gap-2" title={`${done} of ${stages.length} stages finished`}>
          <span className="h-1.5 w-28 rounded bg-raised">
            <span className={cn('block h-1.5 rounded', detail.status === 'failed' ? 'bg-conflict' : 'bg-cyan/80')} style={{ width: `${pct}%` }} />
          </span>
          <span className="font-mono text-ink-muted">{pct}%</span>
        </span>
      )}
      <Badge tone={live.tone} dot={active}>
        <Radio size={10} /> {live.label}
      </Badge>
    </div>
  );
}

/** One card per agent: identity, responsibility, and its state in the current run, derived from executions. */
export function AgentRoster({ executions, runCount }: { executions: AgentExecution[]; runCount: number }) {
  const current = executions.filter((e) => e.step_key?.startsWith(`r${runCount}:`));
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Agents">
      {ROSTER.map((role) => {
        const mine = current.filter((e) => e.agent_role === role);
        const latestByStep = new Map<string, AgentExecution>();
        for (const e of mine) {
          const prev = latestByStep.get(e.step_key ?? e.id);
          if (!prev || e.attempt >= prev.attempt) latestByStep.set(e.step_key ?? e.id, e);
        }
        const latest = [...latestByStep.values()];
        const status = latest.some((e) => e.status === 'running')
          ? 'running'
          : latest.some((e) => e.status === 'failed')
            ? 'failed'
            : latest.length && latest.every((e) => e.status === 'skipped')
              ? 'skipped'
              : latest.length
                ? 'succeeded'
                : null;
        const retries = mine.filter((e) => e.attempt > 1).length;
        const error = latest.find((e) => e.status === 'failed')?.error;
        const tokens = mine.reduce((n, e) => n + (e.input_tokens ?? 0) + (e.output_tokens ?? 0), 0);
        return (
          <li
            key={role}
            className={cn(
              'rounded-lg border bg-surface/60 p-3 transition-colors',
              status === 'running'
                ? 'border-verified/50 shadow-[0_0_0_1px_rgb(var(--verified)/0.15)]'
                : status === 'failed'
                  ? 'border-conflict/40'
                  : 'border-line',
            )}
            data-testid="agent-card"
            data-role={role}
            data-status={status ?? 'idle'}
          >
            <div className="flex items-center gap-2">
              <Cpu size={13} className={status === 'running' ? 'text-verified' : 'text-ink-faint'} />
              <span className="text-sm font-medium text-ink">{ROLE[role].label}</span>
              {status ? (
                <Badge tone={EXECUTION_STATUS[status].tone} dot={status === 'running'} className="ml-auto">
                  {EXECUTION_STATUS[status].label}
                </Badge>
              ) : (
                <span className="ml-auto text-2xs text-ink-faint">not run</span>
              )}
            </div>
            <p className="mt-1 text-2xs leading-relaxed text-ink-muted">{ROLE[role].duty}.</p>
            <p className="mt-1.5 flex flex-wrap gap-x-3 text-2xs text-ink-faint">
              <span>{latest.length} step(s)</span>
              {retries > 0 && (
                <span className="flex items-center gap-1 text-caution">
                  <RefreshCw size={10} /> {retries} retr{retries === 1 ? 'y' : 'ies'}
                </span>
              )}
              {tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
            </p>
            {error && (
              <p className="mt-1.5 flex gap-1 break-words text-2xs text-conflict">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What the run has produced so far, from the server's counts. */
export function DiscoveryCounters({ detail }: { detail: InvestigationDetail }) {
  const c = detail.counts;
  const items = [
    { label: 'Claims', value: c.claims ?? 0, icon: Quote },
    { label: 'Hypotheses', value: c.hypotheses ?? 0, icon: Lightbulb },
    { label: 'Contradictions', value: c.contradictions ?? 0, icon: Scale },
    { label: 'Graph changes', value: c.graph_changes ?? 0, icon: Share2 },
    { label: 'Reports', value: c.reports ?? 0, icon: BookOpen },
  ];
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Discoveries so far">
      {items.map((x) => (
        <li key={x.label} className="rounded-md border border-line bg-deep/50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.08em] text-ink-faint">
            <x.icon size={11} /> {x.label}
          </span>
          <span className="mt-0.5 block font-mono text-lg text-ink tabular-nums">{x.value}</span>
        </li>
      ))}
    </ul>
  );
}
