import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Play, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/States';
import { Page } from '@/components/layout/PageHeader';
import { ApiError } from '@/lib/api/client';
import {
  useClaims,
  useContradictions,
  useExecutions,
  useGraphChanges,
  useHypotheses,
  useIntelligenceStatus,
  useInvestigation,
  useInvestigationAction,
  useReports,
} from '@/lib/api/hooks';
import { isActive, type InvestigationDetail } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { AgentTimeline, ProviderNotice, StagePipeline } from './components/Activity';
import { ClaimsList, ContradictionCard, HypothesisCard, ReportView } from './components/Findings';
import { GraphExplorer } from './graph/GraphExplorer';
import { INVESTIGATION_STATUS, formatCost } from './status';

type Tab = 'activity' | 'evidence' | 'reasoning' | 'graph' | 'report';

function Actions({ detail }: { detail: InvestigationDetail }) {
  const start = useInvestigationAction(detail.id, 'start');
  const resume = useInvestigationAction(detail.id, 'resume');
  const cancel = useInvestigationAction(detail.id, 'cancel');
  const error = [start.error, resume.error, cancel.error].find(Boolean);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap gap-2">
        {detail.can_resume && (
          <Button variant="outline" onClick={() => resume.mutate()} disabled={resume.isPending}>
            <RotateCcw size={14} /> Resume
          </Button>
        )}
        {detail.can_start && (
          <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
            <Play size={14} /> {detail.run_count ? 'Run again' : 'Start investigation'}
          </Button>
        )}
        {detail.can_cancel && (
          <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending || detail.status === 'cancelling'}>
            <Ban size={14} /> {detail.status === 'cancelling' ? 'Cancelling…' : 'Cancel'}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="max-w-sm text-right text-xs text-conflict">
          {error instanceof ApiError ? error.message : 'The request failed.'}
        </p>
      )}
    </div>
  );
}

