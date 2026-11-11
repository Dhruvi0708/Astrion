import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import type { ClusterId, KnowledgeGraph } from '@/data/sample/graph';

export interface Point {
  x: number;
  y: number;
}

export interface GraphLayout {
  positions: Map<string, Point>;
  clusterCentres: Map<ClusterId, Point>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  cluster: ClusterId;
  weight: number;
}

/** Deterministic PRNG so the same graph always produces the same layout. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new WeakMap<KnowledgeGraph, GraphLayout>();

/**
 * Computes a static clustered force layout once (synchronously) and caches it per graph.
 * Rendering never runs the simulation per frame — this keeps interaction cheap.
 */
export function computeLayout(graph: KnowledgeGraph): GraphLayout {
  const hit = cache.get(graph);
  if (hit) return hit;

  const radius = 360;
  const clusterCentres = new Map<ClusterId, Point>();
  const ring = graph.clusters.filter((c) => c.id !== 'sources');
  ring.forEach((cluster, i) => {
    const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
    clusterCentres.set(cluster.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.78 });
  });
  // Sources sit at the centre: every claim traces back inward to its evidence.
  clusterCentres.set('sources', { x: 0, y: 0 });

  const random = mulberry32(7);
  const simNodes: SimNode[] = graph.nodes.map((node) => {
    const c = clusterCentres.get(node.cluster)!;
    return { id: node.id, cluster: node.cluster, weight: node.weight, x: c.x + (random() - 0.5) * 80, y: c.y + (random() - 0.5) * 80 };
  });
  const links = graph.edges.map((edge) => ({ source: edge.source, target: edge.target }));

  const sim = forceSimulation(simNodes)
    .randomSource(random)
    .force('charge', forceManyBody<SimNode>().strength(-260))
    .force(
      'link',
      forceLink<SimNode, { source: string; target: string }>(links)
        .id((d) => d.id)
        .distance(70)
        .strength(0.18),
    )
    .force('collide', forceCollide<SimNode>().radius((d) => 14 + d.weight * 4))
    .force('x', forceX<SimNode>((d) => clusterCentres.get(d.cluster)!.x).strength(0.22))
    .force('y', forceY<SimNode>((d) => clusterCentres.get(d.cluster)!.y).strength(0.22))
    .stop();

  for (let i = 0; i < 320; i++) sim.tick();

  const positions = new Map<string, Point>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of simNodes) {
    const p = { x: node.x ?? 0, y: node.y ?? 0 };
    positions.set(node.id, p);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  // Recompute cluster centres from actual node positions for label placement.
  for (const cluster of graph.clusters) {
    const members = simNodes.filter((node) => node.cluster === cluster.id);
    if (!members.length) continue;
    clusterCentres.set(cluster.id, {
      x: members.reduce((s, m) => s + (m.x ?? 0), 0) / members.length,
      y: members.reduce((s, m) => s + (m.y ?? 0), 0) / members.length,
    });
  }

  const layout = { positions, clusterCentres, bounds: { minX, minY, maxX, maxY } };
  cache.set(graph, layout);
  return layout;
}
