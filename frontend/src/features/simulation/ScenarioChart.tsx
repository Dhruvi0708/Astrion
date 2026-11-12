import { useMemo, useRef, useState } from 'react';
import { OUTCOMES, YEARS, type OutcomeKey } from './model';

/** Validated (dark surface) two-series palette — see docs/DESIGN_SYSTEM.md. */
export const SERIES = { baseline: '#8574e6', alternative: '#1fa3b1' } as const;

type Row = { t: number } & Record<OutcomeKey, number>;

const W = 640;
const H = 260;
const PAD = { l: 40, r: 92, t: 16, b: 28 };

/** Single-axis line chart comparing baseline vs alternative, with crosshair tooltip. */
export function ScenarioChart({ outcome, baseline, alternative }: { outcome: OutcomeKey; baseline: Row[]; alternative: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { yMin, yMax, ticks } = useMemo(() => {
    const vals = [...baseline, ...alternative].map((r) => r[outcome]);
    const lo = Math.floor(Math.min(...vals) / 10) * 10;
    const hi = Math.ceil(Math.max(...vals) / 10) * 10;
    const min = Math.max(0, lo - 10);
    const max = hi + 10;
    const step = (max - min) / 4;
    return { yMin: min, yMax: max, ticks: Array.from({ length: 5 }, (_, i) => min + i * step) };
  }, [baseline, alternative, outcome]);

  const x = (t: number) => PAD.l + (t / (YEARS.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const path = (rows: Row[]) => rows.map((r, i) => `${i ? 'L' : 'M'} ${x(r.t).toFixed(1)} ${y(r[outcome]).toFixed(1)}`).join(' ');

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (YEARS.length - 1));
    setHover(t >= 0 && t < YEARS.length ? t : null);
  };

  const lastB = baseline[baseline.length - 1][outcome];
  const lastA = alternative[alternative.length - 1][outcome];
  const labelGap = Math.abs(y(lastA) - y(lastB)) < 14;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${OUTCOMES[outcome].label} over 10 years: baseline ends at ${lastB.toFixed(0)}, alternative at ${lastA.toFixed(0)} (illustrative index).`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#1c253d" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="#5a6680" fontFamily="Inter Variable, Inter, sans-serif">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {YEARS.filter((t) => t % 2 === 0).map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="#5a6680" fontFamily="Inter Variable, Inter, sans-serif">
            Y{t}
          </text>
        ))}
        <path d={path(baseline)} fill="none" stroke={SERIES.baseline} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path(alternative)} fill="none" stroke={SERIES.alternative} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Direct labels at line ends (text in ink, swatch carries identity) */}
        {[
          { label: 'Baseline', v: lastB, color: SERIES.baseline, dy: labelGap && lastB >= lastA ? -7 : labelGap ? 7 : 0 },
          { label: 'Alternative', v: lastA, color: SERIES.alternative, dy: labelGap && lastA > lastB ? -7 : labelGap ? 7 : 0 },
        ].map((l) => (
          <g key={l.label}>
            <circle cx={W - PAD.r + 10} cy={y(l.v) + l.dy} r={3} fill={l.color} />
            <text x={W - PAD.r + 17} y={y(l.v) + l.dy + 3.5} fontSize={10.5} fill="#8b97ad" fontFamily="Inter Variable, Inter, sans-serif">
              {l.label}
            </text>
          </g>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#2c3858" />
            <circle cx={x(hover)} cy={y(baseline[hover][outcome])} r={4} fill={SERIES.baseline} stroke="#0e1321" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(alternative[hover][outcome])} r={4} fill={SERIES.alternative} stroke="#0e1321" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-xs shadow-panel"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > 6 ? 'calc(-100% - 10px)' : '10px'})` }}
        >
          <p className="font-medium text-ink">Year {hover}</p>
          {[
            ['Baseline', SERIES.baseline, baseline[hover][outcome]],
            ['Alternative', SERIES.alternative, alternative[hover][outcome]],
          ].map(([l, c, v]) => (
            <p key={l as string} className="mt-1 flex items-center gap-2 text-ink-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: c as string }} />
              {l}
              <span className="ml-auto pl-3 font-mono text-ink">{(v as number).toFixed(1)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
