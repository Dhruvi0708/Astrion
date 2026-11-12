import { ArrowDownLeft, ArrowUpRight, MousePointerClick, X } from 'lucide-react';
import { Badge, SampleBadge } from '@/components/ui/Badge';
import { Meter } from '@/components/ui/Meter';
import { clusterById, neighbours, NODE_KIND_LABEL, RELATION_COLOR, RELATION_LABEL, type GraphNode, type KnowledgeGraph } from '@/data/sample/graph';
import { cn } from '@/lib/cn';

const KIND_TONE = { concept: 'neutral', claim: 'unverified', source: 'neutral', hypothesis: 'hypothesis' } as const;

export function NodeInspector({
  graph,
  node,
  onSelect,
  onClose,
  compact,
  className,
}: {
  graph: KnowledgeGraph;
  node: GraphNode | null;
  onSelect: (id: string) => void;
  onClose?: () => void;
  compact?: boolean;
  className?: string;
}) {
  if (!node) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center px-6 py-10 text-center', className)}>
        <div className="grid h-10 w-10 place-items-center rounded-full border border-line-strong text-ink-faint">
          <MousePointerClick size={16} />
        </div>
        <p className="mt-3 font-display text-sm text-ink">Select a node</p>
        <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-ink-muted">Click any node in the graph to inspect it and trace its relationships.</p>
      </div>
    );
  }

  const cluster = clusterById[node.cluster];
  const links = neighbours(graph, node.id).sort((a, b) => b.edge.confidence - a.edge.confidence);

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="border-b border-line p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={KIND_TONE[node.kind]}>{NODE_KIND_LABEL[node.kind]}</Badge>
            {node.kind === 'hypothesis' && <Badge tone="unverified">Unverified</Badge>}
            {graph.isSample && <SampleBadge label="Sample" />}
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Clear selection" className="-mr-1 -mt-1 rounded p-1 text-ink-faint hover:bg-raised hover:text-ink">
              <X size={14} />
            </button>
          )}
        </div>
        <h3 className="mt-3 font-display text-base font-medium leading-snug text-ink">{node.label}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: cluster.color }} />
          {cluster.label}
        </p>
        <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-muted">{node.summary}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="eyebrow mb-2.5">
          Relationships <span className="font-mono text-ink-muted">{links.length}</span>
        </p>
        <ul className="space-y-1.5">
          {links.slice(0, compact ? 6 : undefined).map(({ edge, node: other, direction }) => (
            <li key={edge.id}>
              <button
                onClick={() => onSelect(other.id)}
                className="group w-full rounded-md border border-line bg-deep/60 px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-raised/40"
              >
                <div className="flex items-center gap-2 text-2xs uppercase tracking-[0.08em]" style={{ color: RELATION_COLOR[edge.kind] }}>
                  {direction === 'out' ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
                  {direction === 'out' ? RELATION_LABEL[edge.kind] : `${RELATION_LABEL[edge.kind]} ←`}
                </div>
                <p className="mt-1 truncate text-[0.8rem] text-ink group-hover:text-cyan">{other.label}</p>
                {!compact && edge.kind !== 'mentions' && (
                  <div className="mt-1.5 flex items-center gap-3">
                    <Meter
                      value={edge.confidence}
                      label={`Sample confidence for ${RELATION_LABEL[edge.kind]} ${other.label}`}
                      tone={edge.kind === 'contradicts' ? 'conflict' : edge.kind === 'hypothesized' ? 'violet' : 'cyan'}
                      className="flex-1"
                    />
                    <span className="text-2xs text-ink-faint">{edge.evidence} evid.</span>
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        {compact && links.length > 6 && <p className="mt-2 text-2xs text-ink-faint">+{links.length - 6} more in the Universe Explorer</p>}
        {graph.isSample && !compact && (
          <p className="mt-4 text-2xs leading-relaxed text-ink-faint">
            Confidence values and evidence counts are placeholder sample values, not computed results.
          </p>
        )}
      </div>
    </div>
  );
}
