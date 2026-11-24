import { Link } from 'react-router-dom';
import { Activity, AlertOctagon, BookOpenCheck, CircleDot, FileUp, GitBranch, Lightbulb, Network, Search, Share2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/States';
import { EXECUTION_STATUS, INVESTIGATION_STATUS, ROLE, stageName } from '@/features/workbench/status';
import { ENTITY_COLOR } from '@/features/workbench/graph/layout3d';
import { useDashboard, useInvestigations } from '@/lib/api/hooks';
import type { Dashboard as DashboardData, ExecutionStatus } from '@/lib/api/types';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

function Stat({
  label,
  value,
  hint,
  to,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  to?: string;
  icon: typeof Activity;
  tone?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.1em] text-ink-faint">
        <Icon size={12} className={cn('shrink-0', tone)} /> {label}
      </span>
      <span className="mt-1.5 block font-display text-[1.7rem] font-medium leading-none tabular-nums text-ink">{value.toLocaleString()}</span>
      {hint && <span className="mt-1.5 block text-2xs text-ink-faint">{hint}</span>}
    </>
  );
  const cls = 'panel block px-4 py-3.5 transition-colors';
  return to ? (
    <Link to={to} className={cn(cls, 'hover:border-line-strong')} data-testid={`stat-${label}`}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={`stat-${label}`}>
      {body}
    </div>
  );
}

export function StatTiles({ data }: { data: DashboardData }) {
  const { investigations: i, knowledge: k, findings: f } = data;
  return (
    <section aria-label="Workspace statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat
        label="Investigations"
        value={i.total}
        icon={Search}
        to="/app/investigations"
        hint={`${i.completed} completed${i.failed ? ` · ${i.failed} failed` : ''}`}
      />
      <Stat
        label="Active"
        value={i.active}
        icon={Activity}
        tone={i.active ? 'text-verified' : undefined}
        to="/app/investigations?status=active"
        hint="queued or running now"
      />
      <Stat label="Completed" value={i.completed} icon={BookOpenCheck} to="/app/investigations?status=completed" />
      <Stat label="Entities" value={k.entities} icon={CircleDot} to="/app/explorer" hint={`${k.claims.toLocaleString()} evidenced claims`} />
      <Stat label="Relationships" value={k.relationships} icon={Share2} to="/app/universe" />
      <Stat label="Cited findings" value={f.cited_findings} icon={BookOpenCheck} hint="report findings with evidence" />
      <Stat
        label="Open hypotheses"
        value={f.unresolved_hypotheses}
        icon={Lightbulb}
        to="/app/explorer?tab=hypotheses"
        hint={`${f.agreed_hypotheses} agreed after debate · ${f.human_verified_hypotheses} human-verified`}
      />
      <Stat
        label="Open conflicts"
        value={f.unresolved_contradictions}
        icon={AlertOctagon}
        tone={f.unresolved_contradictions ? 'text-conflict' : undefined}
        to="/app/explorer?tab=contradictions"
      />
    </section>
  );
}

