import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  clusterById,
  RELATION_COLOR,
  type ClusterId,
  type GraphEdge,
  type GraphNode,
  type KnowledgeGraph,
  type NodeKind,
  type RelationKind,
} from '@/data/sample/graph';
import { color } from '@/design/tokens';
import { cn } from '@/lib/cn';
import { computeLayout, type Point } from './layout';

export type LabelMode = 'auto' | 'all' | 'none';

export interface GraphCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  focusNode: (id: string) => void;
  focusCluster: (id: ClusterId) => void;
}

export interface GraphCanvasProps {
  graph: KnowledgeGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hiddenKinds?: ReadonlySet<NodeKind>;
  hiddenRelations?: ReadonlySet<RelationKind>;
  hiddenClusters?: ReadonlySet<ClusterId>;
  /** Highlights nodes whose label matches; non-matches are dimmed. */
  query?: string;
  labels?: LabelMode;
  /**
   * `always` zooms on every wheel event (full-screen explorer).
   * `modifier` only zooms with Ctrl/⌘ or while the canvas has focus, so page scrolling is never hijacked.
   */
  wheelZoom?: 'always' | 'modifier';
  className?: string;
  ariaLabel?: string;
}

interface Camera {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.25;
const MAX_K = 4;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function nodeRadius(node: GraphNode) {
  return 3.5 + node.weight * 1.7;
}

function hexToRgba(hex: string, alpha: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

/**
 * Canvas 2D knowledge-graph renderer with pan, zoom, selection and keyboard control.
 * Camera state lives in refs and drawing happens in requestAnimationFrame — React re-renders only
 * when props change, never per frame.
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
    graph,
    selectedId,
    onSelect,
    hiddenKinds,
    hiddenRelations,
    hiddenClusters,
    query = '',
    labels = 'auto',
    wheelZoom = 'always',
    className,
    ariaLabel = 'Interactive knowledge graph',
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => computeLayout(graph), [graph]);

  const cam = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const target = useRef<Camera | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const hover = useRef<string | null>(null);
  const visible = useRef(true);
  const raf = useRef<number | null>(null);
  const focused = useRef(false);
  const reduced = useRef(prefersReducedMotion());

  // Latest render inputs kept in a ref so the draw loop never closes over stale props.
  const state = useRef({ selectedId, hiddenKinds, hiddenRelations, hiddenClusters, query, labels });
  state.current = { selectedId, hiddenKinds, hiddenRelations, hiddenClusters, query, labels };

  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const isNodeVisible = useCallback((node: GraphNode) => {
    const s = state.current;
    return !s.hiddenKinds?.has(node.kind) && !s.hiddenClusters?.has(node.cluster);
  }, []);

  const toScreen = (p: Point): Point => {
    const c = cam.current;
    return { x: (p.x - c.x) * c.k + size.current.w / 2, y: (p.y - c.y) * c.k + size.current.h / 2 };
  };
  const toWorld = (sx: number, sy: number): Point => {
    const c = cam.current;
    return { x: (sx - size.current.w / 2) / c.k + c.x, y: (sy - size.current.h / 2) / c.k + c.y };
  };

  const draw = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { w, h, dpr } = size.current;
      const s = state.current;
      const k = cam.current.k;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const selected = s.selectedId ? (nodeMap.get(s.selectedId) ?? null) : null;
      const neighbourhood = new Set<string>();
      if (selected) {
        neighbourhood.add(selected.id);
        for (const edge of graph.edges) {
          if (edge.source === selected.id) neighbourhood.add(edge.target);
          if (edge.target === selected.id) neighbourhood.add(edge.source);
        }
      }
      const q = s.query.trim().toLowerCase();
      const matches = (node: GraphNode) => !q || node.label.toLowerCase().includes(q);

      // Cluster atmospheres
      for (const cluster of graph.clusters) {
        if (s.hiddenClusters?.has(cluster.id)) continue;
        const centre = layout.clusterCentres.get(cluster.id);
        if (!centre) continue;
        const p = toScreen(centre);
        const r = 170 * k;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grad.addColorStop(0, hexToRgba(cluster.color, selected ? 0.025 : 0.06));
        grad.addColorStop(1, hexToRgba(cluster.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Edges
      const incident: GraphEdge[] = [];
      for (const edge of graph.edges) {
        if (s.hiddenRelations?.has(edge.kind)) continue;
        const a = nodeMap.get(edge.source);
        const b = nodeMap.get(edge.target);
        if (!a || !b || !isNodeVisible(a) || !isNodeVisible(b)) continue;
        const pa = toScreen(layout.positions.get(a.id)!);
        const pb = toScreen(layout.positions.get(b.id)!);
        const isIncident = selected && (edge.source === selected.id || edge.target === selected.id);
        if (isIncident) incident.push(edge);
        const dimmed = (selected && !isIncident) || (q && !(matches(a) || matches(b)));
        const base = RELATION_COLOR[edge.kind];
        ctx.strokeStyle = hexToRgba(base, isIncident ? 0.85 : dimmed ? 0.05 : 0.2 + edge.confidence * 0.15);
        ctx.lineWidth = isIncident ? 1.6 : 1;
        ctx.setLineDash(edge.kind === 'contradicts' ? [5, 4] : edge.kind === 'hypothesized' ? [2, 4] : []);
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const cx = mx - dy * 0.08;
        const cy = my + dx * 0.08;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo(cx, cy, pb.x, pb.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Signal pulses travelling along the selected node's relationships
      if (selected && incident.length) {
        const t0 = reduced.current ? 0.5 : time * 0.00035;
        incident.forEach((edge, i) => {
          const pa = toScreen(layout.positions.get(edge.source)!);
          const pb = toScreen(layout.positions.get(edge.target)!);
          const t = (t0 + i * 0.37) % 1;
          const mx = (pa.x + pb.x) / 2;
          const my = (pa.y + pb.y) / 2;
          const cx = mx - (pb.y - pa.y) * 0.08;
          const cy = my + (pb.x - pa.x) * 0.08;
          const u = 1 - t;
          const x = u * u * pa.x + 2 * u * t * cx + t * t * pb.x;
          const y = u * u * pa.y + 2 * u * t * cy + t * t * pb.y;
          ctx.fillStyle = hexToRgba(RELATION_COLOR[edge.kind], 0.95);
          ctx.shadowColor = RELATION_COLOR[edge.kind];
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      }

      // Nodes
      const labelQueue: { node: GraphNode; p: Point; r: number; strong: boolean }[] = [];
      const scale = Math.max(0.65, Math.min(1.8, Math.sqrt(k)));
      for (const node of graph.nodes) {
        if (!isNodeVisible(node)) continue;
        const p = toScreen(layout.positions.get(node.id)!);
        if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
        const r = nodeRadius(node) * scale;
        const cluster = clusterById[node.cluster];
        const tint = node.kind === 'hypothesis' ? color.violet : node.kind === 'claim' ? color.ink : cluster.color;
        const inFocus = (!selected || neighbourhood.has(node.id)) && matches(node);
        const alpha = inFocus ? 1 : 0.16;
        const isSel = selected?.id === node.id;
        const isHover = hover.current === node.id;

        if (inFocus && (isSel || isHover || node.weight >= 5)) {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
          g.addColorStop(0, hexToRgba(tint, isSel ? 0.35 : 0.16));
          g.addColorStop(1, hexToRgba(tint, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.2;
        switch (node.kind) {
          case 'concept':
            ctx.fillStyle = hexToRgba(tint, 0.9);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = hexToRgba(color.void, 0.55);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 0.38, 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'claim':
            ctx.fillStyle = color.deep;
            ctx.strokeStyle = hexToRgba(tint, 0.9);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - r);
            ctx.lineTo(p.x + r, p.y);
            ctx.lineTo(p.x, p.y + r);
            ctx.lineTo(p.x - r, p.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            break;
          case 'source': {
            const sz = r * 0.85;
            ctx.fillStyle = color.deep;
            ctx.strokeStyle = hexToRgba(tint, 0.85);
            ctx.fillRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
            ctx.strokeRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
            ctx.fillStyle = hexToRgba(tint, 0.6);
            ctx.fillRect(p.x - sz * 0.5, p.y - sz * 0.35, sz, 1.2);
            ctx.fillRect(p.x - sz * 0.5, p.y + sz * 0.1, sz * 0.7, 1.2);
            break;
          }
          case 'hypothesis':
            ctx.fillStyle = hexToRgba(color.violet, 0.14);
            ctx.strokeStyle = hexToRgba(color.violet, 0.95);
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);
            break;
        }

        if (isSel || isHover) {
          ctx.strokeStyle = isSel ? color.cyan : hexToRgba(color.ink, 0.6);
          ctx.lineWidth = isSel ? 1.8 : 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        const showLabel =
          s.labels === 'all' ||
          (s.labels === 'auto' && (isSel || isHover || (selected ? neighbourhood.has(node.id) : node.weight >= 4 || k > 1.35) || (q && matches(node))));
        if (s.labels !== 'none' && showLabel && inFocus) labelQueue.push({ node, p, r, strong: isSel || isHover });
      }

      // Labels last, so they sit above every node
      ctx.textBaseline = 'middle';
      for (const { node, p, r, strong } of labelQueue) {
        ctx.font = `${strong ? 600 : 500} ${strong ? 12.5 : 11.5}px "Inter Variable", Inter, system-ui, sans-serif`;
        const text = node.label;
        const tw = ctx.measureText(text).width;
        const x = p.x + r + 7;
        ctx.fillStyle = hexToRgba(color.void, 0.72);
        ctx.fillRect(x - 3, p.y - 8, tw + 6, 16);
        ctx.fillStyle = strong ? color.ink : hexToRgba(color.ink, 0.78);
        ctx.fillText(text, x, p.y + 0.5);
      }

      // Cluster titles at overview zoom
      if (s.labels !== 'none' && k < 1.35 && !selected) {
        ctx.font = '600 10.5px "Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif';
        ctx.textAlign = 'center';
        for (const cluster of graph.clusters) {
          if (s.hiddenClusters?.has(cluster.id) || cluster.id === 'sources') continue;
          const centre = layout.clusterCentres.get(cluster.id);
          if (!centre) continue;
          const p = toScreen({ x: centre.x, y: centre.y - 120 });
          ctx.fillStyle = hexToRgba(cluster.color, 0.7);
          ctx.fillText(cluster.label.toUpperCase().split('').join(' '), p.x, p.y);
        }
        ctx.textAlign = 'start';
      }
    },
    [graph, layout, nodeMap, isNodeVisible],
  );

  const loop = useCallback(
    (time: number) => {
      raf.current = null;
      if (!visible.current) return;
      let animating = false;
      const t = target.current;
      if (t) {
        const c = cam.current;
        const f = reduced.current ? 1 : 0.16;
        c.x += (t.x - c.x) * f;
        c.y += (t.y - c.y) * f;
        c.k += (t.k - c.k) * f;
        if (Math.abs(t.x - c.x) < 0.1 && Math.abs(t.y - c.y) < 0.1 && Math.abs(t.k - c.k) < 0.001) {
          cam.current = { ...t };
          target.current = null;
        } else animating = true;
      }
      draw(time);
      if (animating || (state.current.selectedId && !reduced.current)) {
        raf.current = requestAnimationFrame(loop);
      }
    },
    [draw],
  );

  const invalidate = useCallback(() => {
    if (raf.current === null && visible.current) raf.current = requestAnimationFrame(loop);
  }, [loop]);

  const fitTo = useCallback(
    (ids: string[] | null, immediate = false) => {
      const { w, h } = size.current;
      if (!w || !h) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of graph.nodes) {
        if (ids ? !ids.includes(node.id) : !isNodeVisible(node)) continue;
        const p = layout.positions.get(node.id)!;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if (!Number.isFinite(minX)) return;
      const pad = 64;
      const k = clampK(Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2), ids && ids.length === 1 ? 1.8 : 2.2));
      const next = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k };
      if (immediate) {
        cam.current = next;
        target.current = null;
      } else target.current = next;
      invalidate();
    },
    [graph, layout, isNodeVisible, invalidate],
  );

  const zoomBy = useCallback(
    (factor: number, anchor?: Point) => {
      const c = target.current ?? cam.current;
      const k = clampK(c.k * factor);
      let { x, y } = c;
      if (anchor) {
        // Keep the world point under the cursor fixed while zooming.
        const world = toWorld(anchor.x, anchor.y);
        x = world.x - (anchor.x - size.current.w / 2) / k;
        y = world.y - (anchor.y - size.current.h / 2) / k;
        cam.current = { x, y, k };
        target.current = null;
      } else target.current = { x, y, k };
      invalidate();
    },

    [invalidate],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(1.3),
      zoomOut: () => zoomBy(1 / 1.3),
      fit: () => fitTo(null),
      focusNode: (id: string) => {
        const ids = [id, ...graph.edges.filter((e) => e.source === id || e.target === id).map((e) => (e.source === id ? e.target : e.source))];
        fitTo(ids);
      },
      focusCluster: (id: ClusterId) => fitTo(graph.nodes.filter((n) => n.cluster === id).map((n) => n.id)),
    }),
    [zoomBy, fitTo, graph],
  );

  // Size management
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let first = true;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: width, h: height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (first && width > 0) {
        first = false;
        // A focus request may already be pending (deep link); don't override it.
        if (!target.current) fitTo(null, true);
      }
      invalidate();
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (entry.isIntersecting) invalidate();
    });
    io.observe(wrap);
    return () => {
      ro.disconnect();
      io.disconnect();
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [fitTo, invalidate]);

  // Redraw whenever render inputs change
  useEffect(() => {
    invalidate();
  }, [selectedId, hiddenKinds, hiddenRelations, hiddenClusters, query, labels, invalidate]);

  // Pointer interaction: pan, pinch, hover, click-to-select
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, Point>();
    let downAt: Point | null = null;
    let moved = false;
    let pinchDist = 0;

    const local = (e: PointerEvent | WheelEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const hitTest = (p: Point): string | null => {
      let best: string | null = null;
      let bestD = Infinity;
      const scale = Math.max(0.65, Math.min(1.8, Math.sqrt(cam.current.k)));
      for (const node of graph.nodes) {
        if (!isNodeVisible(node)) continue;
        const sp = toScreen(layout.positions.get(node.id)!);
        const d = Math.hypot(sp.x - p.x, sp.y - p.y);
        if (d < nodeRadius(node) * scale + 6 && d < bestD) {
          best = node.id;
          bestD = d;
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      downAt = p;
      moved = false;
      target.current = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const h = hitTest(p);
        if (h !== hover.current) {
          hover.current = h;
          canvas.style.cursor = h ? 'pointer' : 'grab';
          invalidate();
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomBy(d / pinchDist, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        pinchDist = d;
        moved = true;
        return;
      }
      if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 3) moved = true;
      if (moved) {
        canvas.style.cursor = 'grabbing';
        cam.current.x -= (p.x - prev.x) / cam.current.k;
        cam.current.y -= (p.y - prev.y) / cam.current.k;
        invalidate();
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      canvas.style.cursor = hover.current ? 'pointer' : 'grab';
      if (wasSingle && !moved) onSelect(hitTest(local(e)));
    };
    const onLeave = () => {
      if (hover.current) {
        hover.current = null;
        invalidate();
      }
    };
    const onWheel = (e: WheelEvent) => {
      const allowed = wheelZoom === 'always' || e.ctrlKey || e.metaKey || focused.current;
      if (!allowed) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015), local(e));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [graph, layout, onSelect, wheelZoom, zoomBy, invalidate, isNodeVisible]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60 / cam.current.k;
    const keys: Record<string, () => void> = {
      '+': () => zoomBy(1.25),
      '=': () => zoomBy(1.25),
      '-': () => zoomBy(1 / 1.25),
      '0': () => fitTo(null),
      ArrowLeft: () => (cam.current.x -= step),
      ArrowRight: () => (cam.current.x += step),
      ArrowUp: () => (cam.current.y -= step),
      ArrowDown: () => (cam.current.y += step),
      Escape: () => onSelect(null),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
      invalidate();
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative h-full w-full overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${ariaLabel}. Drag to pan, scroll or use plus and minus keys to zoom, arrow keys to move, 0 to fit, Escape to clear selection.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => (focused.current = true)}
        onBlur={() => (focused.current = false)}
        className="block h-full w-full cursor-grab touch-none select-none focus-visible:outline-none"
      />
    </div>
  );
});