export default function InvestigationWorkbenchPage() {
  const { id } = useParams();
  const inv = useInvestigation(id);
  const d = inv.data;
  const status = useIntelligenceStatus();
  const executions = useExecutions(id, d);
  const claims = useClaims(id, d);
  const hypotheses = useHypotheses(id, d);
  const contradictions = useContradictions(id, d);
  const reports = useReports(id, d);
  const changes = useGraphChanges(id, d);
  const [tab, setTab] = useState<Tab>('activity');
  const [focusHyp, setFocusHyp] = useState<string | null>(null);

  const claimsById = useMemo(() => new Map((claims.data ?? []).map((c) => [c.id, c])), [claims.data]);
  const highlight = useMemo(() => {
    const h = hypotheses.data?.find((x) => x.id === focusHyp);
    if (!h) return null;
    const keys = new Set<string>();
    for (const cid of [...h.supporting_claim_ids, ...h.opposing_claim_ids]) {
      keys.add(`clm:${cid}`);
      const subject = claimsById.get(cid)?.subject;
      if (subject) keys.add(`ent:${subject.id}`);
    }
    return keys;
  }, [focusHyp, hypotheses.data, claimsById]);

  if (inv.isPending)
    return (
      <Page className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <SkeletonRows rows={5} />
      </Page>
    );
  if (inv.isError)
    return (
      <Page>
        <ErrorState error={inv.error} onRetry={() => inv.refetch()} />
      </Page>
    );

  const detail = inv.data;
  const s = INVESTIGATION_STATUS[detail.status];
  const live = isActive(detail.status);
  const latest = reports.data?.[0];

  return (
    <Page className="space-y-5">
      <Link to="/app/investigations" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
        <ArrowLeft size={13} /> All investigations
      </Link>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[1.6rem] font-medium leading-tight text-ink">{detail.title}</h1>
            <Badge tone={s.tone} dot={s.dot}>
              <span data-testid="investigation-status">{s.label}</span>
            </Badge>
          </div>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-muted">{detail.question}</p>
          <p className="mt-1.5 text-2xs text-ink-faint">
            {detail.run_count ? `Run ${detail.run_count}` : 'Not run yet'}
            {detail.started_at && ` · started ${formatDate(detail.started_at)}`}
            {detail.run_count > 0 &&
              ` · ${detail.input_tokens.toLocaleString()} in / ${detail.output_tokens.toLocaleString()} out tokens · ${formatCost(detail.cost_usd)} (estimated)`}
            {` · ${detail.document_ids.length ? `${detail.document_ids.length} document(s) in scope` : 'all workspace documents in scope'}`}
          </p>
        </div>
        <Actions detail={detail} />
      </div>

      <ProviderNotice status={status.data} detail={detail} />
      {detail.error && (
        <div role="alert" className="rounded-md border border-conflict/35 bg-conflict/[0.06] px-3.5 py-2.5 text-xs text-conflict">
          {detail.error}
          {detail.can_resume && <span className="text-ink-muted"> — steps that already succeeded are kept; Resume continues from the failed step.</span>}
        </div>
      )}

      {detail.run_count > 0 && <StagePipeline detail={detail} />}

      <Segmented<Tab>
        label="Workbench view"
        size="md"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'activity', label: `Agent activity${detail.counts.executions ? ` (${detail.counts.executions})` : ''}` },
          { value: 'evidence', label: `Claims (${detail.counts.claims ?? 0})` },
          { value: 'reasoning', label: `Hypotheses & conflicts (${(detail.counts.hypotheses ?? 0) + (detail.counts.contradictions ?? 0)})` },
          { value: 'graph', label: 'Knowledge graph' },
          { value: 'report', label: 'Report' },
        ]}
      />

      {tab === 'activity' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Panel title="Execution trace" eyebrow={live ? 'Live — refreshed from the server' : undefined}>
            {executions.isPending ? <SkeletonRows rows={4} /> : <AgentTimeline executions={executions.data ?? []} runCount={detail.run_count} />}
          </Panel>
          <div className="space-y-4">
            <Panel title="Plan">
              {detail.plan ? (
                <div className="space-y-2 text-xs text-ink-muted">
                  <p className="text-ink">{detail.plan.objective}</p>
                  <ol className="space-y-1.5">
                    {detail.plan.sub_questions.map((q) => (
                      <li key={q.id}>
                        <span className="font-mono text-2xs text-cyan">{q.id}</span> {q.question}
                      </li>
                    ))}
                  </ol>
                  {detail.plan.key_terms.length > 0 && <p className="text-2xs text-ink-faint">Key terms: {detail.plan.key_terms.join(', ')}</p>}
                </div>
              ) : (
                <p className="text-xs text-ink-muted">The Orchestrator writes the plan when the run starts.</p>
              )}
            </Panel>
            <Panel title="Graph changes">
              {changes.data?.length ? (
                <ul className="max-h-72 space-y-1 overflow-auto text-2xs text-ink-muted">
                  {changes.data.slice(-60).map((c) => (
                    <li key={c.id}>
                      <span className="text-cyan">{c.change_type.replace(/_/g, ' ')}</span>{' '}
                      {String(c.details.name ?? c.details.statement ?? c.details.predicate ?? c.target_key).slice(0, 90)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-muted">No changes to the knowledge graph yet.</p>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === 'evidence' && (claims.isPending ? <SkeletonRows rows={4} /> : <ClaimsList claims={claims.data ?? []} />)}

      {tab === 'reasoning' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Hypotheses">
            {hypotheses.data?.length ? (
              <ul className="space-y-3">
                {hypotheses.data.map((h) => (
                  <HypothesisCard
                    key={h.id}
                    h={h}
                    claimsById={claimsById}
                    selected={focusHyp === h.id}
                    onSelect={() => {
                      setFocusHyp(focusHyp === h.id ? null : h.id);
                      if (focusHyp !== h.id) setTab('graph');
                    }}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState title="No hypotheses" description="The Hypothesis agent proposes them once there are evidenced claims." />
            )}
          </Panel>
          <Panel title="Contradictions">
            {contradictions.data?.length ? (
              <ul className="space-y-3">
                {contradictions.data.map((x) => (
                  <ContradictionCard key={x.id} x={x} />
                ))}
              </ul>
            ) : (
              <EmptyState title="No contradictions found" description="Conflicting claims would appear here with both quotes side by side." />
            )}
          </Panel>
        </div>
      )}

      {tab === 'graph' && (
        <Panel
          title="Knowledge graph for this investigation"
          actions={
            focusHyp && (
              <Button size="sm" variant="ghost" onClick={() => setFocusHyp(null)}>
                Clear hypothesis highlight
              </Button>
            )
          }
        >
          <GraphExplorer workspaceId={detail.workspace_id} investigationId={detail.id} live={live} highlight={highlight} />
        </Panel>
      )}

      {tab === 'report' && (
        <Panel>
          {latest ? (
            <ReportView report={latest} hypotheses={hypotheses.data ?? []} contradictions={contradictions.data ?? []} />
          ) : (
            <EmptyState
              title="No report yet"
              description={
                live
                  ? 'The Synthesis agent writes the report at the end of the run.'
                  : 'A report is written only when a run completes. Failed or cancelled runs never produce one.'
              }
            />
          )}
        </Panel>
      )}
    </Page>
  );
}
