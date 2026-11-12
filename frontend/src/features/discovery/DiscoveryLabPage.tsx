import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, FlaskConical } from 'lucide-react';
import { Badge, SampleBadge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Notice, Page, PageHeader } from '@/components/layout/PageHeader';
import { DISCOVERIES, DISCOVERY_META, evidenceById, STATUS_META, type Discovery } from '@/data/sample/discoveries';
import { clusterById, nodeById, sampleGraph } from '@/data/sample/graph';
import { cn } from '@/lib/cn';
import { EvidenceLattice } from './components/EvidenceLattice';
import { computeCoverage } from './coverage';

const CONFIDENCE = {
  low: { label: 'Low', bars: 1 },
  moderate: { label: 'Moderate', bars: 2 },
  high: { label: 'High', bars: 3 },
} as const;

function ConfidenceLabel({ level }: { level: Discovery['confidence'] }) {
  const c = CONFIDENCE[level];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted" title="Qualitative sample band — not a computed probability">
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-1 rounded-sm', i <= c.bars ? 'bg-cyan' : 'bg-line-strong')} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {c.label} confidence
    </span>
  );
}

function GapMatrix() {
  const { sources, clusters, cells, clusterTotals, uncovered } = useMemo(() => computeCoverage(sampleGraph), []);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-1 text-xs">
          <caption className="sr-only">Number of sample claims linking each source to each cluster. Empty cells are potential knowledge gaps.</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1 text-left text-2xs font-normal text-ink-faint">
                Cluster \ Source
              </th>
              {sources.map((s) => (
                <th key={s.id} scope="col" className="p-1 text-center text-2xs font-medium text-ink-muted" title={s.label}>
                  {s.label.split(' · ')[0].replace('Source ', '')}
                </th>
              ))}
              <th scope="col" className="p-1 text-right text-2xs font-normal text-ink-faint">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="whitespace-nowrap p-1 text-left font-normal text-ink-muted">
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: c.color }} />
                  {c.label}
                </th>
                {sources.map((s) => {
                  const n = cells.find((x) => x.cluster === c.id && x.sourceId === s.id)!.claims;
                  return (
                    <td
                      key={s.id}
                      className="h-9 rounded text-center font-mono"
                      style={
                        n
                          ? { background: `rgb(79 227 240 / ${0.1 + n * 0.18})`, color: '#e6ecf6' }
                          : { background: 'transparent', boxShadow: 'inset 0 0 0 1px rgb(122 162 255 / 0.25)' }
                      }
                    >
                      {n || <span className="text-gap/60">·</span>}
                    </td>
                  );
                })}
                <td className={cn('p-1 text-right font-mono', clusterTotals.get(c.id) ? 'text-ink-muted' : 'text-gap')}>{clusterTotals.get(c.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-md border border-dashed border-gap/30 bg-gap/[0.04] p-3">
        <p className="text-2xs font-medium uppercase tracking-[0.1em] text-gap">Concepts with no supporting claim · {uncovered.length}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {uncovered.map((n) => (
            <li key={n.id} className="rounded border border-line px-2 py-0.5 text-2xs text-ink-muted">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: clusterById[n.cluster].color }} />
              {n.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ContradictionComparison() {
  const d = DISCOVERIES.find((x) => x.type === 'contradiction')!;
  const [a, b] = d.evidenceIds.map((id) => evidenceById.get(id)!);
  const Column = ({ ev, side }: { ev: typeof a; side: 'A' | 'B' }) => (
    <div
      className={cn('rounded-lg border p-4', ev.stance === 'contradicts' ? 'border-conflict/30 bg-conflict/[0.04]' : 'border-verified/25 bg-verified/[0.03]')}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs text-ink-faint">Position {side}</span>
        <Badge tone={ev.stance === 'contradicts' ? 'conflict' : 'verified'}>{ev.stance === 'contradicts' ? 'Limits claim' : 'Supports claim'}</Badge>
      </div>
      <p className="mt-3 text-[0.85rem] leading-relaxed text-ink">{ev.statement}</p>
      <dl className="mt-4 space-y-1 border-t border-line pt-3 text-2xs">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Source</dt>
          <dd className="truncate text-ink-muted">{ev.sourceLabel}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Location</dt>
          <dd className="text-ink-muted">{ev.locator}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Conditions</dt>
          <dd className="text-ink-muted">{side === 'A' ? 'Routine wave conditions' : 'Most extreme modelled surge'}</dd>
        </div>
      </dl>
    </div>
  );
  return (
    <div>
      <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
        <Column ev={a} side="A" />
        <div className="flex items-center justify-center">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-conflict/40 text-conflict">
            <ArrowLeftRight size={15} />
          </span>
        </div>
        <Column ev={b} side="B" />
      </div>
      <div className="mt-3 rounded-md border border-line bg-deep/60 p-3 text-xs leading-relaxed text-ink-muted">
        <span className="font-medium text-ink">Point of disagreement:</span> whether mangroves reduce flood exposure.{' '}
        <span className="font-medium text-ink">Likely moderator:</span> surge magnitude — the positions describe different conditions, so both may hold. Status:{' '}
        <Badge tone="hypothesis">Conditional</Badge>
      </div>
    </div>
  );
}

export default function DiscoveryLabPage() {
  const [params, setParams] = useSearchParams();
  const active = DISCOVERIES.find((d) => d.id === params.get('d')) ?? DISCOVERIES[3];
  const meta = DISCOVERY_META[active.type];
  const status = STATUS_META[active.status];
  useEffect(() => {
    document.title = 'Discovery Laboratory · ASTRION';
  }, []);

  return (
    <Page>
      <PageHeader
        eyebrow="Discovery Laboratory"
        title="Discovery Laboratory"
        badges={<SampleBadge label="Sample discoveries" />}
        description="Examine hypotheses, contradictions and knowledge gaps — each tied to the evidence that produced it, and labelled by verification status."
      />
      <Notice className="mt-5">
        Every item here is a hand-written sample built on fictional sources. None is a verified finding. Automated discovery is planned; when it arrives,
        AI-generated hypotheses will always start as <strong className="font-medium text-ink">Unverified</strong>.
      </Notice>

      <div className="mt-6 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title="Hypothesis workspace" eyebrow="Discoveries" bodyClassName="p-2">
          <ul role="listbox" aria-label="Discoveries">
            {DISCOVERIES.map((d) => {
              const m = DISCOVERY_META[d.type];
              const on = d.id === active.id;
              return (
                <li key={d.id}>
                  <button
                    role="option"
                    aria-selected={on}
                    onClick={() => setParams({ d: d.id }, { replace: true })}
                    className={cn(
                      'w-full rounded-md border px-3 py-2.5 text-left transition-colors',
                      on ? 'bg-raised/60' : 'border-transparent hover:bg-raised/40',
                    )}
                    style={on ? { borderColor: `${m.color}55` } : undefined}
                  >
                    <span className="text-2xs font-medium uppercase tracking-[0.1em]" style={{ color: m.color }}>
                      {m.label}
                    </span>
                    <span className="mt-1 block text-[0.82rem] leading-snug text-ink">{d.title}</span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <Badge tone={STATUS_META[d.status].tone}>{STATUS_META[d.status].label}</Badge>
                      <span className="text-2xs text-ink-faint">{d.evidenceIds.length} evidence</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel
          title={active.title}
          eyebrow="Discovery details"
          actions={
            <>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <Badge tone={status.tone} title={status.description}>
                {status.label}
              </Badge>
            </>
          }
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <p className="text-[0.9rem] leading-relaxed text-ink-muted">{active.summary}</p>
              <div className="mt-4 overflow-x-auto rounded-md border border-line bg-deep/50 p-3">
                <div className="min-w-[680px]">
                  <EvidenceLattice active={active} onSelect={(d) => setParams({ d: d.id }, { replace: true })} />
                </div>
              </div>
            </div>
            <aside className="space-y-5">
              <div>
                <p className="eyebrow">Confidence</p>
                <div className="mt-2">
                  <ConfidenceLabel level={active.confidence} />
                </div>
                <p className="mt-1 text-2xs text-ink-faint">Sample qualitative band, not computed.</p>
              </div>
              <div>
                <p className="eyebrow">Involved concepts</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {active.conceptIds.map((id) => (
                    <li key={id} className="rounded border border-line px-2 py-0.5 text-2xs text-ink-muted">
                      {nodeById.get(id)?.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow flex items-center gap-1.5">
                  <FlaskConical size={11} /> How to test
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{active.nextStep}</p>
              </div>
            </aside>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Contradiction · evidence comparison" eyebrow="Conflicts" actions={<SampleBadge label="Sample" />}>
          <ContradictionComparison />
        </Panel>
        <Panel title="Knowledge-gap map" eyebrow="Coverage" actions={<SampleBadge label="Computed from sample graph" />}>
          <GapMatrix />
        </Panel>
      </div>

      <Panel title="Labels used in the laboratory" eyebrow="Reading guide" className="mt-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="eyebrow mb-2">Verification</p>
            <ul className="space-y-1.5">
              {Object.entries(STATUS_META).map(([k, s]) => (
                <li key={k} className="flex items-center gap-2 text-xs text-ink-muted">
                  <Badge tone={s.tone}>{s.label}</Badge> {s.description}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-2">Confidence</p>
            <ul className="space-y-2">
              {(['low', 'moderate', 'high'] as const).map((l) => (
                <li key={l}>
                  <ConfidenceLabel level={l} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              Confidence describes the strength of evidence, not truth. It is independent from verification status.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-2">Origin</p>
            <ul className="space-y-1.5 text-xs text-ink-muted">
              <li className="flex items-center gap-2">
                <Badge tone="sample">Sample</Badge> Illustrative, hand-written content
              </li>
              <li className="flex items-center gap-2">
                <Badge tone="hypothesis">Hypothesis</Badge> Proposed, never presented as fact
              </li>
              <li className="flex items-center gap-2">
                <Badge tone="verified">Verified</Badge> Reviewer-accepted, evidence attached
              </li>
            </ul>
          </div>
        </div>
      </Panel>
    </Page>
  );
}
