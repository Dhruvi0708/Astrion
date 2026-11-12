import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilePlus2, FolderOpen, Search } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Form';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { useSources } from '@/lib/api/hooks';
import { cn } from '@/lib/cn';
import { formatDate, pluralize } from '@/lib/format';
import { useUi } from '@/stores/ui';
import { ApiError } from '@/lib/api/client';
import { DataStatusBadge } from './DataStatusBadge';
import { SourceDetail } from './SourceDetail';
import { SourceForm, TYPE_LABEL } from './SourceForm';

export default function SourcesPage() {
  const [params, setParams] = useSearchParams();
  const ws = useActiveWorkspace();
  const sources = useSources(ws.active?.id ?? null);
  const openCreateWs = useUi((s) => s.setCreateWorkspaceOpen);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const formOpen = params.get('new') === '1';

  useEffect(() => {
    document.title = 'Sources · ASTRION';
  }, []);

  const setFormOpen = (open: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (open) next.set('new', '1');
        else next.delete('new');
        return next;
      },
      { replace: true },
    );

  const items = useMemo(() => {
    const all = sources.data?.items ?? [];
    const term = q.trim().toLowerCase();
    return term ? all.filter((s) => `${s.title} ${s.authors.join(' ')} ${s.source_type}`.toLowerCase().includes(term)) : all;
  }, [sources.data, q]);
  const selected = items.find((s) => s.id === selectedId) ?? null;

  let body: React.ReactNode;
  if (ws.isLoading)
    body = (
      <div className="p-4">
        <SkeletonRows rows={4} />
      </div>
    );
  else if (ws.isError) body = <ErrorState error={ws.error} onRetry={() => ws.refetch()} />;
  else if (!ws.active)
    body = (
      <EmptyState
        icon={<FolderOpen size={17} />}
        title="Create a workspace first"
        description="Sources belong to a workspace. Create one to begin registering papers, reports and datasets."
        action={
          <Button variant="primary" onClick={() => openCreateWs(true)}>
            Create workspace
          </Button>
        }
      />
    );
  else if (sources.isLoading)
    body = (
      <div className="p-4">
        <SkeletonRows rows={4} />
      </div>
    );
  else if (sources.isError) body = <ErrorState error={sources.error} onRetry={() => sources.refetch()} />;
  else if (!sources.data?.items.length)
    body = (
      <EmptyState
        icon={<FilePlus2 size={17} />}
        title="No sources registered"
        description="Register the first source for this workspace. ASTRION records its provenance so every future claim can be traced back to it."
        action={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            Register source
          </Button>
        }
      />
    );
  else
    body = (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-line text-2xs uppercase tracking-[0.1em] text-ink-faint">
              <th scope="col" className="px-4 py-2.5 font-normal">
                Title
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Type
              </th>
              <th scope="col" className="hidden px-4 py-2.5 font-normal 2xl:table-cell">
                Authors
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Documents
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Registered
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className={cn('border-b border-line/60 transition-colors', s.id === selectedId ? 'bg-raised/60' : 'hover:bg-raised/30')}>
                <td className="max-w-[280px] px-4 py-2.5">
                  <button onClick={() => setSelectedId(s.id)} className="block w-full truncate text-left text-[0.82rem] text-ink hover:text-cyan">
                    {s.title}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <Badge>{TYPE_LABEL[s.source_type]}</Badge>
                </td>
                <td className="hidden max-w-[200px] truncate px-4 py-2.5 text-ink-muted 2xl:table-cell">{s.authors.join(', ') || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-ink-muted">{s.document_count}</td>
                <td className="px-4 py-2.5 text-ink-muted">{formatDate(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="px-4 py-8 text-center text-xs text-ink-muted">No sources match “{q}”.</p>}
      </div>
    );

  return (
    <Page>
      <PageHeader
        eyebrow="Sources"
        title="Sources & documents"
        badges={
          <DataStatusBadge
            loading={ws.isLoading || sources.isLoading}
            queryFailed={(ws.isError && (ws.error as ApiError | null)?.isUnavailable) || (sources.isError && (sources.error as ApiError | null)?.isUnavailable)}
          />
        }
        description="Register the origin of every piece of knowledge. Sources hold bibliographic provenance; documents are the concrete artifacts that belong to them."
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)} disabled={!ws.active}>
            <FilePlus2 size={14} /> Register source
          </Button>
        }
      />

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Source list" className="panel min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="text-xs text-ink-muted">
              {ws.active ? (
                <>
                  <span className="text-ink">{ws.active.name}</span> · {pluralize(sources.data?.total ?? 0, 'source')}
                </>
              ) : (
                'No workspace selected'
              )}
            </p>
            <div className="relative w-full sm:w-64">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter sources…" aria-label="Filter sources" className="h-8 pl-8 text-xs" />
            </div>
          </div>
          {body}
        </section>
        <aside aria-label="Source details" className="panel min-h-[320px] overflow-hidden">
          {selected ? (
            <SourceDetail source={selected} onClose={() => setSelectedId(null)} />
          ) : (
            <EmptyState title="No source selected" description="Select a source to view its provenance metadata and documents." className="h-full" />
          )}
        </aside>
      </div>

      <Dialog
        open={formOpen && Boolean(ws.active)}
        onClose={() => setFormOpen(false)}
        title="Register source"
        description={ws.active ? `Adds a source to “${ws.active.name}”.` : undefined}
        className="max-w-xl"
      >
        {ws.active && (
          <SourceForm
            workspaceId={ws.active.id}
            onCancel={() => setFormOpen(false)}
            onCreated={(s) => {
              setFormOpen(false);
              setSelectedId(s.id);
            }}
          />
        )}
      </Dialog>
    </Page>
  );
}