export function GraphOverview({ data }: { data: DashboardData }) {
  const types = Object.entries(data.knowledge.entity_types).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...types.map(([, n]) => n));
  return (
    <Panel
      title="Knowledge graph"
      eyebrow="Entities by category"
      actions={
        <ButtonLink to="/app/universe" size="sm" variant="ghost">
          Explore in 3D
        </ButtonLink>
      }
    >
      {types.length === 0 ? (
        <EmptyState
          icon={<Network size={18} />}
          title="The graph is empty"
          description="Entities appear here once an investigation extracts evidenced claims."
        />
      ) : (
        <div className="space-y-4">
          <ul className="space-y-1.5" aria-label="Entity categories">
            {types.map(([type, n]) => (
              <li key={type} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ENTITY_COLOR[type] ?? ENTITY_COLOR.other }} />
                <span className="w-24 shrink-0 capitalize text-ink-muted">{type}</span>
                <span className="h-1.5 flex-1 rounded bg-raised">
                  <span
                    className="block h-1.5 rounded"
                    style={{ width: `${(n / max) * 100}%`, background: ENTITY_COLOR[type] ?? ENTITY_COLOR.other, opacity: 0.7 }}
                  />
                </span>
                <span className="w-8 text-right font-mono text-2xs text-ink">{n}</span>
              </li>
            ))}
          </ul>
          <div>
            <p className="eyebrow mb-1.5">Most mentioned</p>
            <div className="flex flex-wrap gap-1.5">
              {data.knowledge.top_entities.map((e) => (
                <Link
                  key={e.id}
                  to={`/app/universe?entity=${e.id}`}
                  className="rounded border border-line bg-deep/50 px-2 py-1 text-2xs text-ink-muted transition-colors hover:border-cyan/40 hover:text-ink"
                >
                  {e.name} <span className="text-ink-faint">×{e.mention_count}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

const CHANGE_LABEL: Record<string, { label: string; icon: typeof Activity; tone: string }> = {
  relationship_created: { label: 'Relationship', icon: GitBranch, tone: 'text-cyan' },
  hypothesis_added: { label: 'Hypothesis', icon: Lightbulb, tone: 'text-violet' },
  contradiction_linked: { label: 'Contradiction', icon: AlertOctagon, tone: 'text-conflict' },
  entity_created: { label: 'Entity', icon: CircleDot, tone: 'text-verified' },
};

export function RecentDiscoveries({ data }: { data: DashboardData }) {
  return (
    <Panel title="Recent discoveries" eyebrow="Knowledge change log" bodyClassName="p-2">
      {data.recent_discoveries.length === 0 ? (
        <p className="p-3 text-xs text-ink-muted">Nothing discovered yet.</p>
      ) : (
        <ul>
          {data.recent_discoveries.map((d, i) => {
            const meta = CHANGE_LABEL[d.change_type] ?? CHANGE_LABEL.entity_created;
            const text = String(
              d.details.statement ??
                d.details.name ??
                d.details.predicate ??
                (d.details.kind ? `${String(d.details.kind)} conflict between claims` : d.target_key),
            );
            return (
              <li key={i}>
                <Link
                  to={d.investigation ? `/app/investigations/${d.investigation.id}` : '/app/explorer'}
                  className="block rounded-md px-2.5 py-2 hover:bg-raised/50"
                >
                  <span className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.08em]">
                    <meta.icon size={11} className={meta.tone} />
                    <span className={meta.tone}>{meta.label}</span>
                    <span className="ml-auto normal-case tracking-normal text-ink-faint">{relativeTime(d.created_at)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[0.8rem] text-ink">{text}</span>
                  {d.investigation && <span className="block truncate text-2xs text-ink-faint">{d.investigation.title}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function AgentActivity({ data }: { data: DashboardData }) {
  return (
    <Panel title="Agent activity" eyebrow="Recorded executions" bodyClassName="p-2">
      {data.recent_activity.length === 0 ? (
        <p className="p-3 text-xs text-ink-muted">No agent has run in this workspace yet.</p>
      ) : (
        <ul>
          {data.recent_activity.map((a, i) => {
            const st = EXECUTION_STATUS[a.status as ExecutionStatus] ?? EXECUTION_STATUS.pending;
            return (
              <li key={i}>
                <Link to={`/app/investigations/${a.investigation.id}`} className="block rounded-md px-2.5 py-2 hover:bg-raised/50">
                  <span className="flex items-center gap-2">
                    <span className="text-[0.8rem] font-medium text-ink">{ROLE[a.agent_role as keyof typeof ROLE]?.label ?? a.agent_role}</span>
                    <span className="truncate font-mono text-2xs text-ink-faint">{stageName(a.step_key)}</span>
                    <Badge tone={st.tone} className="ml-auto" dot={a.status === 'running'}>
                      {st.label}
                    </Badge>
                  </span>
                  <span className={cn('mt-0.5 block truncate text-2xs', a.error ? 'text-conflict' : 'text-ink-muted')}>{a.error ?? a.summary ?? '—'}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function RecentInvestigations({ workspaceId }: { workspaceId: string }) {
  const list = useInvestigations(workspaceId);
  return (
    <Panel
      title="Recent investigations"
      eyebrow="History"
      bodyClassName="p-2"
      actions={
        <ButtonLink to="/app/investigations" size="sm" variant="ghost">
          All
        </ButtonLink>
      }
    >
      {list.isPending ? (
        <SkeletonRows rows={3} />
      ) : !list.data?.items.length ? (
        <p className="p-3 text-xs text-ink-muted">No investigations yet.</p>
      ) : (
        <ul>
          {list.data.items.slice(0, 6).map((inv) => {
            const s = INVESTIGATION_STATUS[inv.status];
            return (
              <li key={inv.id}>
                <Link to={`/app/investigations/${inv.id}`} className="block rounded-md px-2.5 py-2 hover:bg-raised/50">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[0.82rem] text-ink">{inv.title}</span>
                    <Badge tone={s.tone} dot={s.dot}>
                      {s.label}
                    </Badge>
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-xs text-ink-muted">{inv.question}</span>
                  <span className="mt-0.5 block text-2xs text-ink-faint">updated {relativeTime(inv.updated_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** First-run guide: shown until the workspace has an investigation. */
export function GettingStarted({ data }: { data: DashboardData }) {
  const steps = [
    {
      done: data.documents.total > 0,
      title: 'Add documents',
      text: 'Register a source and upload text, PDF, CSV, JSON, HTML or Markdown files.',
      to: '/app/sources?new=1',
      icon: Upload,
    },
    {
      done: data.investigations.total > 0,
      title: 'Ask a research question',
      text: 'Seven agents read the documents and record every step.',
      to: '/app/investigations?new=1',
      icon: FileUp,
    },
    {
      done: data.knowledge.entities > 0,
      title: 'Explore what was found',
      text: 'Claims, entities, hypotheses and conflicts, each tied to quotes.',
      to: '/app/universe',
      icon: Network,
    },
  ];
  return (
    <section aria-label="Getting started" className="panel p-5" data-testid="getting-started">
      <p className="eyebrow">Getting started</p>
      <h2 className="mt-1 font-display text-lg text-ink">Run your first investigation</h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              to={s.to}
              className={cn('block h-full rounded-lg border p-3.5 transition-colors hover:border-cyan/40', s.done ? 'border-verified/30' : 'border-line')}
            >
              <span className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    'grid h-5 w-5 place-items-center rounded-full font-mono text-2xs',
                    s.done ? 'bg-verified/20 text-verified' : 'bg-raised text-ink-muted',
                  )}
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <s.icon size={14} className="text-ink-faint" />
                <span className="font-medium text-ink">{s.title}</span>
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">{s.text}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DashboardSections({ workspaceId }: { workspaceId: string }) {
  const q = useDashboard(workspaceId);
  if (q.isPending)
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <SkeletonRows rows={4} />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data;
  return (
    <div className="space-y-4">
      {data.investigations.total === 0 && <GettingStarted data={data} />}
      <StatTiles data={data} />
      <div className="grid gap-4 xl:grid-cols-3">
        <GraphOverview data={data} />
        <RecentDiscoveries data={data} />
        <AgentActivity data={data} />
      </div>
      <RecentInvestigations workspaceId={workspaceId} />
    </div>
  );
}
