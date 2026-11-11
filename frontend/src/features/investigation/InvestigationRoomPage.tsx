import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleDashed, FileText, Flag, Link2, MessageSquareQuote, PlayCircle, Quote, ShieldAlert } from 'lucide-react';
import { Badge, PlannedBadge, SampleBadge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { Notice, Page, PageHeader } from '@/components/layout/PageHeader';
import { evidenceById } from '@/data/sample/discoveries';
import { nodeById } from '@/data/sample/graph';
import { SAMPLE_INVESTIGATIONS, type ClaimStance, type SampleClaim } from '@/data/sample/investigations';
import { cn } from '@/lib/cn';

const STANCE: Record<ClaimStance, { label: string; tone: 'verified' | 'conflict' | 'neutral' }> = {
  supports: { label: 'Supports', tone: 'verified' },
  contradicts: { label: 'Contradicts', tone: 'conflict' },
  context: { label: 'Context', tone: 'neutral' },
};

const CLAIM_STATUS = {
  extracted: { label: 'Extracted', tone: 'neutral' },
  challenged: { label: 'Challenged', tone: 'conflict' },
  accepted: { label: 'Accepted (sample)', tone: 'verified' },
} as const;

/** Four-link provenance chain: Source → Document → Evidence span → Claim. */
function ProvenanceChain({ complete }: { complete: number }) {
  const steps = ['Source', 'Document', 'Evidence span', 'Claim'];
  return (
    <div className="flex items-center gap-1" aria-label={`Provenance: ${complete} of 4 links recorded`} title={steps.map((s, i) => `${i < complete ? '●' : '○'} ${s}`).join('  ')}>
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', i < complete ? 'bg-verified' : 'border border-ink-faint')} />
          {i < steps.length - 1 && <span className={cn('h-px w-2.5', i < complete - 1 ? 'bg-verified/60' : 'bg-line-strong')} />}
        </span>
      ))}
    </div>
  );
}

