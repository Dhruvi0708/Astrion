import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Badge, SampleBadge } from '@/components/ui/Badge';
import { DISCOVERIES, DISCOVERY_META, evidenceById, STATUS_META } from '@/data/sample/discoveries';
import { cn } from '@/lib/cn';
import { EvidenceLattice } from '@/features/discovery/components/EvidenceLattice';
import { SectionIntro } from '../components/SectionIntro';

export function DiscoverySection() {
  const [activeId, setActiveId] = useState(DISCOVERIES[0].id);
  const active = DISCOVERIES.find((d) => d.id === activeId)!;
  const meta = DISCOVERY_META[active.type];
  const status = STATUS_META[active.status];

  return (
    <section id="discovery" aria-labelledby="discovery-title" className="relative scroll-mt-16 border-t border-line/60 py-28 md:py-36">
      <div className="mx-auto max-w-[1240px] px-5 md:px-8">
        <SectionIntro index="05" eyebrow="Discovery" title="Where separate evidence becomes something new." id="discovery-title">
          <p>
            When evidence from unrelated sources meets in the graph, patterns emerge: relationships nobody stated, contradictions nobody noticed, regions
            nobody has studied, and hypotheses worth testing. Each stays traceable to its evidence — and clearly labelled until verified.
          </p>
        </SectionIntro>

        <div role="tablist" aria-label="Discovery types" className="mt-12 grid grid-cols-2 gap-2 md:grid-cols-4">
          {DISCOVERIES.map((d) => {
            const m = DISCOVERY_META[d.type];
            const on = d.id === activeId;
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={on}
                aria-controls="discovery-panel"
                onClick={() => setActiveId(d.id)}
                className={cn('rounded-lg border px-4 py-3 text-left transition-colors', on ? 'bg-surface' : 'border-line hover:border-line-strong')}
                style={on ? { borderColor: `${m.color}66` } : undefined}
              >
                <span className="block font-display text-2xs font-medium uppercase tracking-[0.14em]" style={{ color: m.color }}>
                  {m.label}
                </span>
                <span className="mt-1 block truncate text-[0.8rem] text-ink-muted">{d.title}</span>
              </button>
            );
          })}
        </div>

        <div id="discovery-panel" role="tabpanel" className="panel mt-4 overflow-hidden bg-deep/60">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <SampleBadge label="Sample evidence · fictional sources" />
            <span className="hidden text-2xs text-ink-faint sm:block">Not research findings — illustrates how provenance will be shown.</span>
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="overflow-x-auto p-4">
              <div className="min-w-[720px]">
                <EvidenceLattice active={active} onSelect={(d) => setActiveId(d.id)} />
              </div>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={active.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="border-t border-line p-5 lg:border-l lg:border-t-0">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <Badge tone={status.tone} title={status.description}>
                    {status.label}
                  </Badge>
                </div>
                <h3 className="mt-4 font-display text-lg font-medium leading-snug text-ink">{active.title}</h3>
                <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-muted">{active.summary}</p>
                <p className="eyebrow mt-5">Evidence trail</p>
                {active.evidenceIds.length ? (
                  <ul className="mt-2 space-y-2">
                    {active.evidenceIds.map((id) => {
                      const ev = evidenceById.get(id)!;
                      return (
                        <li key={id} className="rounded-md border border-line bg-deep px-3 py-2">
                          <p className="font-mono text-2xs text-ink-faint">
                            {ev.sourceLabel} · {ev.locator}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-ink">{ev.statement}</p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-md border border-dashed border-gap/40 px-3 py-2 text-xs text-gap">No evidence exists for this region — that absence is the discovery.</p>
                )}
                <p className="eyebrow mt-5">Next step</p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{active.nextStep}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
