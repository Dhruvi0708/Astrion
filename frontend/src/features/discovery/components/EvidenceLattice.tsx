import { motion } from 'framer-motion';
import { nodeById } from '@/data/sample/graph';
import { DISCOVERIES, DISCOVERY_META, EVIDENCE, type Discovery } from '@/data/sample/discoveries';

/**
 * Three-column evidence lattice: evidence fragments → graph concepts → discoveries.
 * The active discovery lights up exactly the evidence and concepts it depends on, making provenance visible.
 */
const CONCEPTS = ['sst', 'bleach', 'reef', 'fish', 'livelihoods', 'seagrass', 'nutrients', 'mangrove', 'waveatt', 'surge', 'floodrisk', 'marsh'];

const W = 960;
const H = 420;
const evY = (i: number) => 46 + i * ((H - 92) / (EVIDENCE.length - 1));
const cPos = (i: number) => ({ x: 430 + (i % 2) * 120, y: 28 + i * ((H - 56) / (CONCEPTS.length - 1)) });
const dY = (i: number) => 70 + i * ((H - 140) / (DISCOVERIES.length - 1));

// Evidence → concept links (fixed provenance of the sample evidence)
const EV_LINKS: Record<string, string[]> = {
  ev1: ['sst', 'bleach'],
  ev2: ['seagrass'],
  ev3: ['mangrove', 'waveatt'],
  ev4: ['surge', 'floodrisk', 'mangrove'],
  ev5: ['fish', 'livelihoods'],
  ev6: ['floodrisk'],
};

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
};

export function EvidenceLattice({ active, onSelect }: { active: Discovery; onSelect?: (d: Discovery) => void }) {
  const meta = DISCOVERY_META[active.type];
  const activeEv = new Set(active.evidenceIds);
  const activeC = new Set(active.conceptIds);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Evidence lattice for “${active.title}”: ${active.evidenceIds.length} evidence items and ${active.conceptIds.length} concepts are involved.`}>
      {/* Column labels */}
      {[
        [40, 'EVIDENCE'],
        [430, 'GRAPH CONCEPTS'],
        [742, 'DISCOVERIES'],
      ].map(([x, t]) => (
        <text key={t as string} x={x as number} y={12} fontSize={9} letterSpacing={2} fill="#5a6680" fontFamily="Space Grotesk Variable, sans-serif">
          {t}
        </text>
      ))}

      {/* Evidence → concept */}
      {EVIDENCE.flatMap((ev, i) =>
        EV_LINKS[ev.id].map((cid) => {
          const ci = CONCEPTS.indexOf(cid);
          const c = cPos(ci);
          const on = activeEv.has(ev.id) && activeC.has(cid);
          return (
            <motion.path
              key={`${ev.id}-${cid}`}
              d={curve(262, evY(i), c.x - 8, c.y)}
              fill="none"
              stroke={on ? (ev.stance === 'contradicts' ? '#ff7a8a' : meta.color) : '#1c253d'}
              strokeWidth={on ? 1.4 : 1}
              strokeDasharray={ev.stance === 'contradicts' && on ? '5 4' : undefined}
              initial={false}
              animate={{ opacity: on ? 1 : 0.7 }}
            />
          );
        }),
      )}

      {/* Concept chain for the active discovery */}
      {active.conceptIds.slice(1).map((cid, i) => {
        const a = cPos(CONCEPTS.indexOf(active.conceptIds[i]));
        const b = cPos(CONCEPTS.indexOf(cid));
        return (
          <motion.path
            key={`${active.id}-chain-${cid}`}
            d={`M ${a.x} ${a.y} Q ${Math.max(a.x, b.x) + 50} ${(a.y + b.y) / 2} ${b.x} ${b.y}`}
            fill="none"
            stroke={meta.color}
            strokeOpacity={0.6}
            strokeWidth={1.2}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.6, delay: 0.1 * i }}
          />
        );
      })}

      {/* Concepts → discovery */}
      {active.conceptIds.map((cid) => {
        const c = cPos(CONCEPTS.indexOf(cid));
        const di = DISCOVERIES.findIndex((d) => d.id === active.id);
        return (
          <motion.path
            key={`${active.id}-out-${cid}`}
            d={curve(c.x + 10, c.y, 736, dY(di))}
            fill="none"
            stroke={meta.color}
            strokeWidth={1}
            strokeOpacity={0.45}
            strokeDasharray={active.type === 'gap' || active.type === 'hypothesis' ? '3 4' : undefined}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.7, delay: 0.25 }}
          />
        );
      })}

      {/* Evidence nodes */}
      {EVIDENCE.map((ev, i) => {
        const on = activeEv.has(ev.id);
        return (
          <g key={ev.id} opacity={on ? 1 : 0.45}>
            <rect x={40} y={evY(i) - 17} width={222} height={34} rx={5} fill="#0a0e1a" stroke={on ? (ev.stance === 'contradicts' ? '#ff7a8a' : meta.color) : '#1c253d'} />
            <text x={50} y={evY(i) - 3} fontSize={8} fill="#5a6680" fontFamily="ui-monospace, monospace">
              {ev.sourceLabel.split(' · ')[0].toUpperCase()} · {ev.locator}
            </text>
            <text x={50} y={evY(i) + 10} fontSize={9.5} fill={on ? '#e6ecf6' : '#8b97ad'} fontFamily="Inter Variable, Inter, sans-serif">
              {ev.statement.length > 40 ? `${ev.statement.slice(0, 39)}…` : ev.statement}
            </text>
          </g>
        );
      })}

      {/* Concept nodes */}
      {CONCEPTS.map((cid, i) => {
        const c = cPos(i);
        const on = activeC.has(cid);
        const missing = active.type === 'gap' && on && cid === 'marsh';
        return (
          <g key={cid} opacity={on ? 1 : 0.4}>
            <circle cx={c.x} cy={c.y} r={on ? 6 : 4.5} fill={on ? meta.color : '#2c3858'} />
            {missing && <circle cx={c.x} cy={c.y} r={13} fill="none" stroke="#7aa2ff" strokeDasharray="2 3" />}
            <text x={c.x + 12} y={c.y + 3.5} fontSize={10} fill={on ? '#e6ecf6' : '#8b97ad'} fontFamily="Inter Variable, Inter, sans-serif">
              {nodeById.get(cid)?.label}
            </text>
          </g>
        );
      })}

      {/* Discovery nodes */}
      {DISCOVERIES.map((d, i) => {
        const m = DISCOVERY_META[d.type];
        const on = d.id === active.id;
        return (
          <g key={d.id} onClick={() => onSelect?.(d)} className={onSelect ? 'cursor-pointer' : undefined} opacity={on ? 1 : 0.5}>
            <rect x={742} y={dY(i) - 22} width={204} height={44} rx={6} fill={on ? `${m.color}14` : '#0a0e1a'} stroke={on ? m.color : '#1c253d'} />
            <text x={756} y={dY(i) - 5} fontSize={8.5} letterSpacing={1.4} fill={m.color} fontFamily="Space Grotesk Variable, sans-serif">
              {m.label.toUpperCase()}
            </text>
            <text x={756} y={dY(i) + 10} fontSize={9.5} fill={on ? '#e6ecf6' : '#8b97ad'} fontFamily="Inter Variable, Inter, sans-serif">
              {d.title.length > 32 ? `${d.title.slice(0, 31)}…` : d.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
