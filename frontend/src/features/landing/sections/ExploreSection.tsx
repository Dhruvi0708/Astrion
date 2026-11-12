import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Maximize2, Minus, Plus } from 'lucide-react';
import { SampleBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { nodeById, sampleGraph, type ClusterId } from '@/data/sample/graph';
import { cn } from '@/lib/cn';
import { GraphCanvas, type GraphCanvasHandle } from '@/features/universe/graph/GraphCanvas';
import { GraphLegend } from '@/features/universe/components/GraphLegend';
import { NodeInspector } from '@/features/universe/components/NodeInspector';
import { SectionIntro } from '../components/SectionIntro';

export function ExploreSection() {
  const [selected, setSelected] = useState<string | null>('mangrove');
  const [cluster, setCluster] = useState<ClusterId | null>(null);
  const graphRef = useRef<GraphCanvasHandle>(null);
  const node = selected ? (nodeById.get(selected) ?? null) : null;

  const select = useCallback((id: string | null) => setSelected(id), []);
  const focusCluster = (id: ClusterId) => {
    setCluster(id);
    setSelected(null);
    graphRef.current?.focusCluster(id);
  };

  return (
    <section id="explore" aria-labelledby="explore-title" className="relative scroll-mt-16 border-t border-line/60 py-28 md:py-36">
      <div className="mx-auto max-w-[1240px] px-5 md:px-8">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <SectionIntro index="03" eyebrow="Explore the knowledge universe" title="Every concept, claim and source — connected." id="explore-title">
            <p>
              A live preview of the Universe Explorer. Drag to pan, scroll with Ctrl/⌘ (or focus the canvas) to zoom, and select any node to trace its
              relationships back to evidence.
            </p>
          </SectionIntro>
          <ButtonLink to="/app/universe" variant="outline" className="self-start lg:self-auto">
            Open full explorer <ArrowRight size={15} />
          </ButtonLink>
        </div>

        <div className="panel mt-12 overflow-hidden bg-deep/70">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <SampleBadge label="Sample graph · fictional data" />
            <div className="mx-1 hidden h-4 w-px bg-line sm:block" />
            <div className="flex flex-wrap gap-1" role="group" aria-label="Focus a cluster">
              {sampleGraph.clusters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => focusCluster(c.id)}
                  aria-pressed={cluster === c.id}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
                    cluster === c.id ? 'bg-raised text-ink' : 'text-ink-muted hover:bg-raised/60 hover:text-ink',
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="relative h-[460px] md:h-[560px]">
              <GraphCanvas
                ref={graphRef}
                graph={sampleGraph}
                selectedId={selected}
                onSelect={select}
                wheelZoom="modifier"
                ariaLabel="Sample knowledge graph preview"
              />
              <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-md border border-line bg-surface/90 backdrop-blur">
                <button aria-label="Zoom in" onClick={() => graphRef.current?.zoomIn()} className="p-2 text-ink-muted hover:bg-raised hover:text-ink">
                  <Plus size={14} />
                </button>
                <button
                  aria-label="Zoom out"
                  onClick={() => graphRef.current?.zoomOut()}
                  className="border-y border-line p-2 text-ink-muted hover:bg-raised hover:text-ink"
                >
                  <Minus size={14} />
                </button>
                <button
                  aria-label="Fit graph to view"
                  onClick={() => {
                    setCluster(null);
                    graphRef.current?.fit();
                  }}
                  className="p-2 text-ink-muted hover:bg-raised hover:text-ink"
                >
                  <Maximize2 size={13} />
                </button>
              </div>
              <div className="absolute bottom-3 right-3 hidden rounded-md border border-line bg-surface/90 p-3 backdrop-blur md:block">
                <GraphLegend relations={false} />
              </div>
            </div>
            <aside aria-label="Node inspector" className="h-[420px] border-t border-line bg-surface/60 lg:h-auto lg:border-l lg:border-t-0">
              <NodeInspector
                graph={sampleGraph}
                node={node}
                compact
                onSelect={(id) => {
                  setSelected(id);
                  graphRef.current?.focusNode(id);
                }}
                onClose={() => setSelected(null)}
              />
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
