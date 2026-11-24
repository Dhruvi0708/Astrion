import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair, Database, Expand, Focus, Lightbulb, Maximize2, Quote, RotateCcw, Search, Share2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Segmented } from '@/components/ui/Segmented';
import { api } from '@/lib/api/client';
import { useEntityDetail, useEntityTimeline, useInvestigations, useWorkspaceGraph } from '@/lib/api/hooks';
import type { EntityRow, WorkspaceGraph, WorkspaceGraphEdge, WorkspaceGraphNode } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { hasWebGL } from '@/lib/webgl';
import type { CameraCommand } from './KnowledgeGraph3D';
import { ENTITY_COLOR } from './layout3d';

const KnowledgeGraph3D = lazy(() => import('./KnowledgeGraph3D'));
const EDGE_LABEL = (t: string) => t.toLowerCase().replace(/_/g, ' ');

interface GraphExplorerProps {
  workspaceId: string;
  /** Fixed scope (investigation workbench). */
  investigationId?: string;
  /** Let the user pick an investigation scope (Universe Explorer). */
  investigationFilter?: boolean;
  live?: boolean;
  highlight?: Set<string> | null;
  height?: number;
  emptyHint?: string;
  /** Select (and if needed, load) this entity on open. */
  initialEntityId?: string | null;
}

function GraphList({ nodes, onSelect, selected }: { nodes: WorkspaceGraphNode[]; onSelect: (key: string) => void; selected: string | null }) {
  return (
    <ul className="h-full divide-y divide-line overflow-auto text-sm" aria-label="Graph nodes">
      {nodes
        .filter((n) => n.kind === 'entity')
        .sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0))
        .map((n) => (
          <li key={n.key}>
            <button
              className={cn('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-raised/50', selected === n.key && 'bg-raised/60')}
              onClick={() => onSelect(n.key)}
              aria-pressed={selected === n.key}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_COLOR[n.entity_type ?? 'other'] }} />
              <span className="text-ink">{n.label}</span>
              <span className="text-2xs capitalize text-ink-faint">{n.entity_type}</span>
              <span className="ml-auto text-2xs text-ink-faint">{n.mention_count} mentions</span>
            </button>
          </li>
        ))}
    </ul>
  );
}

