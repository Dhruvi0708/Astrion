import type { ClusterId, KnowledgeGraph } from '@/data/sample/graph';

export interface CoverageCell {
  cluster: ClusterId;
  sourceId: string;
  claims: number;
}

/**
 * Computes evidence coverage: for every (cluster, source) pair, how many claims cite that source and
 * touch a concept in that cluster. Zero cells are candidate knowledge gaps.
 * Works on any KnowledgeGraph — today it runs on the sample graph.
 */
export function computeCoverage(graph: KnowledgeGraph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const sources = graph.nodes.filter((n) => n.kind === 'source');
  const clusters = graph.clusters.filter((c) => c.id !== 'sources');
  const claimSources = new Map<string, Set<string>>();
  const claimClusters = new Map<string, Set<ClusterId>>();

  for (const e of graph.edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    if (e.kind === 'mentions' && a.kind === 'claim' && b.kind === 'source') {
      if (!claimSources.has(a.id)) claimSources.set(a.id, new Set());
      claimSources.get(a.id)!.add(b.id);
    }
    if (e.kind === 'supports' && a.kind === 'claim' && b.kind === 'concept') {
      if (!claimClusters.has(a.id)) claimClusters.set(a.id, new Set());
      claimClusters.get(a.id)!.add(b.cluster);
    }
  }

  const cells: CoverageCell[] = [];
  for (const c of clusters) {
    for (const s of sources) {
      let n = 0;
      for (const [claim, srcs] of claimSources) if (srcs.has(s.id) && claimClusters.get(claim)?.has(c.id)) n++;
      cells.push({ cluster: c.id, sourceId: s.id, claims: n });
    }
  }
  const clusterTotals = new Map(clusters.map((c) => [c.id, cells.filter((x) => x.cluster === c.id).reduce((s, x) => s + x.claims, 0)]));
  // Concepts with no supporting claim at all — the sharpest gaps.
  const supported = new Set(graph.edges.filter((e) => e.kind === 'supports').map((e) => e.target));
  const uncovered = graph.nodes.filter((n) => n.kind === 'concept' && !supported.has(n.id));
  return { sources, clusters, cells, clusterTotals, uncovered };
}
