import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Download, FileText, Printer, Quote } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Page } from '@/components/layout/PageHeader';
import { api } from '@/lib/api/client';
import { useClaims, useContradictions, useHypotheses, useInvestigation, useReports, useRuns, useWorkspaceGraph } from '@/lib/api/hooks';
import type { Citation, ClaimRecord, HypothesisRecord } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ANSWER_STATUS, CONSENSUS, REASONING, VERDICT } from './status';

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid-page border-t border-line pt-5 print:border-neutral-300" aria-labelledby={`s${n}`}>
      <h2 id={`s${n}`} className="font-display text-lg text-ink print:text-black">
        <span className="mr-2 font-mono text-sm text-cyan print:text-neutral-500">{n}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted print:text-neutral-800">{children}</div>
    </section>
  );
}

function EvidenceRef({ cite, refId }: { cite?: Citation | ClaimRecord; refId?: string }) {
  const [open, setOpen] = useState(false);
  if (!cite) return null;
  return (
    <div className="rounded-md border border-line bg-deep/40 print:border-neutral-300 print:bg-white">
      <button className="flex w-full items-start gap-2 p-2 text-left text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight size={12} className={cn('mt-0.5 shrink-0 transition-transform print:hidden', open && 'rotate-90')} />
        <span className="text-ink print:text-black">
          {refId && <span className="mr-1 font-mono text-2xs text-ink-faint">{refId}</span>}
          {cite.statement}
        </span>
      </button>
      <div className={cn('space-y-1 px-7 pb-2', open ? 'block' : 'hidden print:block')}>
        {cite.evidence.map((e, i) => (
          <p key={i} className="flex gap-1.5 text-2xs italic text-ink-muted print:text-neutral-700">
            <Quote size={10} className="mt-0.5 shrink-0" />“{e.quote}”
          </p>
        ))}
        <p className="text-2xs text-ink-faint">
          {cite.document?.title} · {cite.source?.title}
          {cite.source?.uri && (
            <a href={cite.source.uri} target="_blank" rel="noreferrer noopener" className="ml-1 text-cyan hover:underline">
              {cite.source.uri}
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

function HypothesisBlock({ h, claims }: { h: HypothesisRecord; claims: Map<string, ClaimRecord> }) {
  const m = h.confidence_method;
  const r = h.reasoning_type ? REASONING[h.reasoning_type] : null;
  return (
    <div className="rounded-lg border border-violet/25 p-3 print:border-neutral-300">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="hypothesis">Hypothesis — not a finding</Badge>
        {r && (
          <Badge tone={r.tone} title={r.meaning}>
            {r.label}
          </Badge>
        )}
        {h.consensus && CONSENSUS[h.consensus] && <Badge tone={CONSENSUS[h.consensus].tone}>{CONSENSUS[h.consensus].label}</Badge>}
        <span className="text-2xs text-ink-faint">
          confidence {m?.score.toFixed(2) ?? 'n/a'} ({m?.band}) · {h.status.replace('_', ' ')}
        </span>
      </div>
      <p className="mt-2 text-ink print:text-black">{h.statement}</p>
      <p className="mt-1 whitespace-pre-line text-xs">{h.rationale}</p>
      {!!h.falsification_conditions?.length && <p className="mt-1 text-xs">Would be falsified by: {h.falsification_conditions.join('; ')}</p>}
      {!!h.assumptions?.length && <p className="mt-1 text-xs">Unresolved assumptions: {h.assumptions.join('; ')}</p>}
      {h.verification && (
        <p className="mt-1 text-xs">
          Independent verification: <strong>{VERDICT[h.verification.verdict].label}</strong> — {h.verification.reasoning}
        </p>
      )}
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-1">Supporting evidence</p>
          {h.supporting_claim_ids.map((id) => (
            <EvidenceRef key={id} cite={claims.get(id)} />
          ))}
        </div>
        <div>
          <p className="eyebrow mb-1">Opposing evidence</p>
          {h.opposing_claim_ids.length ? (
            h.opposing_claim_ids.map((id) => <EvidenceRef key={id} cite={claims.get(id)} />)
          ) : (
            <p className="text-xs">None cited.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The full intelligence report for a completed run, with export to Markdown and PDF. */
export default function ReportPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const inv = useInvestigation(id);
  const reports = useReports(id, inv.data);
  const hyps = useHypotheses(id, inv.data);
  const cons = useContradictions(id, inv.data);
  const claims = useClaims(id, inv.data);
  const runs = useRuns(id, inv.data);
  const graph = useWorkspaceGraph(inv.data?.workspace_id ?? null, { investigationId: id });
  const [exporting, setExporting] = useState(false);
  const runNo = Number(params.get('run')) || undefined;
  const report = reports.data?.find((r) => r.run_number === runNo) ?? reports.data?.[0];
  const claimsById = useMemo(() => new Map((claims.data ?? []).map((c) => [c.id, c])), [claims.data]);
  const entities = useMemo(() => {
    const m = new Map<string, { id: string; name: string; type: string; n: number }>();
    for (const c of claims.data ?? [])
      if (c.subject) m.set(c.subject.id, { id: c.subject.id, name: c.subject.name, type: c.subject.entity_type, n: (m.get(c.subject.id)?.n ?? 0) + 1 });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [claims.data]);
  const relationships = useMemo(() => {
    const names = new Map((graph.data?.nodes ?? []).map((n) => [n.key, n]));
    return (graph.data?.edges ?? []).flatMap((e) => {
      const from = names.get(e.source);
      const to = names.get(e.target);
      return from && to ? [{ key: e.key, from, to, type: e.type.toLowerCase().replace(/_/g, ' '), support: e.support_count }] : [];
    });
  }, [graph.data]);
  useEffect(() => {
    document.title = `${report?.content.title ?? 'Report'} · ASTRION`;
  }, [report]);

  if (inv.isPending || reports.isPending)
    return (
      <Page>
        <Skeleton className="h-96 w-full" />
      </Page>
    );
  if (inv.isError)
    return (
      <Page>
        <ErrorState error={inv.error} />
      </Page>
    );
  const d = inv.data;
  if (!report)
    return (
      <Page>
        <EmptyState
          icon={<FileText size={18} />}
          title="No report yet"
          description="A report is written when a run completes. Failed or cancelled runs never produce one."
          action={
            <Link to={`/app/investigations/${d.id}`} className="text-cyan">
              Back to the investigation
            </Link>
          }
        />
      </Page>
    );
  const c = report.content;
  const status = ANSWER_STATUS[c.answer_status];
  const run = runs.data?.find((r) => r.run_number === report.run_number);
  const agreed = (hyps.data ?? []).filter((h) => h.consensus === 'agreed');

  const exportMarkdown = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.reportMarkdown(d.id, report.run_number);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `astrion-report-run${report.run_number}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page className="max-w-[980px] space-y-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link to={`/app/investigations/${d.id}`} className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
          <ArrowLeft size={13} /> Back to the investigation
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {(reports.data?.length ?? 0) > 1 && (
            <Select aria-label="Run" value={String(report.run_number)} onChange={(e) => setParams({ run: e.target.value })} className="h-8 w-28">
              {reports.data?.map((r) => (
                <option key={r.run_number} value={r.run_number}>
                  Run {r.run_number}
                </option>
              ))}
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={exportMarkdown} disabled={exporting}>
            <Download size={13} /> Markdown
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()} title="Opens the print dialog; choose “Save as PDF”">
            <Printer size={13} /> PDF
          </Button>
        </div>
      </div>

      <header data-testid="report-header">
        <p className="eyebrow text-cyan/80 print:text-neutral-500">Intelligence report · run {report.run_number}</p>
        <h1 className="mt-1 font-display text-[1.8rem] font-medium leading-tight text-ink print:text-black">{c.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-ink-faint">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span>Generated {formatDate(report.created_at)}</span>
          <span>
            by {c.generated_by.provider}/{c.generated_by.model}
          </span>
          {c.generated_by.is_fixture && <Badge tone="sample">deterministic fixture — not AI</Badge>}
        </div>
        <p className="mt-3 rounded-md border border-line bg-deep/40 p-2.5 text-xs text-ink-muted print:border-neutral-300 print:bg-white">
          <strong className="text-ink print:text-black">How to read this report.</strong> A <em>finding</em> is stated with cited, verbatim evidence. A{' '}
          <em>hypothesis</em> is a proposal awaiting verification, labelled as correlation, causation, inference or speculation. Nothing here was verified by a
          person unless stated.
        </p>
      </header>

      <Section n={1} title="Executive summary">
        <p>{c.executive_summary}</p>
      </Section>
      <Section n={2} title="Research objective">
        <p>
          <strong className="text-ink print:text-black">Question:</strong> {d.question}
        </p>
        {d.plan && (
          <ul className="list-disc pl-5">
            {d.plan.sub_questions.map((q) => (
              <li key={q.id}>
                <span className="font-mono text-2xs">{q.id}</span> {q.question}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section n={3} title="Methodology">
        <p>
          {d.document_ids.length ? `${d.document_ids.length} selected document(s)` : 'All workspace documents'} were read by the Research agent; every claim
          carries a verbatim quote checked against its passage. Hypotheses were challenged in a structured debate and reviewed by an independent verification
          agent.{' '}
          {run && `Exploration ran ${run.iterations} iteration(s) and stopped because: ${run.stop_reason}. ${run.usage.llm_calls} model calls were used.`}
        </p>
        <Link to={`/app/investigations/${d.id}`} className="text-xs text-cyan print:hidden">
          Inspect the full execution trace →
        </Link>
      </Section>
      <Section n={4} title="Key discoveries">
        {c.key_findings.length ? (
          <ol className="space-y-3">
            {c.key_findings.map((f, i) => (
              <li key={i}>
                <p className="text-ink print:text-black">
                  <Badge tone="verified">Finding</Badge> {f.statement} <span className="text-2xs text-ink-faint">({f.confidence} confidence)</span>
                </p>
                <div className="mt-1.5 space-y-1">
                  {f.claim_refs.map((r) => (
                    <EvidenceRef key={r} refId={r} cite={c.citations[r]} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>No finding could be stated with cited evidence.</p>
        )}
      </Section>
      <Section n={5} title="Important entities">
        <ul className="flex flex-wrap gap-1.5">
          {entities.slice(0, 20).map((e) => (
            <li key={e.id}>
              <Link
                to={`/app/universe?entity=${e.id}`}
                className="rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-cyan/40 hover:text-ink"
              >
                {e.name}{' '}
                <span className="text-2xs text-ink-faint">
                  {e.type} · {e.n}
                </span>
              </Link>
            </li>
          ))}
          {!entities.length && <li>None extracted.</li>}
        </ul>
      </Section>
      <Section n={6} title="Discovered relationships">
        {graph.isError ? (
          <p className="text-xs text-conflict">The relationships could not be loaded.</p>
        ) : graph.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : relationships.length ? (
          <ul className="space-y-1 text-xs" data-testid="report-relationships">
            {relationships.map((r) => (
              <li key={r.key}>
                <Link to={`/app/universe?entity=${r.from.entity_id}`} className="text-ink hover:text-cyan print:text-black">
                  {r.from.label}
                </Link>{' '}
                — {r.type} →{' '}
                <Link to={`/app/universe?entity=${r.to.entity_id}`} className="text-ink hover:text-cyan print:text-black">
                  {r.to.label}
                </Link>{' '}
                <span className="text-2xs text-ink-faint">({r.support} supporting claim(s))</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs">None asserted by the evidence.</p>
        )}
        <Link to={`/app/investigations/${d.id}`} className="text-xs text-cyan print:hidden">
          Open the investigation graph →
        </Link>
      </Section>
      <Section n={7} title="Verified findings">
        <p className="text-xs">
          Findings in section 4 passed automated provenance checks. Hypotheses below survived the debate and were supported by the independent verifier
          (consensus “agreed”); none has been verified by a person.
        </p>
        {agreed.length ? agreed.map((h) => <p key={h.id}>• {h.statement}</p>) : <p className="text-xs">No hypothesis reached agreement.</p>}
      </Section>
      <Section n={8} title="Generated hypotheses">
        {(hyps.data ?? []).map((h) => (
          <HypothesisBlock key={h.id} h={h} claims={claimsById} />
        ))}
        {!hyps.data?.length && <p>None proposed.</p>}
      </Section>
      <Section n={9} title="Contradictions">
        {(cons.data ?? []).map((x) => (
          <div key={x.id} className="rounded-md border border-conflict/25 p-2.5 print:border-neutral-300">
            <p className="text-xs">
              <Badge tone="conflict">{x.kind}</Badge> {x.is_genuine ? 'genuine' : 'apparent'} · severity {x.severity} ·{' '}
              {x.resolution ? <span className="text-verified">resolved ({x.resolution_kind})</span> : 'unresolved'}
              {x.verification && ` · verifier: ${VERDICT[x.verification.verdict].label}`}
            </p>
            <EvidenceRef cite={x.claim_a} />
            <EvidenceRef cite={x.claim_b} />
            <p className="mt-1 text-xs">{x.resolution ?? x.explanation}</p>
          </div>
        ))}
        {!cons.data?.length && <p>None detected.</p>}
      </Section>
      <Section n={10} title="Supporting and opposing evidence">
        <p className="text-xs">Every claim this investigation found, with its quotes and sources:</p>
        {(claims.data ?? []).slice(0, 60).map((cl) => (
          <EvidenceRef key={cl.id} cite={cl} />
        ))}
      </Section>
      <Section n={11} title="Confidence assessments">
        <p className="text-xs">
          Hypothesis confidence is computed from the evidence (method astrion-evidence-v2), not asked of a model. Source reliability is assessed separately and
          never alters these scores.
        </p>
        <ul className="space-y-1 text-xs">
          {(hyps.data ?? []).map((h) => (
            <li key={h.id}>
              <span className="font-mono">{h.confidence_method?.score.toFixed(2) ?? 'n/a'}</span> — {h.statement.slice(0, 140)}
            </li>
          ))}
        </ul>
      </Section>
      <Section n={12} title="Unresolved questions">
        <ul className="list-disc pl-5">
          {c.unresolved_questions.length ? c.unresolved_questions.map((q, i) => <li key={i}>{q}</li>) : <li>None recorded.</li>}
        </ul>
      </Section>
      <Section n={13} title="Limitations">
        <ul className="list-disc pl-5">
          {c.limitations.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
          {c.documents_without_evidence.length > 0 && <li>No usable evidence in: {c.documents_without_evidence.join(', ')}</li>}
        </ul>
      </Section>
      <Section n={14} title="Conclusions">
        <p>
          Answer status: <strong className="text-ink print:text-black">{status.label}</strong>. {c.executive_summary}
        </p>
      </Section>
    </Page>
  );
}
