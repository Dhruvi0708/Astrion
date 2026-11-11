import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, Layers, Maximize2, Minus, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { SampleBadge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Form';
import { Segmented } from '@/components/ui/Segmented';
import {
  clusterById,
  graphStats,
  NODE_KIND_LABEL,
  nodeById,
  RELATION_COLOR,
  RELATION_LABEL,
  sampleGraph,
  type ClusterId,
  type NodeKind,
  type RelationKind,
} from '@/data/sample/graph';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import { usePreferences } from '@/stores/ui';
import { GraphLegend } from './components/GraphLegend';
import { NodeInspector } from './components/NodeInspector';
import { GraphCanvas, type GraphCanvasHandle } from './graph/GraphCanvas';

const KINDS: NodeKind[] = ['concept', 'claim', 'source', 'hypothesis'];
const RELATIONS: RelationKind[] = ['influences', 'correlates', 'part_of', 'supports', 'contradicts', 'mentions', 'hypothesized'];

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function CheckRow({ checked, onChange, label, swatch, count }: { checked: boolean; onChange: () => void; label: string; swatch?: React.ReactNode; count?: number }) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2.5 rounded px-1.5 text-xs text-ink-muted hover:bg-raised/50 hover:text-ink">
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span aria-hidden className="grid h-3.5 w-3.5 place-items-center rounded-[3px] border border-line-strong peer-checked:border-cyan/70 peer-checked:bg-cyan/15 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan/40">
        {checked && <span className="h-1.5 w-1.5 rounded-[1px] bg-cyan" />}
      </span>
      {swatch}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="font-mono text-2xs text-ink-faint">{count}</span>}
    </label>
  );
}

