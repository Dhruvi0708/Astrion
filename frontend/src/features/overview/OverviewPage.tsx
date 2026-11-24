import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, FolderOpen, Orbit, Plus, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { DashboardSections } from './Dashboard';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { useSources } from '@/lib/api/hooks';
import { formatDate, pluralize, relativeTime } from '@/lib/format';
import { useUi } from '@/stores/ui';

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

export default function OverviewPage() {
  const { active } = useActiveWorkspace();
  const openCreate = useUi((s) => s.setCreateWorkspaceOpen);
  const openCommand = useUi((s) => s.setCommandOpen);
  useEffect(() => {
    document.title = 'Overview · ASTRION';
  }, []);

  const quick = [
    { label: 'Start an investigation', hint: 'Ask a research question', icon: Search, to: '/app/investigations?new=1' },
    { label: 'Add documents', hint: 'Upload files to a source', icon: FilePlus2, to: '/app/sources?new=1' },
    { label: 'Explore the graph', hint: 'Entities and relationships in 3D', icon: Orbit, to: '/app/universe' },
    { label: 'Browse discoveries', hint: 'Hypotheses, conflicts, evidence', icon: Sparkles, to: '/app/explorer' },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow="Dashboard"
        title={active?.name ?? 'Your intelligence workspace'}
        description={active?.description ?? 'The state of this workspace: every number below is read from your investigations, documents and knowledge graph.'}
        actions={
          <>
            <Button variant="ghost" onClick={() => openCommand(true)}>
              <Search size={14} /> Search
            </Button>
            <Button variant="ghost" onClick={() => openCreate(true)}>
              <Plus size={14} /> New workspace
            </Button>
            <ButtonLink to="/app/investigations?new=1" variant="primary">
              <Search size={14} /> New investigation
            </ButtonLink>
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

      <div className="mt-6">{active ? <DashboardSections workspaceId={active.id} /> : null}</div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <WorkspacesPanel />
        <SourcesPanel />
      </div>
    </Page>
  );
}
