import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GitCompare, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { ApiError } from '@/lib/api/client';
import { useComparison, useCreateInvestigation, useIntelligenceStatus, useInvestigations, useWorkspaceDocuments } from '@/lib/api/hooks';
import { relativeTime } from '@/lib/format';
import { ProviderNotice } from './components/Activity';
import { INVESTIGATION_STATUS } from './status';

function CreateDialog({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const docs = useWorkspaceDocuments(open ? workspaceId : null);
  const create = useCreateInvestigation(workspaceId);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const error = create.error instanceof ApiError ? create.error.message : create.error ? 'Could not create the investigation.' : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { title: title.trim(), question: question.trim(), document_ids: [...selected] },
      { onSuccess: (inv) => navigate(`/app/investigations/${inv.id}`) },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title="New investigation" description="Ask a research question. Agents read only the documents in scope.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title" htmlFor="inv-title" required>
          <Input id="inv-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </Field>
        <Field label="Research question" htmlFor="inv-question" required hint="At least 10 characters.">
          <Textarea id="inv-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} minLength={10} maxLength={4000} required />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-muted">Documents in scope</legend>
          {docs.isPending ? (
            <SkeletonRows rows={2} />
          ) : docs.data?.items.length ? (
            <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-line p-2">
              <p className="pb-1 text-2xs text-ink-faint">None selected = every document in the workspace.</p>
              {docs.data.items.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(d.id);
                        else n.delete(d.id);
                        return n;
                      })
                    }
                  />
                  {d.title}
                  {!d.has_file && <span className="text-2xs text-caution">metadata only — no text to read</span>}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              This workspace has no documents yet.{' '}
              <Link to="/app/sources" className="text-cyan hover:underline">
                Upload some in Sources
              </Link>{' '}
              first.
            </p>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-conflict">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={create.isPending || question.trim().length < 10 || !title.trim()}>
            {create.isPending ? 'Creating…' : 'Create investigation'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Comparison({ workspaceId, ids }: { workspaceId: string; ids: string[] }) {
  const cmp = useComparison(workspaceId, ids);
  if (cmp.isPending) return <SkeletonRows rows={3} />;
  if (cmp.isError) return <ErrorState error={cmp.error} compact />;
  return (
    <div className="space-y-3" data-testid="comparison">
      <p className="text-xs text-ink-muted">
        Shared entities ({cmp.data.shared_entities.length}):{' '}
        {cmp.data.shared_entities.length ? cmp.data.shared_entities.map((e) => e.name).join(', ') : 'none — these investigations cover different ground.'}
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cmp.data.investigations.map((inv) => (
          <div key={inv.id} className="rounded-lg border border-line bg-deep/40 p-3">
            <p className="text-sm text-ink">{inv.title}</p>
            <p className="mt-0.5 text-2xs text-ink-faint">
              {INVESTIGATION_STATUS[inv.status].label} · {inv.answer_status?.replace('_', ' ') ?? 'no report'} · {inv.entity_count} entities
            </p>
            <ul className="mt-2 space-y-1">
              {inv.hypotheses.map((h) => (
                <li key={h.id} className="text-xs text-ink-muted">
                  — {h.statement} <span className="text-ink-faint">({h.confidence?.toFixed(2) ?? '—'})</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InvestigationsPage() {
  const { active, isPending: wsPending } = useActiveWorkspace();
  const status = useIntelligenceStatus();
  const list = useInvestigations(active?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  return (
    <Page className="space-y-6">
      <PageHeader
        eyebrow="Investigation Room"
        title="Investigations"
        description="Each investigation runs seven agents over your documents and records every step, claim and citation."
        actions={
          <>
            <ButtonLink to="/app/investigations/sample" variant="ghost" size="sm">
              View sample room
            </ButtonLink>
            <Button variant="primary" onClick={() => setCreating(true)} disabled={!active}>
              <Plus size={15} /> New investigation
            </Button>
          </>
        }
      />
      <ProviderNotice status={status.data} />

      {!active && !wsPending ? (
        <EmptyState icon={<Search size={18} />} title="No workspace" description="Create a workspace to start investigating." />
      ) : (
        <Panel
          title="History"
          actions={
            compare.length >= 2 && (
              <Button size="sm" variant="outline" onClick={() => setShowCompare((v) => !v)}>
                <GitCompare size={13} /> {showCompare ? 'Hide comparison' : `Compare ${compare.length}`}
              </Button>
            )
          }
        >
          {list.isPending ? (
            <SkeletonRows rows={4} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <EmptyState
              icon={<Search size={18} />}
              title="No investigations yet"
              description="Ask a question about the documents in this workspace."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  New investigation
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line" aria-label="Investigations">
              {list.data.items.map((inv) => {
                const s = INVESTIGATION_STATUS[inv.status];
                const checked = compare.includes(inv.id);
                return (
                  <li key={inv.id} className="flex items-start gap-3 py-3" data-testid="investigation-row">
                    <input
                      type="checkbox"
                      aria-label={`Select ${inv.title} for comparison`}
                      className="mt-1.5"
                      checked={checked}
                      disabled={!checked && compare.length >= 5}
                      onChange={() => setCompare((c) => (checked ? c.filter((x) => x !== inv.id) : [...c, inv.id]))}
                    />
                    <Link to={`/app/investigations/${inv.id}`} className="group min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink group-hover:text-cyan">{inv.title}</span>
                        <Badge tone={s.tone} dot={s.dot}>
                          {s.label}
                        </Badge>
                        {inv.llm_provider === 'fixture' && <Badge tone="sample">fixture · not AI</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">{inv.question}</p>
                      <p className="mt-0.5 text-2xs text-ink-faint">
                        {inv.run_count ? `${inv.run_count} run(s)` : 'never run'} · updated {relativeTime(inv.updated_at)}
                        {inv.summary ? ` · ${inv.summary}` : ''}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {showCompare && active && compare.length >= 2 && (
            <div className="mt-4 border-t border-line pt-4">
              <Comparison workspaceId={active.id} ids={compare} />
            </div>
          )}
        </Panel>
      )}
      {active && <CreateDialog workspaceId={active.id} open={creating} onClose={() => setCreating(false)} />}
    </Page>
  );
}