export default function UniverseExplorerPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('node');
  const graphRef = useRef<GraphCanvasHandle>(null);
  const [query, setQuery] = useState('');
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<NodeKind>>(new Set());
  const [hiddenRelations, setHiddenRelations] = useState<ReadonlySet<RelationKind>>(new Set());
  const [hiddenClusters, setHiddenClusters] = useState<ReadonlySet<ClusterId>>(new Set());
  const labels = usePreferences((s) => s.graphLabels);
  const setLabels = usePreferences((s) => s.setGraphLabels);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const wide = useMediaQuery('(min-width: 1280px)');
  const stats = useMemo(() => graphStats(sampleGraph), []);

  useEffect(() => {
    document.title = 'Universe Explorer · ASTRION';
  }, []);

  const select = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('node', id);
          else next.delete('node');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Deep links (?node=...) focus the node once the canvas has sized itself.
  const focusedFromUrl = useRef(false);
  useEffect(() => {
    if (selectedId && !focusedFromUrl.current && nodeById.has(selectedId)) {
      // Flag is set inside the timer so StrictMode's double-invoked effect still focuses once.
      const t = window.setTimeout(() => {
        focusedFromUrl.current = true;
        graphRef.current?.focusNode(selectedId);
      }, 260);
      return () => window.clearTimeout(t);
    }
  }, [selectedId]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sampleGraph.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [query]);

  const selectAndFocus = (id: string) => {
    select(id);
    graphRef.current?.focusNode(id);
  };

  const filtersActive = hiddenKinds.size + hiddenRelations.size + hiddenClusters.size;

  const filterPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <label htmlFor="universe-search" className="sr-only">
          Search nodes
        </label>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input id="universe-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the graph…" className="h-8 pl-8 text-xs" autoComplete="off" />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
              <X size={13} />
            </button>
          )}
        </div>
        {query && (
          <ul className="space-y-0.5" aria-label="Search results">
            {results.length === 0 && <li className="px-1.5 py-1 text-xs text-ink-faint">No nodes match.</li>}
            {results.map((n) => (
              <li key={n.id}>
                <button onClick={() => selectAndFocus(n.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-ink-muted hover:bg-raised hover:text-ink">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: clusterById[n.cluster].color }} />
                  <span className="flex-1 truncate">{n.label}</span>
                  <span className="text-2xs text-ink-faint">{NODE_KIND_LABEL[n.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between px-1.5">
            <p className="eyebrow">Clusters</p>
          </div>
          <ul>
            {sampleGraph.clusters.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button onClick={() => graphRef.current?.focusCluster(c.id)} className="flex h-7 flex-1 items-center gap-2.5 rounded px-1.5 text-left text-xs text-ink-muted hover:bg-raised/50 hover:text-ink" title={`Focus ${c.label}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color, opacity: hiddenClusters.has(c.id) ? 0.3 : 1 }} />
                  <span className={cn('flex-1 truncate', hiddenClusters.has(c.id) && 'line-through opacity-50')}>{c.label}</span>
                  <span className="font-mono text-2xs text-ink-faint">{sampleGraph.nodes.filter((n) => n.cluster === c.id).length}</span>
                </button>
                <button
                  onClick={() => setHiddenClusters((s) => toggle(s, c.id))}
                  aria-label={`${hiddenClusters.has(c.id) ? 'Show' : 'Hide'} ${c.label}`}
                  aria-pressed={!hiddenClusters.has(c.id)}
                  className="ml-0.5 rounded p-1 text-ink-faint hover:bg-raised hover:text-ink"
                >
                  {hiddenClusters.has(c.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <fieldset>
          <legend className="eyebrow mb-1.5 px-1.5">Node types</legend>
          {KINDS.map((k) => (
            <CheckRow key={k} checked={!hiddenKinds.has(k)} onChange={() => setHiddenKinds((s) => toggle(s, k))} label={NODE_KIND_LABEL[k]} count={stats.byKind[k]} />
          ))}
        </fieldset>
        <fieldset>
          <legend className="eyebrow mb-1.5 px-1.5">Relationships</legend>
          {RELATIONS.map((r) => (
            <CheckRow
              key={r}
              checked={!hiddenRelations.has(r)}
              onChange={() => setHiddenRelations((s) => toggle(s, r))}
              label={RELATION_LABEL[r]}
              count={stats.byRelation[r] ?? 0}
              swatch={<span aria-hidden className="h-0.5 w-3 rounded" style={{ background: RELATION_COLOR[r] }} />}
            />
          ))}
        </fieldset>
        {filtersActive > 0 && (
          <button
            onClick={() => {
              setHiddenKinds(new Set());
              setHiddenRelations(new Set());
              setHiddenClusters(new Set());
            }}
            className="px-1.5 text-xs text-cyan hover:underline"
          >
            Reset {filtersActive} filter{filtersActive > 1 ? 's' : ''}
          </button>
        )}
      </div>
      <div className="border-t border-line p-3 text-2xs leading-relaxed text-ink-faint">
        {stats.nodes} nodes · {stats.edges} relationships · {stats.clusters} clusters. Sample graph for demonstration — live graphs will load from Neo4j.
      </div>
    </div>
  );

  return (
    <div className="relative flex h-[calc(100dvh-52px)] min-h-[520px]">
      <h1 className="sr-only">Universe Explorer</h1>
      {/* Filters: docked on wide screens, drawer otherwise */}
      {wide ? (
        <aside aria-label="Search and filters" className="w-[268px] shrink-0 border-r border-line bg-abyss">
          {filterPanel}
        </aside>
      ) : (
        <AnimatePresence>
          {filtersOpen && (
            <motion.aside
              aria-label="Search and filters"
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="absolute inset-y-0 left-0 z-20 w-[280px] border-r border-line bg-abyss shadow-panel"
            >
              <button aria-label="Close filters" onClick={() => setFiltersOpen(false)} className="absolute right-2 top-2 z-10 rounded p-1 text-ink-faint hover:bg-raised">
                <X size={14} />
              </button>
              <div className="h-full pt-6">{filterPanel}</div>
            </motion.aside>
          )}
        </AnimatePresence>
      )}

      {/* Canvas */}
      <section aria-label="Knowledge graph canvas" className="relative min-w-0 flex-1 bg-deep">
        <div aria-hidden className="hairline-grid pointer-events-none absolute inset-0 opacity-25" />
        <GraphCanvas
          ref={graphRef}
          graph={sampleGraph}
          selectedId={selectedId}
          onSelect={select}
          hiddenKinds={hiddenKinds}
          hiddenRelations={hiddenRelations}
          hiddenClusters={hiddenClusters}
          query={query}
          labels={labels}
          wheelZoom="always"
          ariaLabel="Universe Explorer knowledge graph"
        />

        {/* Top toolbar */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex items-center gap-2">
            {!wide && (
              <button onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface/90 px-2.5 text-xs text-ink-muted backdrop-blur hover:text-ink">
                <SlidersHorizontal size={13} /> Filters
                {filtersActive > 0 && <span className="rounded bg-cyan/15 px-1 font-mono text-2xs text-cyan">{filtersActive}</span>}
              </button>
            )}
            <div className="rounded-md border border-line bg-surface/90 px-2 py-1 backdrop-blur">
              <SampleBadge label="Sample graph" />
            </div>
          </div>
          <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-surface/90 p-1 backdrop-blur">
            <span className="hidden pl-1.5 text-2xs uppercase tracking-[0.12em] text-ink-faint sm:inline">Labels</span>
            <Segmented
              label="Label density"
              value={labels}
              onChange={setLabels}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'all', label: 'All' },
                { value: 'none', label: 'None' },
              ]}
            />
            <button onClick={() => setLegendOpen((v) => !v)} aria-pressed={legendOpen} aria-label="Toggle legend" className={cn('rounded p-1.5', legendOpen ? 'text-cyan' : 'text-ink-faint hover:text-ink')}>
              <Layers size={14} />
            </button>
          </div>
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-md border border-line bg-surface/90 backdrop-blur">
          <button aria-label="Zoom in" onClick={() => graphRef.current?.zoomIn()} className="p-2 text-ink-muted hover:bg-raised hover:text-ink">
            <Plus size={15} />
          </button>
          <button aria-label="Zoom out" onClick={() => graphRef.current?.zoomOut()} className="border-y border-line p-2 text-ink-muted hover:bg-raised hover:text-ink">
            <Minus size={15} />
          </button>
          <button aria-label="Fit graph to view" onClick={() => graphRef.current?.fit()} className="p-2 text-ink-muted hover:bg-raised hover:text-ink">
            <Maximize2 size={14} />
          </button>
        </div>

        <AnimatePresence>
          {legendOpen && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="absolute bottom-3 left-16 hidden w-[300px] rounded-md border border-line bg-surface/90 p-3 backdrop-blur md:block">
              <GraphLegend />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inspector: bottom sheet on small screens */}
        <AnimatePresence>
          {!wide && selectedNode && (
            <motion.aside
              aria-label="Node inspector"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              className="absolute inset-x-3 bottom-3 z-10 max-h-[55%] overflow-hidden rounded-lg border border-line bg-surface shadow-panel md:left-auto md:right-3 md:w-[340px]"
            >
              <NodeInspector graph={sampleGraph} node={selectedNode} onSelect={selectAndFocus} onClose={() => select(null)} />
            </motion.aside>
          )}
        </AnimatePresence>
      </section>

      {wide && (
        <aside aria-label="Node inspector" className="w-[320px] shrink-0 border-l border-line bg-abyss">
          <NodeInspector graph={sampleGraph} node={selectedNode} onSelect={selectAndFocus} onClose={() => select(null)} />
        </aside>
      )}
    </div>
  );
}
