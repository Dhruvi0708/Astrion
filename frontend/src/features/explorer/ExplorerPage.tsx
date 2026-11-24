import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleDot, FileText, GitBranch, Lightbulb, Quote, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { ContradictionCard } from '@/features/workbench/components/Findings';
import { DebateThread } from '@/features/workbench/components/Intelligence';
import { ENTITY_COLOR } from '@/features/workbench/graph/layout3d';
import { CONSENSUS, REASONING, VERDICT } from '@/features/workbench/status';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { api } from '@/lib/api/client';
import { useExplorer } from '@/lib/api/hooks';
import type { EntityRow, EvidenceRow, PageOf, WorkspaceContradiction, WorkspaceHypothesis } from '@/lib/api/types';

type Tab = 'entities' | 'hypotheses' | 'contradictions' | 'evidence';
const PAGE = 25;

function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Pager({ page, total, offset, onOffset }: { page: { length: number }; total: number; offset: number; onOffset: (o: number) => void }) {
  if (total <= PAGE) return <p className="mt-3 text-2xs text-ink-faint">{total} result(s)</p>;
  return (
    <div className="mt-3 flex items-center gap-2 text-2xs text-ink-faint">
      <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - PAGE))}>
        Previous
      </Button>
      <span>
        {offset + 1}–{offset + page.length} of {total}
      </span>
      <Button size="sm" variant="ghost" disabled={offset + PAGE >= total} onClick={() => onOffset(offset + PAGE)}>
        Next
      </Button>
    </div>
  );
}

function Results<T>({
  q,
  empty,
  render,
}: {
  q: { isPending: boolean; isError: boolean; error: unknown; data?: PageOf<T>; refetch: () => void };
  empty: string;
  render: (data: PageOf<T>) => React.ReactNode;
}) {
  if (q.isPending) return <SkeletonRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data?.items.length) return <EmptyState title="Nothing here yet" description={empty} />;
  return <>{render(q.data)}</>;
}