function Timeline({ workspaceId, entityId }: { workspaceId: string; entityId: string }) {
  const tl = useEntityTimeline(workspaceId, entityId);
  const events = (tl.data ?? []).filter((e) => e.type === 'claim' || e.details?.kind === 'claim_superseded');
  if (tl.isPending || !events.length) return null;
  return (
    <div data-testid="timeline">
      <p className="eyebrow mb-1.5">Timeline</p>
      <ol className="space-y-1.5 border-l border-line pl-3">
        {events.map((e, i) => (
          <li key={i} className="text-xs">
            <span className="font-mono text-2xs text-cyan">{e.year ?? 'undated'}</span>{' '}
            {e.type === 'claim' ? (
              <span className={e.superseded_by_id ? 'text-ink-faint line-through' : 'text-ink-muted'}>{e.statement}</span>
            ) : (
              <span className="text-caution">
                superseded: “{String(e.details?.old ?? '')}” → “{String(e.details?.new ?? '')}”
              </span>
            )}
            {e.year_basis === 'source published' && <span className="text-2xs text-ink-faint"> (as of source date)</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Inspector({
  workspaceId,
  node,
  onOpenEntity,
  onExpand,
  expanding,
}: {
  workspaceId: string;
  node: WorkspaceGraphNode;
  onOpenEntity: (entityId: string) => void;
  onExpand: () => void;
  expanding: boolean;
}) {
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
    <div className="space-y-4 p-4" data-testid="entity-inspector">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: ENTITY_COLOR[d.entity_type] ?? ENTITY_COLOR.other }} />
          <h3 className="font-display text-base text-ink">{d.name}</h3>
        </div>
        <p className="mt-1 text-2xs uppercase tracking-wider text-ink-faint">
          {d.entity_type} · {d.mention_count} mentions{d.aliases.length ? ` · also "${d.aliases.join('", "')}"` : ''}
        </p>
        {d.description && <p className="mt-2 text-xs leading-relaxed text-ink-muted">{d.description}</p>}
        <Button size="sm" variant="outline" className="mt-2.5" onClick={onExpand} disabled={expanding}>
          <Expand size={12} /> {expanding ? 'Loading…' : 'Expand connections'}
        </Button>
      </div>
      <div>
        <p className="eyebrow mb-1.5">Connected entities</p>
        {d.relationships.length ? (
          <ul className="space-y-1 text-xs">
            {d.relationships.map((r) => (
              <li key={r.id} className="text-ink-muted">
                <button className="text-left hover:text-ink" onClick={() => onOpenEntity(r.other.id)}>
                  {r.direction === 'out' ? (
                    <>
                      <span className="text-cyan">{EDGE_LABEL(r.type)}</span> →{' '}
                      <span className="text-ink underline decoration-line underline-offset-2">{r.other.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-ink underline decoration-line underline-offset-2">{r.other.name}</span>{' '}
                      <span className="text-cyan">{EDGE_LABEL(r.type)}</span> → this
                    </>
                  )}
                </button>
                <span className="text-ink-faint"> · {r.support_count} supporting claim(s)</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">No relationship is asserted by the evidence yet.</p>
        )}
      </div>
      {d.hypotheses.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">Relevant hypotheses</p>
          <ul className="space-y-1.5 text-xs">
            {d.hypotheses.map((h) => (
              <li key={h.id}>
                <Link to={`/app/investigations/${h.investigation_id}`} className="flex gap-1.5 text-ink-muted hover:text-ink">
                  <Lightbulb size={12} className="mt-0.5 shrink-0 text-violet" />
                  <span>
                    {h.statement}{' '}
                    <span className="text-ink-faint">
                      ({h.status.replace('_', ' ')}
                      {h.consensus ? `, ${h.consensus}` : ''})
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.investigations.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">Related investigations</p>
          <ul className="flex flex-wrap gap-1.5">
            {d.investigations.map((i) => (
              <li key={i.id}>
                <Link
                  to={`/app/investigations/${i.id}`}
                  className="rounded border border-line px-2 py-0.5 text-2xs text-ink-muted hover:border-cyan/40 hover:text-ink"
                >
                  {i.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Timeline workspaceId={workspaceId} entityId={d.id} />
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
                {c.source?.uri && (
                  <a href={c.source.uri} target="_blank" rel="noreferrer noopener" className="ml-1 text-cyan hover:underline">
                    open
                  </a>
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function mergeGraph(base: WorkspaceGraph, extra: { nodes: WorkspaceGraphNode[]; edges: WorkspaceGraphEdge[] }) {
  const nodes = new Map(base.nodes.map((n) => [n.key, n]));
  extra.nodes.forEach((n) => nodes.has(n.key) || nodes.set(n.key, n));
  const edges = new Map(base.edges.map((e) => [e.key, e]));
  extra.edges.forEach((e) => edges.has(e.key) || edges.set(e.key, e));
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** The knowledge graph as recorded by the backend (Neo4j, or the PostgreSQL registry when Neo4j isn't available). */
export function GraphExplorer({
  workspaceId,
  investigationId,
  investigationFilter,
  live,
  highlight,
  height = 520,
  emptyHint,
  initialEntityId,
}: GraphExplorerProps) {
  const [layer, setLayer] = useState<'entities' | 'claims'>('entities');
  const [view, setView] = useState<'3d' | 'list'>(() => (hasWebGL() ? '3d' : 'list'));
  const [scope, setScope] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hiddenRels, setHiddenRels] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<{ nodes: WorkspaceGraphNode[]; edges: WorkspaceGraphEdge[] }>({ nodes: [], edges: [] });
  const [command, setCommand] = useState<CameraCommand | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntityRow[]>([]);
  const [expanding, setExpanding] = useState(false);
  const [pending, setPending] = useState<string | null>(initialEntityId ?? null);
  const effectiveInv = investigationId ?? (scope || undefined);
  const graph = useWorkspaceGraph(workspaceId, { investigationId: effectiveInv, includeClaims: layer === 'claims', live });
  const invs = useInvestigations(investigationFilter ? workspaceId : null);
  const webgl = useMemo(() => hasWebGL(), []);

  const merged = useMemo(() => (graph.data ? mergeGraph(graph.data, extra) : { nodes: [], edges: [] }), [graph.data, extra]);
  const types = useMemo(() => [...new Set(merged.nodes.filter((n) => n.kind === 'entity').map((n) => n.entity_type ?? 'other'))].sort(), [merged]);
  const relTypes = useMemo(() => [...new Set(merged.edges.map((e) => e.type).filter((t) => t !== 'ABOUT'))].sort(), [merged]);
  const visible = useMemo(() => {
    const nodes = merged.nodes.filter((n) => n.kind !== 'entity' || !hiddenTypes.has(n.entity_type ?? 'other'));
    const keys = new Set(nodes.map((n) => n.key));
    const edges = merged.edges.filter((e) => !hiddenRels.has(e.type) && keys.has(e.source) && keys.has(e.target));
    const claimTargets = new Set(edges.filter((e) => e.type === 'ABOUT').map((e) => e.source));
    return { nodes: nodes.filter((n) => n.kind === 'entity' || claimTargets.has(n.key)), edges };
  }, [merged, hiddenTypes, hiddenRels]);
  const node = visible.nodes.find((n) => n.key === selected) ?? null;

  const focus = useCallback((key: string) => {
    setSelected(key);
    setCommand({ kind: 'focus', key, nonce: Date.now() });
  }, []);

  const expand = useCallback(
    async (entityId: string, depth = 1) => {
      setExpanding(true);
      try {
        const hood = await api.neighbourhood(workspaceId, entityId, depth);
        setExtra((x) => mergeGraph({ source: hood.source, fallback_reason: null, ...x }, hood));
        return hood.center;
      } finally {
        setExpanding(false);
      }
    },
    [workspaceId],
  );

  const openEntity = useCallback(
    async (entityId: string) => {
      const present = merged.nodes.find((n) => n.entity_id === entityId);
      const key = present ? present.key : await expand(entityId);
      window.setTimeout(() => focus(key), 60);
    },
    [merged, expand, focus],
  );

  // Deep link (?entity=…): select it once the graph has loaded, loading its neighbourhood if needed.
  useEffect(() => {
    if (!pending || !graph.data) return;
    setPending(null);
    void openEntity(pending);
  }, [pending, graph.data, openEntity]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      api.graphSearch(workspaceId, q).then(setResults, () => setResults([]));
    }, 220);
    return () => window.clearTimeout(t);
  }, [query, workspaceId]);

  if (graph.isPending)
    return (
      <div style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    );
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => graph.refetch()} />;
  const g = graph.data;
  const entityCount = visible.nodes.filter((n) => n.kind === 'entity').length;
  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  return (
    <div className="space-y-3" data-testid="graph-explorer">
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
        {webgl && (
          <Segmented
            label="Graph view"
            value={view}
            onChange={setView}
            options={[
              { value: '3d', label: '3D' },
              { value: 'list', label: 'List' },
            ]}
          />
        )}
        {investigationFilter && (
          <Select
            aria-label="Limit to an investigation"
            value={scope}
            onChange={(e) => (setScope(e.target.value), setExtra({ nodes: [], edges: [] }))}
            className="h-7 w-52 text-xs"
          >
            <option value="">Whole workspace</option>
            {invs.data?.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </Select>
        )}
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input
            aria-label="Search entities"
            placeholder="Find an entity"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-48 pl-6 text-xs"
          />
          {results.length > 0 && (
            <ul
              className="absolute z-20 mt-1 max-h-64 w-72 overflow-auto rounded-md border border-line bg-surface shadow-panel"
              role="listbox"
              aria-label="Search results"
            >
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-raised"
                    onClick={() => {
                      setQuery('');
                      setResults([]);
                      void openEntity(r.id);
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_COLOR[r.entity_type] ?? ENTITY_COLOR.other }} />
                    <span className="text-ink">{r.name}</span>
                    <span className="ml-auto text-2xs text-ink-faint">{r.claims} claims</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Badge tone={g.source === 'neo4j' ? 'live' : 'neutral'} title={g.fallback_reason ?? 'Read from Neo4j'}>
          {g.source === 'neo4j' ? <Share2 size={11} /> : <Database size={11} />} {g.source === 'neo4j' ? 'Neo4j' : 'PostgreSQL registry'}
        </Badge>
        <span className="text-2xs text-ink-faint">
          {entityCount} entities · {visible.edges.filter((e) => e.type !== 'ABOUT').length} relationships
          {layer === 'claims' && ` · ${visible.nodes.length - entityCount} claims`}
          {extra.nodes.length > 0 && ' · expanded'}
        </span>
      </div>
      {(types.length > 1 || relTypes.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => toggle(hiddenTypes, t, setHiddenTypes)}
              aria-pressed={!hiddenTypes.has(t)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs capitalize transition-colors',
                hiddenTypes.has(t) ? 'border-line text-ink-faint line-through' : 'border-line-strong text-ink-muted hover:text-ink',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ENTITY_COLOR[t] ?? ENTITY_COLOR.other }} /> {t}
            </button>
          ))}
          {relTypes.map((t) => (
            <button
              key={t}
              onClick={() => toggle(hiddenRels, t, setHiddenRels)}
              aria-pressed={!hiddenRels.has(t)}
              className={cn(
                'rounded-full border border-dashed px-2 py-0.5 text-2xs transition-colors',
                hiddenRels.has(t) ? 'border-line text-ink-faint line-through' : 'border-line-strong text-ink-muted hover:text-ink',
              )}
            >
              {EDGE_LABEL(t)}
            </button>
          ))}
        </div>
      )}
      {visible.nodes.length === 0 ? (
        <EmptyState
          icon={<Share2 size={18} />}
          title={g.nodes.length ? 'Everything is filtered out' : 'No knowledge recorded yet'}
          description={
            g.nodes.length
              ? 'Re-enable an entity type or relationship above.'
              : (emptyHint ?? 'Run an investigation over documents with readable text to build the graph.')
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="relative overflow-hidden rounded-lg border border-line bg-abyss" style={{ height }} data-testid="knowledge-graph">
            {view === '3d' && webgl ? (
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <KnowledgeGraph3D graph={visible} selectedKey={selected} onSelect={setSelected} highlight={highlight} command={command} />
              </Suspense>
            ) : (
              <GraphList nodes={visible.nodes} onSelect={focus} selected={selected} />
            )}
            {view === '3d' && webgl && (
              <>
                <div className="absolute right-2 top-2 flex flex-col gap-1" aria-label="Camera controls">
                  <Button
                    size="icon"
                    variant="secondary"
                    title="Reset camera"
                    aria-label="Reset camera"
                    onClick={() => setCommand({ kind: 'reset', nonce: Date.now() })}
                  >
                    <RotateCcw size={14} />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    title="Fit graph"
                    aria-label="Fit graph"
                    onClick={() => setCommand({ kind: 'fit', nonce: Date.now() })}
                  >
                    <Maximize2 size={14} />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    title="Focus selected node"
                    aria-label="Focus selected node"
                    disabled={!selected}
                    onClick={() => selected && setCommand({ kind: 'focus', key: selected, nonce: Date.now() })}
                  >
                    <Focus size={14} />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    title="Expand connections of the selected entity"
                    aria-label="Expand connections"
                    disabled={!node?.entity_id || expanding}
                    onClick={() => node?.entity_id && void expand(node.entity_id, 2)}
                  >
                    <Crosshair size={14} />
                  </Button>
                </div>
                <p className="pointer-events-none absolute bottom-2 left-3 right-3 text-2xs text-ink-faint">
                  Drag to orbit · scroll or pinch to zoom · right-drag to pan ·{' '}
                  {layer === 'claims' ? 'claims sit on the plane behind the entities they describe' : 'size = mentions; edge colour = relationship type'}
                </p>
              </>
            )}
          </div>
          <aside className="overflow-auto rounded-lg border border-line bg-surface/60" style={{ maxHeight: height }} aria-label="Selected node">
            {node ? (
              <Inspector
                workspaceId={workspaceId}
                node={node}
                onOpenEntity={(id) => void openEntity(id)}
                onExpand={() => node.entity_id && void expand(node.entity_id, 1)}
                expanding={expanding}
              />
            ) : (
              <p className="p-4 text-xs leading-relaxed text-ink-muted">
                Select a node, or search above, to see what the documents say about it, with quotes and sources.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
