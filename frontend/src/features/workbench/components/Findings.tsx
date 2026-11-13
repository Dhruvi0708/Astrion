import { useState } from 'react';
import { AlertOctagon, FileText, Lightbulb, Quote, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import type { ClaimRecord, ContradictionRecord, HypothesisRecord, InvestigationReport, VerificationRecord } from '@/lib/api/types';
import { ANSWER_STATUS, VERDICT } from '../status';

function Evidence({ claim }: { claim: Pick<ClaimRecord, 'document' | 'source'> & { evidence: { quote: string }[] } }) {
  return (
    <div className="space-y-1.5">
      {claim.evidence.map((e, i) => (
        <blockquote key={i} className="flex gap-1.5 rounded border-l-2 border-cyan/40 bg-void/40 px-2.5 py-1.5 text-xs italic leading-relaxed text-ink-muted">
          <Quote size={11} className="mt-0.5 shrink-0 not-italic" />
          <span>“{e.quote}”</span>
        </blockquote>
      ))}
      <p className="flex items-center gap-1.5 text-2xs text-ink-faint">
        <FileText size={11} /> {claim.document?.title ?? 'unknown document'} <span aria-hidden>·</span> {claim.source?.title ?? 'unknown source'}
        {claim.source?.uri && (
          <a href={claim.source.uri} target="_blank" rel="noreferrer noopener" className="text-cyan hover:underline">
            open source
          </a>
        )}
      </p>
    </div>
  );
}

export function ClaimItem({ claim, compact }: { claim: ClaimRecord; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  return (
    <li className="rounded-lg border border-line bg-surface/60 p-3" data-testid="claim">
      <button className="w-full text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            tone={claim.kind === 'explicit' ? 'neutral' : 'unverified'}
            title={claim.kind === 'explicit' ? 'Stated directly in the quoted text' : 'Inferred from the quoted text'}
          >
            {claim.kind}
          </Badge>
          {claim.subject && <Badge tone="cyan">{claim.subject.name}</Badge>}
          {claim.temporal_scope && <span className="text-2xs text-ink-faint">{claim.temporal_scope}</span>}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink">{claim.statement}</p>
      </button>
      {open && (
        <div className="mt-2.5">
          <Evidence claim={claim} />
        </div>
      )}
    </li>
  );
}

export function ClaimsList({ claims }: { claims: ClaimRecord[] }) {
  if (!claims.length)
    return (
      <EmptyState
        icon={<Quote size={18} />}
        title="No evidenced claims"
        description="Claims appear here once the Research agent extracts them, each with verbatim quotes."
      />
    );
  return (
    <ul className="grid gap-2 lg:grid-cols-2" aria-label="Claims">
      {claims.map((c) => (
        <ClaimItem key={c.id} claim={c} compact />
      ))}
    </ul>
  );
}

function VerificationBox({ v }: { v: VerificationRecord | null }) {
  if (!v) return <p className="text-2xs text-ink-faint">Not yet verified.</p>;
  return (
    <div className="rounded-md border border-line bg-deep/50 p-2.5">
      <div className="flex items-center gap-2">
        <span className="eyebrow">Verification</span>
        <Badge tone={VERDICT[v.verdict].tone}>{VERDICT[v.verdict].label}</Badge>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{v.reasoning}</p>
      {v.issues.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-2xs text-caution">
          {v.issues.map((i, k) => (
            <li key={k}>{i}</li>
          ))}
        </ul>
      )}
      {v.missing_evidence.length > 0 && <p className="mt-1.5 text-2xs text-ink-faint">Missing: {v.missing_evidence.join('; ')}</p>}
    </div>
  );
}

export function HypothesisCard({
  h,
  claimsById,
  selected,
  onSelect,
}: {
  h: HypothesisRecord;
  claimsById: Map<string, ClaimRecord>;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const m = h.confidence_method;
  return (
    <li className={cn('rounded-lg border bg-surface/60 p-3.5', selected ? 'border-violet/50' : 'border-line')} data-testid="hypothesis">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="hypothesis">
          <Lightbulb size={11} /> Hypothesis
        </Badge>
        <Badge tone="neutral" title="Agent verdicts never mark a hypothesis verified; that takes a person.">
          {h.status.replace('_', ' ')}
        </Badge>
        {m && (
          <span className="text-2xs text-ink-faint" title={`${m.method}: ${JSON.stringify(m.components)}`}>
            confidence {m.score.toFixed(2)} ({m.band}) · {m.method}
          </span>
        )}
        {onSelect && (
          <button className="ml-auto text-2xs text-violet hover:underline" onClick={onSelect}>
            {selected ? 'Clear graph highlight' : 'Highlight in graph'}
          </button>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">{h.statement}</p>
      <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-ink-muted">{h.rationale}</p>
      {h.test_plan && <p className="mt-1.5 text-xs text-ink-muted">Test: {h.test_plan}</p>}
      {m && (
        <p className="mt-1.5 text-2xs text-ink-faint">
          {m.inputs.supporting_claims} supporting ({m.inputs.supporting_explicit} explicit) from {m.inputs.distinct_supporting_sources} source(s) ·{' '}
          {m.inputs.opposing_claims} opposing · verdict factor {m.components.verification_factor}
        </p>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {(['supporting', 'opposing'] as const).map((side) => {
          const ids = side === 'supporting' ? h.supporting_claim_ids : h.opposing_claim_ids;
          return (
            <div key={side}>
              <p className="eyebrow mb-1">{side === 'supporting' ? 'Supported by' : 'Opposed by'}</p>
              {ids.length ? (
                <ul className="space-y-1">
                  {ids.map((id) => (
                    <li key={id} className="text-xs leading-relaxed text-ink-muted">
                      — {claimsById.get(id)?.statement ?? 'claim from an earlier investigation'}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-2xs text-ink-faint">none</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <VerificationBox v={h.verification} />
      </div>
    </li>
  );
}

export function ContradictionCard({ x }: { x: ContradictionRecord }) {
  return (
    <li className="rounded-lg border border-conflict/25 bg-surface/60 p-3.5" data-testid="contradiction">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="conflict">
          <AlertOctagon size={11} /> {x.kind} conflict
        </Badge>
        <Badge tone={x.is_genuine ? 'conflict' : 'neutral'}>{x.is_genuine ? 'genuine' : 'apparent only'}</Badge>
        <span className="text-2xs text-ink-faint">severity {x.severity}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">{x.explanation}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {[x.claim_a, x.claim_b].map((c, i) => (
          <div key={c.id} className="rounded-md border border-line bg-deep/40 p-2.5">
            <p className="eyebrow mb-1">Claim {i ? 'B' : 'A'}</p>
            <p className="mb-2 text-xs leading-relaxed text-ink">{c.statement}</p>
            <Evidence claim={c} />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <VerificationBox v={x.verification} />
      </div>
    </li>
  );
}

/** The synthesis report. Each finding lists the claims it cites, and each claim its quote, document and source. */
export function ReportView({
  report,
  hypotheses,
  contradictions,
}: {
  report: InvestigationReport;
  hypotheses: HypothesisRecord[];
  contradictions: ContradictionRecord[];
}) {
  const r = report.content;
  const status = ANSWER_STATUS[r.answer_status];
  const hypById = new Map(hypotheses.map((h) => [h.id, h]));
  const conById = new Map(contradictions.map((x) => [x.id, x]));
  return (
    <article className="space-y-6" data-testid="report">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-2xs text-ink-faint">
            Run {report.run_number} · {r.generated_by.provider}/{r.generated_by.model}
            {r.generated_by.is_fixture && ' · rule-based fixture, not AI'}
          </span>
        </div>
        <h2 className="font-display text-xl text-ink">{r.title}</h2>
        <p className="text-sm leading-relaxed text-ink-muted">{r.executive_summary}</p>
      </header>

      <section>
        <h3 className="eyebrow mb-2">Key findings</h3>
        {r.key_findings.length ? (
          <ol className="space-y-3">
            {r.key_findings.map((f, i) => (
              <li key={i} className="rounded-lg border border-line bg-surface/60 p-3.5">
                <div className="flex items-start gap-2">
                  <span className="font-mono text-2xs text-cyan">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-ink">{f.statement}</p>
                    <p className="mt-1 text-2xs text-ink-faint">
                      {f.confidence} confidence · {f.basis}
                    </p>
                    <div className="mt-2.5 space-y-2.5">
                      {f.claim_refs.map((ref) => {
                        const c = r.citations[ref];
                        return c ? (
                          <div key={ref} className="rounded-md border border-line bg-deep/40 p-2.5">
                            <p className="mb-1.5 text-xs text-ink">
                              <span className="font-mono text-2xs text-ink-faint">{ref}</span> {c.statement}
                            </p>
                            <Evidence claim={c} />
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-muted">No finding could be stated with cited evidence.</p>
        )}
      </section>

      {r.hypotheses.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">Hypotheses</h3>
          <ul className="space-y-1.5 text-sm">
            {r.hypotheses.map((a) => {
              const h = hypById.get(r.hypothesis_ids[a.ref]);
              return (
                <li key={a.ref} className="text-ink-muted">
                  <span className="text-ink">{h?.statement ?? a.ref}</span> — {a.assessment}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {r.contradictions.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">Contradictions</h3>
          <ul className="space-y-1.5 text-sm">
            {r.contradictions.map((a) => {
              const x = conById.get(r.contradiction_ids[a.ref]);
              return (
                <li key={a.ref} className="text-ink-muted">
                  <Scale size={12} className="mr-1 inline text-conflict" />
                  {x ? `“${x.claim_a.statement}” vs “${x.claim_b.statement}”` : a.ref} — {a.assessment}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h3 className="eyebrow mb-2">Unresolved questions</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-ink-muted">
            {r.unresolved_questions.length ? r.unresolved_questions.map((q, i) => <li key={i}>{q}</li>) : <li>None recorded.</li>}
          </ul>
        </section>
        <section>
          <h3 className="eyebrow mb-2">Limitations</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-ink-muted">
            {r.limitations.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
            {r.documents_without_evidence.length > 0 && <li>No usable evidence in: {r.documents_without_evidence.join(', ')}</li>}
          </ul>
        </section>
      </div>
    </article>
  );
}