function EntitiesView({ ws }: { ws: string }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const params = { q: dq || undefined, entity_type: type || undefined, limit: PAGE, offset };
  const res = useExplorer('entities', ws, params, () => api.explorerEntities(ws, params));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search entities"
          placeholder="Search entities"
          value={q}
          onChange={(e) => (setQ(e.target.value), setOffset(0))}
          className="h-8 w-64"
        />
        <Select aria-label="Entity category" value={type} onChange={(e) => (setType(e.target.value), setOffset(0))} className="h-8 w-44">
          <option value="">All categories</option>
          {Object.keys(ENTITY_COLOR).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>
      <Results<EntityRow>
        q={res}
        empty="Entities appear once an investigation extracts evidenced claims."
        render={(d) => (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs" data-testid="entities-table">
                <thead className="text-2xs uppercase tracking-wider text-ink-faint">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Entity</th>
                    <th className="py-2 pr-3 font-medium">Category</th>
                    <th className="py-2 pr-3 font-medium">Mentions</th>
                    <th className="py-2 pr-3 font-medium">Claims</th>
                    <th className="py-2 pr-3 font-medium">Connections</th>
                    <th className="py-2 font-medium">Investigations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.items.map((e) => (
                    <tr key={e.id} className="hover:bg-raised/30">
                      <td className="py-2 pr-3">
                        <Link to={`/app/universe?entity=${e.id}`} className="flex items-center gap-2 text-ink hover:text-cyan">
                          <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_COLOR[e.entity_type] ?? ENTITY_COLOR.other }} />
                          {e.name}
                        </Link>
                        {e.aliases.length > 0 && <span className="text-2xs text-ink-faint">also {e.aliases.join(', ')}</span>}
                      </td>
                      <td className="py-2 pr-3 capitalize text-ink-muted">{e.entity_type}</td>
                      <td className="py-2 pr-3 font-mono text-ink-muted">{e.mention_count}</td>
                      <td className="py-2 pr-3 font-mono text-ink-muted">{e.claims}</td>
                      <td className="py-2 pr-3 font-mono text-ink-muted">{e.relationships}</td>
                      <td className="py-2 text-ink-muted">
                        {e.investigations.map((i) => (
                          <Link key={i.id} to={`/app/investigations/${i.id}`} className="mr-2 hover:text-ink">
                            {i.title}
                          </Link>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={d.items} total={d.total} offset={offset} onOffset={setOffset} />
          </>
        )}
      />
    </div>
  );
}

function HypothesisRow({ h }: { h: WorkspaceHypothesis }) {
  const [open, setOpen] = useState(false);
  const m = h.confidence_method;
  return (
    <li className="rounded-lg border border-line bg-surface/60 p-3.5" data-testid="explorer-hypothesis">
      <button className="w-full text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="hypothesis">
            <Lightbulb size={11} /> Hypothesis
          </Badge>
          <Badge tone="neutral">{h.status.replace('_', ' ')}</Badge>
          {h.reasoning_type && REASONING[h.reasoning_type] && <Badge tone={REASONING[h.reasoning_type].tone}>{REASONING[h.reasoning_type].label}</Badge>}
          {h.consensus && CONSENSUS[h.consensus] && <Badge tone={CONSENSUS[h.consensus].tone}>consensus: {CONSENSUS[h.consensus].label}</Badge>}
          {h.revises_hypothesis_id && (
            <Badge tone="hypothesis" title="Re-evaluates an earlier investigation's hypothesis">
              <GitBranch size={10} /> revised
            </Badge>
          )}
          {m && <span className="ml-auto font-mono text-2xs text-ink-faint">confidence {m.score.toFixed(2)}</span>}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink">{h.statement}</p>
        <p className="mt-1 text-2xs text-ink-faint">
          {h.supporting_claim_ids.length} supporting · {h.opposing_claim_ids.length} opposing ·{' '}
          <Link to={`/app/investigations/${h.investigation.id}`} className="hover:text-ink" onClick={(e) => e.stopPropagation()}>
            {h.investigation.title}
          </Link>
        </p>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs text-ink-muted">
          <p className="whitespace-pre-line">{h.rationale}</p>
          {!!h.falsification_conditions?.length && <p>Falsified by: {h.falsification_conditions.join('; ')}</p>}
          {!!h.assumptions?.length && <p>Assumes: {h.assumptions.join('; ')}</p>}
          {h.verification && (
            <p>
              Verification: <Badge tone={VERDICT[h.verification.verdict].tone}>{VERDICT[h.verification.verdict].label}</Badge> {h.verification.reasoning}
            </p>
          )}
          {h.debate?.objections && <DebateThread debate={h.debate} claimsById={new Map()} />}
        </div>
      )}
    </li>
  );
}

function HypothesesView({ ws }: { ws: string }) {
  const [q, setQ] = useState('');
  const [consensus, setConsensus] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const params = { q: dq || undefined, consensus: consensus || undefined, limit: PAGE, offset };
  const res = useExplorer('hypotheses', ws, params, () => api.explorerHypotheses(ws, params));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search hypotheses"
          placeholder="Search hypotheses"
          value={q}
          onChange={(e) => (setQ(e.target.value), setOffset(0))}
          className="h-8 w-64"
        />
        <Select aria-label="Consensus" value={consensus} onChange={(e) => (setConsensus(e.target.value), setOffset(0))} className="h-8 w-44">
          <option value="">Any consensus</option>
          {Object.entries(CONSENSUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      <Results<WorkspaceHypothesis>
        q={res}
        empty="Hypotheses are proposed when an investigation finds evidenced claims."
        render={(d) => (
          <>
            <ul className="space-y-2">
              {d.items.map((h) => (
                <HypothesisRow key={h.id} h={h} />
              ))}
            </ul>
            <Pager page={d.items} total={d.total} offset={offset} onOffset={setOffset} />
          </>
        )}
      />
    </div>
  );
}

function ContradictionsView({ ws }: { ws: string }) {
  const [resolved, setResolved] = useState('');
  const [offset, setOffset] = useState(0);
  const params = { resolved: resolved || undefined, limit: PAGE, offset };
  const res = useExplorer('contradictions', ws, params, () => api.explorerContradictions(ws, params));
  return (
    <div className="space-y-3">
      <Select aria-label="Resolution" value={resolved} onChange={(e) => (setResolved(e.target.value), setOffset(0))} className="h-8 w-48">
        <option value="">All conflicts</option>
        <option value="false">Unresolved</option>
        <option value="true">Resolved</option>
      </Select>
      <Results<WorkspaceContradiction>
        q={res}
        empty="Conflicts appear when claims from different sources disagree."
        render={(d) => (
          <>
            <ul className="space-y-3">
              {d.items.map((x) => (
                <div key={x.id}>
                  <p className="mb-1 text-2xs text-ink-faint">
                    <Scale size={10} className="mr-1 inline" />
                    <Link to={`/app/investigations/${x.investigation.id}`} className="hover:text-ink">
                      {x.investigation.title}
                    </Link>
                  </p>
                  <ContradictionCard x={x} />
                </div>
              ))}
            </ul>
            <Pager page={d.items} total={d.total} offset={offset} onOffset={setOffset} />
          </>
        )}
      />
    </div>
  );
}

function EvidenceView({ ws }: { ws: string }) {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const params = { q: dq || undefined, limit: PAGE, offset };
  const res = useExplorer('evidence', ws, params, () => api.explorerEvidence(ws, params));
  return (
    <div className="space-y-3">
      <Input
        aria-label="Search evidence"
        placeholder="Search quotes and claims"
        value={q}
        onChange={(e) => (setQ(e.target.value), setOffset(0))}
        className="h-8 w-72"
      />
      <Results<EvidenceRow>
        q={res}
        empty="Evidence is recorded as verbatim quotes when claims are extracted."
        render={(d) => (
          <>
            <ul className="space-y-2">
              {d.items.map((e) => (
                <li key={e.id} className="rounded-lg border border-line bg-surface/60 p-3.5" data-testid="explorer-evidence">
                  <blockquote className="flex gap-1.5 border-l-2 border-cyan/40 pl-2.5 text-sm italic leading-relaxed text-ink">
                    <Quote size={12} className="mt-1 shrink-0 not-italic text-ink-faint" />“{e.quote}”
                  </blockquote>
                  <dl className="mt-2.5 grid gap-x-4 gap-y-1 text-2xs sm:grid-cols-[110px_1fr]">
                    <dt className="text-ink-faint">Extracted claim</dt>
                    <dd className="text-ink-muted">
                      {e.claim.statement} <Badge tone={e.claim.kind === 'explicit' ? 'neutral' : 'unverified'}>{e.claim.kind}</Badge>
                      {e.claim.superseded && <Badge tone="unverified">outdated</Badge>}
                    </dd>
                    <dt className="text-ink-faint">Source</dt>
                    <dd className="flex items-center gap-1 text-ink-muted">
                      <FileText size={10} /> {e.document?.title} · {e.source?.title} ({e.source?.source_type})
                      {e.source?.uri && (
                        <a href={e.source.uri} target="_blank" rel="noreferrer noopener" className="text-cyan hover:underline">
                          open
                        </a>
                      )}
                    </dd>
                    <dt className="text-ink-faint">Location</dt>
                    <dd className="font-mono text-ink-muted">
                      passage {String((e.locator.chunk_index as number | undefined) ?? '?')}
                      {e.locator.page ? ` · page ${String(e.locator.page)}` : ''}
                      {e.claim.period ? ` · speaks about ${e.claim.period.filter(Boolean).join('–')}` : ''}
                    </dd>
                    <dt className="text-ink-faint">Provenance</dt>
                    <dd className="text-ink-muted">
                      extracted by {e.claim.extractor ?? 'unknown'} · verbatim-checked · cited by {e.used_by_hypotheses} hypothesis(es)
                    </dd>
                    {e.entity && (
                      <>
                        <dt className="text-ink-faint">About</dt>
                        <dd>
                          <Link to={`/app/universe?entity=${e.entity.id}`} className="flex items-center gap-1 text-ink-muted hover:text-cyan">
                            <CircleDot size={10} /> {e.entity.name}
                          </Link>
                        </dd>
                      </>
                    )}
                    <dt className="text-ink-faint">Investigations</dt>
                    <dd className="text-ink-muted">
                      {e.investigations.map((i) => (
                        <Link key={i.id} to={`/app/investigations/${i.id}`} className="mr-2 hover:text-ink">
                          {i.title}
                        </Link>
                      ))}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
            <Pager page={d.items} total={d.total} offset={offset} onOffset={setOffset} />
          </>
        )}
      />
    </div>
  );
}

/** Everything ASTRION has learned in this workspace, searchable and traceable to its evidence. */
export default function ExplorerPage() {
  const [params, setParams] = useSearchParams();
  const tab = (['entities', 'hypotheses', 'contradictions', 'evidence'].includes(params.get('tab') ?? '') ? params.get('tab') : 'entities') as Tab;
  const { active } = useActiveWorkspace();
  useEffect(() => {
    document.title = 'Intelligence Explorer · ASTRION';
  }, []);
  return (
    <Page className="space-y-5">
      <PageHeader
        eyebrow="Intelligence Explorer"
        title="Intelligence Explorer"
        description="Entities, hypotheses, contradictions and evidence from every investigation in this workspace, each traceable to the quote it came from."
      />
      <Segmented<Tab>
        label="Explorer view"
        size="md"
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        options={[
          { value: 'entities', label: 'Entities' },
          { value: 'hypotheses', label: 'Hypotheses' },
          { value: 'contradictions', label: 'Contradictions' },
          { value: 'evidence', label: 'Evidence' },
        ]}
      />
      {active ? (
        <Panel>
          {tab === 'entities' && <EntitiesView ws={active.id} />}
          {tab === 'hypotheses' && <HypothesesView ws={active.id} />}
          {tab === 'contradictions' && <ContradictionsView ws={active.id} />}
          {tab === 'evidence' && <EvidenceView ws={active.id} />}
        </Panel>
      ) : (
        <EmptyState title="No workspace" description="Create a workspace to start." />
      )}
    </Page>
  );
}
