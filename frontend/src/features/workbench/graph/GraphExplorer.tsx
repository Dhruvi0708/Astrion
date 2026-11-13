import { lazy, Suspense, useMemo, useState } from 'react';
import { Database, Quote, Share2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Segmented } from '@/components/ui/Segmented';
import { useEntityDetail, useWorkspaceGraph } from '@/lib/api/hooks';
import type { WorkspaceGraphNode } from '@/lib/api/types';
import { hasWebGL } from '@/lib/webgl';
import { ENTITY_COLOR } from './layout3d';

const KnowledgeGraph3D = lazy(() => import('./KnowledgeGraph3D'));

interface GraphExplorerProps {
  workspaceId: string;
  investigationId?: string;
  live?: boolean;
  /** Keys to emphasise, e.g. claim nodes behind a selected hypothesis. */
  highlight?: Set<string> | null;
  height?: number;
  emptyHint?: string;
}

function GraphList({ nodes, onSelect }: { nodes: WorkspaceGraphNode[]; onSelect: (key: string) => void }) {
  return (
    <ul className="max-h-full divide-y divide-line overflow-auto text-sm" aria-label="Graph nodes">
      {nodes
        .filter((n) => n.kind === 'entity')
        .map((n) => (
          <li key={n.key}>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-raised/50" onClick={() => onSelect(n.key)}>
              <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_COLOR[n.entity_type ?? 'other'] }} />
              <span className="text-ink">{n.label}</span>
              <span className="ml-auto text-2xs text-ink-faint">{n.mention_count} mentions</span>
            </button>
          </li>
        ))}
    </ul>
  );
}

function Inspector({ workspaceId, node }: { workspaceId: string; node: WorkspaceGraphNode }) {
  const entity = useEntityDetail(workspaceId, node.kind === 'entity' ? (node.entity_id ?? null) : null);
  if (node.kind === 'claim') {
    return (
      <div className="space-y-2 p-4">
        <Badge tone={node.claim_kind === 'inferred' ? 'unverified' : 'neutral'}>{node.claim_kind} claim</Badge>
        <p className="text-sm leading-relaxed text-ink">{node.label}</p>
        <p className="text-2xs text-ink-faint">Select the entity it is about to see its evidence and source.</p>
      </div>
    );
  }
  if (entity.isPending) return <Skeleton className="m-4 h-40" />;
  if (entity.isError) return <ErrorState error={entity.error} compact className="m-4" />;
  const d = entity.data;
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: ENTITY_COLOR[d.entity_type] ?? ENTITY_COLOR.other }} />
          <h3 className="font-display text-base text-ink">{d.name}</h3>
        </div>
        <p className="mt-1 text-2xs uppercase tracking-wider text-ink-faint">
          {d.entity_type} · {d.mention_count} mentions{d.aliases.length ? ` · also "${d.aliases.join('", "')}"` : ''}
        </p>
        {d.description && <p className="mt-2 text-xs leading-relaxed text-ink-muted">{d.description}</p>}
      </div>
      {d.relationships.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">Relationships</p>
          <ul className="space-y-1 text-xs">
            {d.relationships.map((r) => (
              <li key={r.id} className="text-ink-muted">
                {r.direction === 'out' ? (
                  <>
                    <span className="text-cyan">{r.type.toLowerCase().replace(/_/g, ' ')}</span> → {r.other.name}
                  </>
                ) : (
                  <>
                    {r.other.name} <span className="text-cyan">{r.type.toLowerCase().replace(/_/g, ' ')}</span> → this
                  </>
                )}
                <span className="text-ink-faint"> · {r.support_count} supporting claim(s)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="eyebrow mb-1.5">Claims and evidence</p>
        <ul className="space-y-2">
          {d.claims.map((c) => (
            <li key={c.id} className="rounded-md border border-line bg-deep/60 p-2.5">
              <p className="text-xs leading-relaxed text-ink">{c.statement}</p>
              {c.evidence.slice(0, 2).map((e, i) => (
                <p key={i} className="mt-1.5 flex gap-1.5 text-2xs italic leading-relaxed text-ink-muted">
                  <Quote size={11} className="mt-0.5 shrink-0" />“{e.quote}”
                </p>
              ))}
              <p className="mt-1.5 text-2xs text-ink-faint">
                {c.document?.title ?? 'unknown document'} · {c.source?.title ?? 'unknown source'}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The knowledge graph as recorded by the backend (Neo4j, or PostgreSQL when Neo4j isn't available). */
export function GraphExplorer({ workspaceId, investigationId, live, highlight, height = 520, emptyHint }: GraphExplorerProps) {
  const [layer, setLayer] = useState<'entities' | 'claims'>('entities');
  const [selected, setSelected] = useState<string | null>(null);
  const graph = useWorkspaceGraph(workspaceId, { investigationId, includeClaims: layer === 'claims', live });
  const webgl = useMemo(() => hasWebGL(), []);
  const node = graph.data?.nodes.find((n) => n.key === selected) ?? null;

  if (graph.isPending)
    return (
      <div style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    );
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => graph.refetch()} />;
  const g = graph.data;
  const entityCount = g.nodes.filter((n) => n.kind === 'entity').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Graph layers"
          value={layer}
          onChange={(v) => {
            setLayer(v);
            setSelected(null);
          }}
          options={[
            { value: 'entities', label: 'Entities' },
            { value: 'claims', label: 'Entities + claims' },
          ]}
        />
        <Badge tone={g.source === 'neo4j' ? 'live' : 'neutral'} title={g.fallback_reason ?? 'Read from Neo4j'}>
          {g.source === 'neo4j' ? <Share2 size={11} /> : <Database size={11} />} {g.source === 'neo4j' ? 'Neo4j' : 'PostgreSQL registry'}
        </Badge>
        <span className="text-2xs text-ink-faint">
          {entityCount} entities · {g.edges.filter((e) => e.type !== 'ABOUT').length} relationships
          {layer === 'claims' && ` · ${g.nodes.length - entityCount} claims`}
        </span>
        {g.fallback_reason && <span className="text-2xs text-ink-faint">({g.fallback_reason})</span>}
      </div>
      {g.nodes.length === 0 ? (
        <EmptyState
          icon={<Share2 size={18} />}
          title="No knowledge recorded yet"
          description={emptyHint ?? 'Run an investigation over documents with readable text to build the graph.'}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div className="relative overflow-hidden rounded-lg border border-line bg-abyss" style={{ height }} data-testid="knowledge-graph">
            {webgl ? (
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <KnowledgeGraph3D graph={g} selectedKey={selected} onSelect={setSelected} highlight={highlight} />
              </Suspense>
            ) : (
              <GraphList nodes={g.nodes} onSelect={setSelected} />
            )}
            {webgl && (
              <p className="pointer-events-none absolute bottom-2 left-3 text-2xs text-ink-faint">
                Drag to orbit · scroll to zoom ·{' '}
                {layer === 'claims' ? 'claims sit on the plane behind the entities they describe' : 'node size = mentions across documents'}
              </p>
            )}
          </div>
          <aside className="overflow-auto rounded-lg border border-line bg-surface/60" style={{ maxHeight: height }} aria-label="Selected node">
            {node ? (
              <Inspector workspaceId={workspaceId} node={node} />
            ) : (
              <p className="p-4 text-xs leading-relaxed text-ink-muted">Select a node to see what the documents say about it, with quotes and sources.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