function ClaimCard({ claim, selected, onSelect }: { claim: SampleClaim; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <div className={cn('rounded-lg border transition-colors', selected ? 'border-cyan/40 bg-raised/40' : 'border-line bg-deep/50 hover:border-line-strong')}>
        <button onClick={onSelect} aria-expanded={selected} className="w-full p-3.5 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STANCE[claim.stance].tone}>{STANCE[claim.stance].label}</Badge>
            <Badge tone={CLAIM_STATUS[claim.status].tone}>{CLAIM_STATUS[claim.status].label}</Badge>
            <span className="ml-auto font-mono text-2xs text-ink-faint">{claim.id.toUpperCase()}</span>
          </div>
          <p className="mt-2.5 text-[0.85rem] leading-relaxed text-ink">{claim.statement}</p>
          <div className="mt-2.5 flex items-center justify-between">
            <ProvenanceChain complete={claim.evidenceIds.length ? 4 : 1} />
            <span className="text-2xs text-ink-faint">{claim.evidenceIds.length} evidence</span>
          </div>
        </button>
        {selected && (
          <div className="border-t border-line px-3.5 pb-3.5 pt-3">
            <p className="eyebrow mb-2">Evidence</p>
            <ul className="space-y-2">
              {claim.evidenceIds.map((id) => {
                const ev = evidenceById.get(id)!;
                return (
                  <li key={id} className="rounded-md border border-line bg-surface/70 p-3">
                    <div className="flex items-start gap-2">
                      <Quote size={13} className="mt-0.5 shrink-0 text-ink-faint" />
                      <p className="text-xs leading-relaxed text-ink">{ev.statement}</p>
                    </div>
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
                      <dt className="text-ink-faint">Source</dt>
                      <dd className="truncate text-ink-muted">{ev.sourceLabel}</dd>
                      <dt className="text-ink-faint">Location</dt>
                      <dd className="text-ink-muted">{ev.locator}</dd>
                      <dt className="text-ink-faint">Extraction</dt>
                      <dd className="text-caution">Manual · sample</dd>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

const TIMELINE_ICON = { created: CircleDashed, source: FileText, claim: MessageSquareQuote, challenge: ShieldAlert, finding: Flag, planned: PlayCircle };

export default function InvestigationRoomPage() {
  const [params, setParams] = useSearchParams();
  const inv = SAMPLE_INVESTIGATIONS.find((i) => i.id === params.get('i')) ?? SAMPLE_INVESTIGATIONS[0];
  const [stance, setStance] = useState<'all' | ClaimStance>('all');
  const [selectedClaim, setSelectedClaim] = useState<string | null>(inv.claims[0]?.id ?? null);

  useEffect(() => {
    document.title = 'Investigation Room · ASTRION';
  }, []);
  useEffect(() => {
    setSelectedClaim(inv.claims[0]?.id ?? null);
    setStance('all');
  }, [inv]);

  const claims = inv.claims.filter((c) => stance === 'all' || c.stance === stance);
  const activeClaim = inv.claims.find((c) => c.id === selectedClaim);
  const highlightedSources = useMemo(() => new Set(activeClaim?.evidenceIds.map((id) => evidenceById.get(id)!.sourceId) ?? []), [activeClaim]);

  return (
    <Page>
      <PageHeader
        eyebrow="Investigation Room"
        title="Investigation Room"
        badges={<SampleBadge label="Sample investigation" />}
        description="Frame a research question, attach sources, and trace every claim back to the evidence that supports or contradicts it."
      />
      <Notice className="mt-5">
        These investigations are hand-written samples that demonstrate the workspace. Agent-driven investigation — automated questioning, evidence retrieval and verification — is <strong className="font-medium text-ink">planned</strong> and not
        running.
      </Notice>

      <div role="tablist" aria-label="Investigations" className="mt-6 flex flex-wrap gap-2">
        {SAMPLE_INVESTIGATIONS.map((i) => (
          <button
            key={i.id}
            role="tab"
            aria-selected={i.id === inv.id}
            onClick={() => setParams({ i: i.id }, { replace: true })}
            className={cn('rounded-md border px-3.5 py-2 text-left text-xs transition-colors', i.id === inv.id ? 'border-cyan/40 bg-cyan/[0.06] text-ink' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink')}
          >
            <span className="block font-medium">{i.title}</span>
            <span className="text-2xs capitalize text-ink-faint">{i.status}</span>
          </button>
        ))}
      </div>

      {/* Investigation overview */}
      <section aria-label="Research question" className="panel mt-4 overflow-hidden">
        <div className="grid gap-6 p-5 md:grid-cols-[1fr_auto] md:p-6">
          <div>
            <p className="eyebrow">Research question</p>
            <p className="mt-2 font-display text-xl font-medium leading-snug text-ink md:text-[1.4rem]">{inv.question}</p>
          </div>
          <dl className="grid grid-cols-3 gap-4 self-end md:gap-6">
            {[
              ['Sources', inv.sourceIds.length],
              ['Claims', inv.claims.length],
              ['Findings', inv.findings.length],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-2xs uppercase tracking-[0.1em] text-ink-faint">{k}</dt>
                <dd className="mt-0.5 font-display text-2xl font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line bg-deep/40 px-5 py-2.5 text-2xs text-ink-faint md:px-6">
          <span className="flex items-center gap-2">
            <ProvenanceChain complete={4} /> Provenance: Source → Document → Evidence span → Claim
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full border border-ink-faint" /> missing link
          </span>
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        <Panel title="Sources" eyebrow="Attached" bodyClassName="p-2">
          <ul>
            {inv.sourceIds.map((id) => {
              const src = nodeById.get(id)!;
              const on = highlightedSources.has(id);
              return (
                <li key={id} className={cn('rounded-md border px-3 py-2.5 transition-colors', on ? 'border-cyan/35 bg-cyan/[0.05]' : 'border-transparent')}>
                  <div className="flex items-start gap-2.5">
                    <FileText size={15} className={cn('mt-0.5 shrink-0', on ? 'text-cyan' : 'text-ink-faint')} />
                    <div className="min-w-0">
                      <p className="text-[0.8rem] leading-snug text-ink">{src.label}</p>
                      <p className="mt-1 text-2xs leading-relaxed text-ink-faint">{src.summary}</p>
                      {on && (
                        <p className="mt-1.5 flex items-center gap-1 text-2xs text-cyan">
                          <Link2 size={11} /> Cited by selected claim
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 border-t border-line px-2 pt-3 text-2xs leading-relaxed text-ink-faint">Real sources are registered on the Sources page. Linking them to investigations arrives with the investigation API.</p>
        </Panel>

        <Panel
          title="Claims & evidence"
          eyebrow="Traceability"
          actions={
            <Segmented
              label="Filter claims by stance"
              value={stance}
              onChange={setStance}
              options={[
                { value: 'all', label: 'All' },
                { value: 'supports', label: 'Supports' },
                { value: 'contradicts', label: 'Contradicts' },
                { value: 'context', label: 'Context' },
              ]}
            />
          }
        >
          {claims.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-muted">No claims with this stance.</p>
          ) : (
            <ul className="space-y-2.5">
              {claims.map((c) => (
                <ClaimCard key={c.id} claim={c} selected={c.id === selectedClaim} onSelect={() => setSelectedClaim(c.id === selectedClaim ? null : c.id)} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Timeline" eyebrow="History">
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-line">
            {inv.timeline.map((t) => {
              const Icon = TIMELINE_ICON[t.kind];
              const planned = t.kind === 'planned';
              return (
                <li key={t.id} className="relative flex gap-3">
                  <span className={cn('relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border bg-surface', planned ? 'border-dashed border-ink-faint text-ink-faint' : t.kind === 'challenge' ? 'border-conflict/50 text-conflict' : 'border-line-strong text-ink-muted')}>
                    <Icon size={12} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className={cn('flex flex-wrap items-center gap-1.5 text-[0.8rem]', planned ? 'text-ink-muted' : 'text-ink')}>
                      {t.label} {planned && <PlannedBadge />}
                    </p>
                    <p className="text-2xs leading-relaxed text-ink-faint">{t.detail}</p>
                    <p className="mt-0.5 font-mono text-2xs text-ink-faint">{t.at}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      <Panel title="Findings" eyebrow="Outcomes" className="mt-4" actions={<Badge tone="unverified">None verified</Badge>}>
        <ul className="grid gap-3 md:grid-cols-2">
          {inv.findings.map((f) => (
            <li key={f.id} className="rounded-lg border border-line bg-deep/50 p-4">
              <div className="flex items-center gap-1.5">
                <Badge tone={f.status === 'conditional' ? 'hypothesis' : 'unverified'}>{f.status === 'draft' ? 'Draft' : f.status === 'conditional' ? 'Conditional' : 'Unverified'}</Badge>
              </div>
              <p className="mt-2.5 text-[0.85rem] leading-relaxed text-ink">{f.text}</p>
              <p className="mt-3 text-2xs text-ink-faint">
                Basis:{' '}
                {f.basis.length ? (
                  f.basis.map((id) => evidenceById.get(id)!.sourceLabel.split(' · ')[0]).join(', ')
                ) : (
                  <span className="text-caution">no evidence attached yet</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </Page>
  );
}
