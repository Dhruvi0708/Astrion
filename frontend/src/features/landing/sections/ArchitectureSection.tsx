import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { useInView, useReducedMotionPreference } from '@/lib/hooks';
import { SectionIntro } from '../components/SectionIntro';
import { STAGES } from '../data/stages';

const C = 230;
const R = 168;
const pos = (i: number) => {
  const a = (-90 + i * 60) * (Math.PI / 180);
  return { x: C + Math.cos(a) * R, y: C + Math.sin(a) * R };
};

function arcPath(i: number) {
  const a = pos(i);
  const b = pos((i + 1) % 6);
  return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`;
}

export function ArchitectureSection() {
  const [active, setActive] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = useReducedMotionPreference();
  const stage = STAGES[active];

  useEffect(() => {
    if (!inView || interacted || reduced) return;
    const t = window.setInterval(() => setActive((i) => (i + 1) % STAGES.length), 4200);
    return () => window.clearInterval(t);
  }, [inView, interacted, reduced]);

  const select = (i: number) => {
    setInteracted(true);
    setActive(i);
  };

  return (
    <section id="architecture" aria-labelledby="arch-title" className="relative scroll-mt-16 overflow-hidden border-t border-line/60 py-28 md:py-36">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(var(--cyan)/0.05),transparent_65%)]"
      />
      <div className="mx-auto max-w-[1240px] px-5 md:px-8">
        <SectionIntro index="02" eyebrow="The ASTRION architecture" title="Six stages. One continuously learning system." id="arch-title">
          <p>
            ASTRION is a loop, not a pipeline. Each stage feeds the next, and the final stage feeds new evidence back into the first — so the universe of
            knowledge keeps evolving.
          </p>
        </SectionIntro>

        <div ref={ref} className="mt-16 grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Orbital system */}
          <div className="relative mx-auto w-full max-w-[520px]">
            <svg viewBox="0 0 460 460" className="w-full" aria-hidden>
              <defs>
                <radialGradient id="arch-core">
                  <stop offset="0" stopColor="#4fe3f0" stopOpacity="0.22" />
                  <stop offset="1" stopColor="#4fe3f0" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx={C} cy={C} r={R + 34} fill="none" stroke="#1c253d" strokeDasharray="2 6" />
              <circle cx={C} cy={C} r={R - 52} fill="none" stroke="#1c253d" />
              {STAGES.map((_, i) => {
                const p = pos(i);
                return (
                  <line
                    key={`s${i}`}
                    x1={C}
                    y1={C}
                    x2={p.x}
                    y2={p.y}
                    stroke={i === active ? '#4fe3f0' : '#1c253d'}
                    strokeOpacity={i === active ? 0.5 : 1}
                    strokeWidth={i === active ? 1 : 0.8}
                  />
                );
              })}
              {STAGES.map((_, i) => (
                <g key={`a${i}`}>
                  <path d={arcPath(i)} fill="none" stroke="#2c3858" strokeWidth={1.2} />
                  <path
                    d={arcPath(i)}
                    fill="none"
                    stroke={i === 5 ? '#9d8cff' : '#4fe3f0'}
                    strokeWidth={1.4}
                    strokeDasharray="6 160"
                    className={reduced ? undefined : 'animate-[dash_3.2s_linear_infinite]'}
                    style={{ animationDelay: `${i * -0.5}s` }}
                    strokeOpacity={0.9}
                  />
                </g>
              ))}
              <circle cx={C} cy={C} r={100} fill="url(#arch-core)" />
              {STAGES.map((s, i) => {
                const p = pos(i);
                const isActive = i === active;
                return (
                  <g key={s.id} onClick={() => select(i)} className="cursor-pointer">
                    {isActive && <circle cx={p.x} cy={p.y} r={34} fill="#4fe3f0" fillOpacity={0.08} />}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={24}
                      fill="#0a0e1a"
                      stroke={isActive ? '#4fe3f0' : s.status === 'foundation' ? '#2c3858' : '#1c253d'}
                      strokeWidth={isActive ? 1.5 : 1}
                      strokeDasharray={s.status === 'planned' && !isActive ? '3 3' : undefined}
                    />
                    <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontFamily="ui-monospace, monospace" fill={isActive ? '#4fe3f0' : '#8b97ad'}>
                      0{s.index}
                    </text>
                    <text
                      x={p.x}
                      y={p.y + (p.y > C ? 46 : -36)}
                      textAnchor="middle"
                      fontSize={12.5}
                      fontWeight={500}
                      fontFamily="Space Grotesk Variable, sans-serif"
                      fill={isActive ? '#e6ecf6' : '#8b97ad'}
                    >
                      {s.name}
                    </text>
                  </g>
                );
              })}
            </svg>
            {/* Centre readout */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={stage.id}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.35 }}
                  className="text-center"
                >
                  <stage.icon size={22} className="mx-auto text-cyan" strokeWidth={1.5} />
                  <p className="mt-2 font-display text-xl font-medium text-ink">{stage.name}</p>
                  <p className="mt-0.5 text-2xs uppercase tracking-[0.16em] text-ink-faint">Stage 0{stage.index}</p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Detail */}
          <div>
            <div role="tablist" aria-label="Architecture stages" className="mb-6 flex flex-wrap gap-1.5">
              {STAGES.map((s, i) => (
                <button
                  key={s.id}
                  role="tab"
                  id={`stage-tab-${s.id}`}
                  aria-selected={i === active}
                  aria-controls="stage-panel"
                  onClick={() => select(i)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
                    i === active ? 'border-cyan/50 bg-cyan/[0.08] text-cyan' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
                  )}
                >
                  <span className="mr-1.5 font-mono text-ink-faint">0{s.index}</span>
                  {s.name}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={stage.id}
                id="stage-panel"
                role="tabpanel"
                aria-labelledby={`stage-tab-${stage.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="panel bg-surface/50 p-6 md:p-7"
              >
                <div className="flex items-center gap-2">
                  {stage.status === 'foundation' ? <Badge tone="cyan">Foundation in Phase 1</Badge> : <Badge tone="planned">Planned</Badge>}
                </div>
                <h3 className="mt-4 font-display text-2xl font-medium text-ink">{stage.tagline}</h3>
                <p className="mt-3 leading-relaxed text-ink-muted">{stage.description}</p>
                <div className="mt-6">
                  <p className="eyebrow">Produces</p>
                  <ul className="mt-2.5 flex flex-wrap gap-2">
                    {stage.produces.map((p) => (
                      <li key={p} className="rounded border border-line bg-deep px-2.5 py-1 text-xs text-ink">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-6 border-t border-line pt-4 text-[0.8rem] leading-relaxed text-ink-faint">{stage.phaseNote}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
