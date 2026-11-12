import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FilePlus2, FolderOpen, Orbit, Plus, Search, Sparkles } from 'lucide-react';
import { Badge, SampleBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { DISCOVERIES, DISCOVERY_META, STATUS_META } from '@/data/sample/discoveries';
import { graphStats, sampleGraph } from '@/data/sample/graph';
import { SAMPLE_INVESTIGATIONS } from '@/data/sample/investigations';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { useSources } from '@/lib/api/hooks';
import { formatDate, pluralize, relativeTime } from '@/lib/format';
import { useUi } from '@/stores/ui';

function GraphSummary() {
  const stats = graphStats(sampleGraph);
  const clusters = sampleGraph.clusters.map((c) => ({ ...c, count: sampleGraph.nodes.filter((n) => n.cluster === c.id).length }));
  const max = Math.max(...clusters.map((c) => c.count));
  return (
    <Panel title="Knowledge graph" eyebrow="Universe" actions={<SampleBadge label="Sample" />}>
      <dl className="grid grid-cols-3 gap-3">
        {[
          ['Nodes', stats.nodes],
          ['Relationships', stats.edges],
          ['Clusters', stats.clusters],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-md border border-line bg-deep/60 px-3 py-2.5">
            <dt className="text-2xs uppercase tracking-[0.1em] text-ink-faint">{k}</dt>
            <dd className="mt-1 font-display text-xl font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="eyebrow mb-2 mt-5">Nodes per cluster</p>
      <ul className="space-y-1.5">
        {clusters.map((c) => (
          <li key={c.id} className="grid grid-cols-[120px_1fr_24px] items-center gap-3 text-xs">
            <span className="truncate text-ink-muted">{c.label}</span>
            <span className="h-1.5 rounded-full bg-line">
              <span className="block h-full rounded-full" style={{ width: `${(c.count / max) * 100}%`, background: c.color, opacity: 0.8 }} />
            </span>
            <span className="text-right font-mono text-2xs text-ink-faint">{c.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
        <span className="text-2xs text-ink-faint">Counts computed from the sample graph.</span>
        <Link to="/app/universe" className="inline-flex items-center gap-1 text-xs text-cyan hover:underline">
          Explore <ArrowRight size={12} />
        </Link>
      </div>
    </Panel>
  );
}

function WorkspacesPanel() {
  const { workspaces, active, isLoading, isError, error, refetch, setActiveId } = useActiveWorkspace();
  const openCreate = useUi((s) => s.setCreateWorkspaceOpen);
  const recent = [...workspaces].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  return (
    <Panel
      title="Recent workspaces"
      eyebrow="Live · API"
      actions={
        <Button size="sm" variant="ghost" onClick={() => openCreate(true)}>
          <Plus size={13} /> New
        </Button>
      }
      bodyClassName="p-2"
    >
      {isLoading ? (
        <div className="p-2">
          <SkeletonRows rows={3} />
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} compact />
      ) : recent.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={17} />}
          title="No workspaces yet"
          description="Create a workspace to start registering sources."
          action={
            <Button variant="primary" size="sm" onClick={() => openCreate(true)}>
              Create workspace
            </Button>
          }
        />
      ) : (
        <ul>
          {recent.map((ws) => (
            <li key={ws.id}>
              <button onClick={() => setActiveId(ws.id)} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-raised/50">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-cyan/10 font-display text-xs font-semibold text-cyan">
                  {ws.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.82rem] text-ink">{ws.name}</span>
                  <span className="block text-2xs text-ink-faint">
                    {pluralize(ws.source_count, 'source')} · updated {relativeTime(ws.updated_at)}
                  </span>
                </span>
                {ws.id === active?.id && <Badge tone="cyan">Active</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SourcesPanel() {
  const { active, isError: wsError } = useActiveWorkspace();
  const sources = useSources(active?.id ?? null);
  const items = sources.data?.items.slice(0, 5) ?? [];
  return (
    <Panel
      title="Recently added sources"
      eyebrow="Live · API"
      actions={
        <Link to="/app/sources" className="text-xs text-cyan hover:underline">
          View all
        </Link>
      }
      bodyClassName="p-2"
    >
      {wsError ? (
        <p className="px-3 py-6 text-center text-xs text-ink-muted">Sources load once the API is reachable.</p>
      ) : !active ? (
        <p className="px-3 py-6 text-center text-xs text-ink-muted">Create a workspace to register sources.</p>
      ) : sources.isLoading ? (
        <div className="p-2">
          <SkeletonRows rows={3} />
        </div>
      ) : sources.isError ? (
        <ErrorState error={sources.error} onRetry={() => sources.refetch()} compact />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FilePlus2 size={17} />}
          title="No sources in this workspace"
          description="Register a paper, report or dataset to begin building provenance."
          action={
            <ButtonLink to="/app/sources?new=1" size="sm" variant="primary">
              Register source
            </ButtonLink>
          }
        />
      ) : (
        <ul>
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-md px-2.5 py-2">
              <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-2xs uppercase text-ink-muted">{s.source_type}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.82rem] text-ink">{s.title}</span>
                <span className="block text-2xs text-ink-faint">Registered {formatDate(s.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ActivityTimeline() {
  const { workspaces, active } = useActiveWorkspace();
  const sources = useSources(active?.id ?? null);
  const events = useMemo(() => {
    const list = [
      ...workspaces.map((w) => ({ id: `w-${w.id}`, at: w.created_at, text: `Workspace “${w.name}” created`, kind: 'workspace' as const })),
      ...(sources.data?.items ?? []).map((s) => ({ id: `s-${s.id}`, at: s.created_at, text: `Source “${s.title}” registered`, kind: 'source' as const })),
    ];
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [workspaces, sources.data]);

  return (
    <Panel title="Activity" eyebrow="Live · API">
      {events.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-muted">Activity appears here as you create workspaces and register sources.</p>
      ) : (
        <ol className="relative space-y-4 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-line">
          {events.map((e) => (
            <li key={e.id} className="relative pl-6">
              <span
                className={`absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 border-abyss ${e.kind === 'workspace' ? 'bg-cyan' : 'bg-verified'}`}
              />
              <p className="text-[0.8rem] text-ink">{e.text}</p>
              <p className="text-2xs text-ink-faint">{relativeTime(e.at)}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default function OverviewPage() {
  const { active } = useActiveWorkspace();
  const openCreate = useUi((s) => s.setCreateWorkspaceOpen);
  const openCommand = useUi((s) => s.setCommandOpen);
  useEffect(() => {
    document.title = 'Overview · ASTRION';
  }, []);

  const quick = [
    { label: 'Register a source', hint: 'Add metadata via the API', icon: FilePlus2, to: '/app/sources?new=1' },
    { label: 'Explore the universe', hint: 'Open the graph explorer', icon: Orbit, to: '/app/universe' },
    { label: 'Open investigation room', hint: 'Claims and evidence', icon: Search, to: '/app/investigations' },
    { label: 'Review discoveries', hint: 'Hypotheses and gaps', icon: Sparkles, to: '/app/discovery' },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow="Overview"
        title={active?.name ?? 'Your intelligence workspace'}
        description={
          active?.description ??
          'A summary of your workspace: live data from the API, alongside clearly labelled sample content for capabilities still in development.'
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => openCommand(true)}>
              <Search size={14} /> Search
            </Button>
            <Button variant="primary" onClick={() => openCreate(true)}>
              <Plus size={14} /> New workspace
            </Button>
          </>
        }
      />

      <section aria-label="Quick actions" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {quick.map((q) => (
          <Link key={q.label} to={q.to} className="group panel flex items-center gap-3 px-4 py-3.5 transition-colors hover:border-line-strong">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-deep text-ink-muted group-hover:border-cyan/40 group-hover:text-cyan">
              <q.icon size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.82rem] font-medium text-ink">{q.label}</span>
              <span className="block truncate text-2xs text-ink-faint">{q.hint}</span>
            </span>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <WorkspacesPanel />
        <SourcesPanel />
        <ActivityTimeline />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <GraphSummary />
        <Panel title="Latest discoveries" eyebrow="Discovery" actions={<SampleBadge label="Sample" />} bodyClassName="p-2">
          <ul>
            {DISCOVERIES.map((d) => (
              <li key={d.id}>
                <Link to={`/app/discovery?d=${d.id}`} className="block rounded-md px-2.5 py-2 hover:bg-raised/50">
                  <span className="flex items-center gap-2">
                    <span className="text-2xs font-medium uppercase tracking-[0.1em]" style={{ color: DISCOVERY_META[d.type].color }}>
                      {DISCOVERY_META[d.type].label}
                    </span>
                    <Badge tone={STATUS_META[d.status].tone}>{STATUS_META[d.status].label}</Badge>
                  </span>
                  <span className="mt-1 block truncate text-[0.82rem] text-ink">{d.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Recent investigations" eyebrow="Investigation" actions={<SampleBadge label="Sample" />} bodyClassName="p-2">
          <ul>
            {SAMPLE_INVESTIGATIONS.map((inv) => (
              <li key={inv.id}>
                <Link to={`/app/investigations?i=${inv.id}`} className="block rounded-md px-2.5 py-2 hover:bg-raised/50">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[0.82rem] text-ink">{inv.title}</span>
                    <Badge tone={inv.status === 'active' ? 'cyan' : 'neutral'}>{inv.status}</Badge>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-ink-muted">{inv.question}</span>
                  <span className="mt-1.5 block text-2xs text-ink-faint">
                    {pluralize(inv.claims.length, 'claim')} · {pluralize(inv.sourceIds.length, 'source')} · {inv.updated}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
