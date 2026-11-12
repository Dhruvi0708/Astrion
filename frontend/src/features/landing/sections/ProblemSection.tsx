import { useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { SectionIntro } from '../components/SectionIntro';

interface Fragment {
  label: string;
  kind: string;
  from: [number, number, number];
  to: [number, number];
  tone: string;
}

const HUB: [number, number] = [300, 230];

/** Fragments drift from isolation (scattered, tilted) into an organised constellation as you scroll. */
const FRAGMENTS: Fragment[] = [
  { label: 'Research paper', kind: 'PDF', from: [70, 60, -9], to: [300, 70], tone: '#4fe3f0' },
  { label: 'Field dataset', kind: 'CSV', from: [520, 50, 7], to: [455, 130], tone: '#5ee0a5' },
  { label: 'Policy report', kind: 'DOC', from: [560, 260, -6], to: [480, 290], tone: '#f0ba68' },
  { label: 'Lab notes', kind: 'TXT', from: [470, 410, 11], to: [370, 385], tone: '#e6ecf6' },
  { label: 'Survey results', kind: 'XLS', from: [200, 420, -12], to: [210, 385], tone: '#7aa2ff' },
  { label: 'Journal article', kind: 'HTML', from: [40, 300, 8], to: [110, 290], tone: '#9d8cff' },
  { label: 'Briefing memo', kind: 'DOC', from: [90, 180, 14], to: [140, 130], tone: '#f0ba68' },
];

const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 0],
  [0, 3],
  [1, 5],
];

function FragmentCard({ f, progress }: { f: Fragment; progress: MotionValue<number> }) {
  const x = useTransform(progress, [0, 0.8], [f.from[0], f.to[0]]);
  const y = useTransform(progress, [0, 0.8], [f.from[1], f.to[1]]);
  const rotate = useTransform(progress, [0, 0.8], [f.from[2], 0]);
  const stroke = useTransform(progress, [0.5, 0.9], ['#1c253d', f.tone]);
  return (
    <motion.g style={{ x, y, rotate, transformBox: 'fill-box', transformOrigin: 'center' }}>
      <motion.rect x={-58} y={-24} width={116} height={48} rx={6} fill="#0a0e1a" style={{ stroke }} strokeWidth={1} />
      <rect x={-48} y={-14} width={26} height={14} rx={3} fill={f.tone} fillOpacity={0.12} />
      <text x={-35} y={-4} textAnchor="middle" fontSize={7.5} fontFamily="ui-monospace, monospace" fill={f.tone}>
        {f.kind}
      </text>
      <text x={-48} y={14} fontSize={9.5} fontFamily="Inter Variable, Inter, sans-serif" fill="#8b97ad">
        {f.label}
      </text>
      <rect x={-14} y={-9} width={56} height={2} rx={1} fill="#2c3858" />
      <rect x={-14} y={-3} width={38} height={2} rx={1} fill="#2c3858" />
    </motion.g>
  );
}

export function ProblemSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.9', 'center 0.5'] });
  const linkLength = useTransform(scrollYProgress, [0.65, 1], [0, 1]);
  const hubOpacity = useTransform(scrollYProgress, [0.6, 1], [0, 1]);
  const hubScale = useTransform(scrollYProgress, [0.6, 1], [0.6, 1]);
  const isolatedOpacity = useTransform(scrollYProgress, [0, 0.45], [1, 0]);
  const connectedOpacity = useTransform(scrollYProgress, [0.55, 0.9], [0, 1]);

  return (
    <section id="problem" aria-labelledby="problem-title" className="relative border-t border-line/60 py-28 md:py-36">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-5 md:px-8 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionIntro index="01" eyebrow="The problem" title="Valuable knowledge lives in fragments." id="problem-title">
            <p>
              Research papers, datasets, reports and notes each hold part of the picture. They rarely reference each other, they use different vocabularies, and
              the relationships between them stay invisible — so contradictions go unnoticed and insights wait to be found.
            </p>
          </SectionIntro>
          <ul className="mt-10 space-y-5">
            {[
              ['Isolated', 'Findings sit inside documents that never reference one another.'],
              ['Untraceable', 'Conclusions lose the evidence trail that produced them.'],
              ['Static', 'New evidence arrives, but earlier understanding is never revisited.'],
            ].map(([t, d], i) => (
              <motion.li
                key={t}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="flex gap-4"
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 rotate-45 border border-conflict/70" />
                <div>
                  <p className="font-display text-[0.95rem] font-medium text-ink">{t}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{d}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </div>

        <div ref={ref} className="relative">
          <div className="panel relative overflow-hidden bg-deep/60">
            <div className="hairline-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
            <svg
              viewBox="0 0 600 460"
              className="relative block w-full"
              role="img"
              aria-label="Isolated documents gradually connect into a single knowledge network as you scroll."
            >
              <g>
                {LINKS.map(([a, b], i) => (
                  <motion.line
                    key={i}
                    x1={FRAGMENTS[a].to[0]}
                    y1={FRAGMENTS[a].to[1]}
                    x2={FRAGMENTS[b].to[0]}
                    y2={FRAGMENTS[b].to[1]}
                    stroke={i > 6 ? '#9d8cff' : '#4fe3f0'}
                    strokeOpacity={0.45}
                    strokeWidth={1}
                    strokeDasharray={i > 6 ? '3 4' : undefined}
                    style={{ pathLength: linkLength }}
                  />
                ))}
                {FRAGMENTS.map((f, i) => (
                  <motion.line
                    key={`h${i}`}
                    x1={HUB[0]}
                    y1={HUB[1]}
                    x2={f.to[0]}
                    y2={f.to[1]}
                    stroke="#4fe3f0"
                    strokeOpacity={0.22}
                    strokeWidth={0.8}
                    style={{ pathLength: linkLength }}
                  />
                ))}
              </g>
              <motion.g style={{ opacity: hubOpacity, scale: hubScale, transformBox: 'fill-box', transformOrigin: 'center' }}>
                <circle cx={HUB[0]} cy={HUB[1]} r={40} fill="#4fe3f0" fillOpacity={0.06} />
                <circle cx={HUB[0]} cy={HUB[1]} r={26} fill="none" stroke="#4fe3f0" strokeOpacity={0.5} />
                <circle cx={HUB[0]} cy={HUB[1]} r={7} fill="#4fe3f0" />
                <text
                  x={HUB[0]}
                  y={HUB[1] + 46}
                  textAnchor="middle"
                  fontSize={8.5}
                  letterSpacing={2}
                  fontFamily="Space Grotesk Variable, sans-serif"
                  fill="#4fe3f0"
                >
                  CONNECTED KNOWLEDGE
                </text>
              </motion.g>
              {FRAGMENTS.map((f) => (
                <FragmentCard key={f.label} f={f} progress={scrollYProgress} />
              ))}
            </svg>
            <div className="relative flex items-center justify-between border-t border-line px-4 py-2.5 text-2xs uppercase tracking-[0.14em]">
              <motion.span style={{ opacity: isolatedOpacity }} className="text-conflict/80">
                Fragmented · no shared context
              </motion.span>
              <motion.span style={{ opacity: connectedOpacity }} className="text-cyan">
                Connected · traceable relationships
              </motion.span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
