import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { color } from '@/design/tokens';
import type { WorkspaceGraph, WorkspaceGraphNode } from '@/lib/api/types';

/**
 * Layout for the investigation knowledge graph.
 *
 * Depth carries meaning: entities sit on the front plane, and the claims that state something
 * about them sit on a plane behind (z = CLAIM_DEPTH). Rotating the view shows provenance: every
 * claim strand runs back from the entity it describes. x/y come from a deterministic force layout.
 */
export const CLAIM_DEPTH = -140;

export interface LaidOutNode {
  node: WorkspaceGraphNode;
  position: [number, number, number];
  radius: number;
  color: string;
}

export interface GraphLayout3D {
  nodes: LaidOutNode[];
  byKey: Map<string, LaidOutNode>;
  neighbours: Map<string, Set<string>>;
  radius: number;
}

export const ENTITY_COLOR: Record<string, string> = {
  concept: color.cyan,
  organization: color.violet,
  person: '#f5a3d0',
  location: color.verified,
  event: color.caution,
  metric: color.gap,
  method: '#c7d36b',
  artifact: '#e0a37a',
  other: color.inkMuted,
};

interface Sim extends SimulationNodeDatum {
  key: string;
  weight: number;
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function layoutGraph(graph: Pick<WorkspaceGraph, 'nodes' | 'edges'>): GraphLayout3D {
  const random = seeded(11);
  const keys = new Set(graph.nodes.map((n) => n.key));
  const edges = graph.edges.filter((e) => keys.has(e.source) && keys.has(e.target) && e.source !== e.target);
  const sims: Sim[] = graph.nodes.map((n) => ({
    key: n.key,
    weight: n.kind === 'entity' ? Math.min(6, 1 + (n.mention_count ?? 1)) : 0.6,
    x: (random() - 0.5) * 300,
    y: (random() - 0.5) * 300,
  }));
  forceSimulation(sims)
    .randomSource(random)
    .force(
      'charge',
      forceManyBody<Sim>().strength((d) => -90 - d.weight * 30),
    )
    .force(
      'link',
      forceLink<Sim, { source: string; target: string; type: string }>(edges.map((e) => ({ source: e.source, target: e.target, type: e.type })))
        .id((d) => d.key)
        .distance((l) => (l.type === 'ABOUT' ? 30 : 90))
        .strength(0.35),
    )
    .force(
      'collide',
      forceCollide<Sim>().radius((d) => 8 + d.weight * 3),
    )
    .force('x', forceX<Sim>(0).strength(0.04))
    .force('y', forceY<Sim>(0).strength(0.04))
    .stop()
    .tick(260);

  const neighbours = new Map<string, Set<string>>();
  for (const n of graph.nodes) neighbours.set(n.key, new Set());
  for (const e of edges) {
    neighbours.get(e.source)!.add(e.target);
    neighbours.get(e.target)!.add(e.source);
  }

  let extent = 1;
  const nodes = graph.nodes.map((n, i) => {
    const s = sims[i];
    const x = s.x ?? 0;
    const y = s.y ?? 0;
    extent = Math.max(extent, Math.abs(x), Math.abs(y));
    return {
      node: n,
      position: [x, y, n.kind === 'claim' ? CLAIM_DEPTH : 0] as [number, number, number],
      radius: n.kind === 'entity' ? 4 + Math.sqrt(s.weight) * 2.6 : 2.2,
      color: n.kind === 'entity' ? (ENTITY_COLOR[n.entity_type ?? 'other'] ?? ENTITY_COLOR.other) : n.claim_kind === 'inferred' ? color.caution : color.ink,
    };
  });
  return { nodes, byKey: new Map(nodes.map((n) => [n.node.key, n])), neighbours, radius: extent };
}
