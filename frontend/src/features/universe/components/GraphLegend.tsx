import { RELATION_COLOR, RELATION_LABEL, type RelationKind } from '@/data/sample/graph';
import { color } from '@/design/tokens';
import { cn } from '@/lib/cn';

const SHAPES = [
  { label: 'Concept', svg: <circle cx="7" cy="7" r="5" fill={color.cyan} /> },
  { label: 'Claim', svg: <path d="M7 2 L12 7 L7 12 L2 7 Z" fill={color.deep} stroke={color.ink} /> },
  { label: 'Source', svg: <rect x="2.5" y="2.5" width="9" height="9" fill={color.deep} stroke="#c9d3e3" /> },
  { label: 'Hypothesis', svg: <circle cx="7" cy="7" r="5" fill="none" stroke={color.violet} strokeDasharray="2 2" /> },
];

const RELATIONS: RelationKind[] = ['influences', 'correlates', 'supports', 'contradicts', 'hypothesized', 'mentions'];

export function GraphLegend({ className, relations = true }: { className?: string; relations?: boolean }) {
  return (
    <div className={cn('space-y-3', className)}>
      <div>
        <p className="eyebrow mb-1.5">Nodes</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {SHAPES.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs text-ink-muted">
              <svg width="14" height="14" aria-hidden>
                {s.svg}
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      {relations && (
        <div>
          <p className="eyebrow mb-1.5">Relationships</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
            {RELATIONS.map((r) => (
              <li key={r} className="flex items-center gap-2 text-xs text-ink-muted">
                <svg width="18" height="6" aria-hidden>
                  <line
                    x1="0"
                    y1="3"
                    x2="18"
                    y2="3"
                    stroke={RELATION_COLOR[r]}
                    strokeWidth="1.5"
                    strokeDasharray={r === 'contradicts' ? '4 3' : r === 'hypothesized' ? '2 3' : undefined}
                  />
                </svg>
                {RELATION_LABEL[r]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
