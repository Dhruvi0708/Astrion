/**
 * SAMPLE KNOWLEDGE GRAPH — illustrative data only.
 *
 * This fictional "Coastal Resilience" workspace exists to demonstrate how ASTRION will present
 * a knowledge graph. Sources are invented, claims are hypothetical examples, and confidence
 * values are placeholders. Nothing here is a research finding. Real graphs will be produced by
 * the extraction pipeline (planned) and stored in Neo4j.
 */
import { color } from '@/design/tokens';

export type NodeKind = 'concept' | 'claim' | 'source' | 'hypothesis';
export type RelationKind = 'influences' | 'correlates' | 'part_of' | 'supports' | 'contradicts' | 'mentions' | 'hypothesized';
export type ClusterId = 'climate' | 'marine' | 'infrastructure' | 'community' | 'policy' | 'sources';

export interface GraphCluster {
  id: ClusterId;
  label: string;
  color: string;
  description: string;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  cluster: ClusterId;
  summary: string;
  /** Relative prominence 1–5, drives node size. */
  weight: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  /** Placeholder confidence 0–1 (sample value, not computed). */
  confidence: number;
  /** Number of sample evidence items attached to this relationship. */
  evidence: number;
}

export interface KnowledgeGraph {
  name: string;
  isSample: true;
  clusters: GraphCluster[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  concept: 'Concept',
  claim: 'Claim',
  source: 'Source',
  hypothesis: 'Hypothesis',
};

export const RELATION_LABEL: Record<RelationKind, string> = {
  influences: 'Influences',
  correlates: 'Correlates with',
  part_of: 'Part of',
  supports: 'Supports',
  contradicts: 'Contradicts',
  mentions: 'Mentioned in',
  hypothesized: 'Hypothesized link',
};

export const RELATION_COLOR: Record<RelationKind, string> = {
  influences: color.cyan,
  correlates: color.gap,
  part_of: color.inkFaint,
  supports: color.verified,
  contradicts: color.conflict,
  mentions: color.inkFaint,
  hypothesized: color.violet,
};

const clusters: GraphCluster[] = [
  { id: 'climate', label: 'Climate Drivers', color: '#4fe3f0', description: 'Physical drivers acting on the coastline.' },
  { id: 'marine', label: 'Marine Ecosystems', color: '#5ee0a5', description: 'Living systems that buffer and respond to change.' },
  { id: 'infrastructure', label: 'Coastal Infrastructure', color: '#7aa2ff', description: 'Built and nature-based defenses, exposure and risk.' },
  { id: 'community', label: 'Communities & Health', color: '#9d8cff', description: 'People, livelihoods and wellbeing.' },
  { id: 'policy', label: 'Policy & Economics', color: '#f0ba68', description: 'Decisions, funding and governance instruments.' },
  { id: 'sources', label: 'Sample Sources', color: '#c9d3e3', description: 'Fictional documents that sample claims cite.' },
];

const n = (id: string, label: string, cluster: ClusterId, summary: string, weight = 2, kind: NodeKind = 'concept'): GraphNode => ({
  id,
  label,
  kind,
  cluster,
  summary,
  weight,
});

const nodes: GraphNode[] = [
  // Climate drivers
  n('sst', 'Sea-surface temperature', 'climate', 'Temperature of the upper ocean layer; a primary driver of thermal stress.', 5),
  n('slr', 'Sea-level rise', 'climate', 'Long-term increase in mean sea level, raising baseline exposure.', 4),
  n('storms', 'Storm intensity', 'climate', 'Strength and frequency of coastal storms.', 4),
  n('surge', 'Storm surge', 'climate', 'Temporary rise in water level driven by storms.', 3),
  n('acid', 'Ocean acidification', 'climate', 'Decline in seawater pH from absorbed CO₂.', 3),
  n('heatwave', 'Marine heatwaves', 'climate', 'Prolonged periods of anomalously warm water.', 3),
  n('precip', 'Extreme rainfall', 'climate', 'High-intensity precipitation events feeding runoff.', 2),

  // Marine ecosystems
  n('reef', 'Coral reefs', 'marine', 'Reef structures that dissipate wave energy and host biodiversity.', 5),
  n('bleach', 'Coral bleaching', 'marine', 'Expulsion of symbiotic algae under stress.', 4),
  n('seagrass', 'Seagrass meadows', 'marine', 'Underwater meadows that stabilise sediment and store carbon.', 4),
  n('mangrove', 'Mangrove forests', 'marine', 'Intertidal forests that attenuate waves and trap sediment.', 5),
  n('marsh', 'Salt marshes', 'marine', 'Vegetated tidal wetlands at the land–sea margin.', 2),
  n('nutrients', 'Nutrient loading', 'marine', 'Excess nitrogen and phosphorus entering coastal water.', 3),
  n('fish', 'Fish stocks', 'marine', 'Abundance of commercially and ecologically important fish.', 3),
  n('waveatt', 'Wave attenuation', 'marine', 'Reduction of wave energy by natural structures.', 3),

  // Coastal infrastructure
  n('seawall', 'Sea walls', 'infrastructure', 'Engineered barriers protecting the shoreline.', 3),
  n('drainage', 'Stormwater drainage', 'infrastructure', 'Networks that carry rainfall and floodwater away.', 3),
  n('nbs', 'Nature-based defenses', 'infrastructure', 'Protection provided by restored ecosystems.', 4),
  n('erosion', 'Shoreline erosion', 'infrastructure', 'Loss of land and sediment along the coast.', 3),
  n('floodrisk', 'Flood risk', 'infrastructure', 'Combined likelihood and consequence of flooding.', 5),
  n('ports', 'Ports & harbours', 'infrastructure', 'Maritime infrastructure exposed to surge and sea-level rise.', 2),

  // Communities & health
  n('communities', 'Coastal communities', 'community', 'Populations living within the coastal zone.', 4),
  n('livelihoods', 'Fisheries livelihoods', 'community', 'Income and employment dependent on fishing.', 3),
  n('health', 'Public health', 'community', 'Population health outcomes in coastal areas.', 4),
  n('waterq', 'Water quality', 'community', 'Safety of water used for drinking and recreation.', 3),
  n('displacement', 'Displacement', 'community', 'Movement of people away from hazard-exposed areas.', 2),
  n('tourism', 'Tourism economy', 'community', 'Economic activity tied to coastal amenity.', 2),

  // Policy & economics
  n('funding', 'Adaptation funding', 'policy', 'Public and private finance for resilience measures.', 3),
  n('insurance', 'Insurance markets', 'policy', 'Availability and pricing of coastal cover.', 2),
  n('zoning', 'Land-use zoning', 'policy', 'Rules that govern where and how building occurs.', 2),
  n('restoration', 'Restoration programs', 'policy', 'Coordinated efforts to rebuild ecosystems.', 4),
  n('monitoring', 'Monitoring networks', 'policy', 'Observation systems that produce evidence.', 3),
  n('warning', 'Early warning systems', 'policy', 'Alerts that give communities time to act.', 2),

  // Sample sources (fictional)
  n('srcA', 'Source A · Reef Monitoring Survey', 'sources', 'Fictional field survey used to demonstrate provenance. Not a real document.', 3, 'source'),
  n('srcB', 'Source B · Regional Flood Assessment', 'sources', 'Fictional assessment report. Not a real document.', 3, 'source'),
  n('srcC', 'Source C · Fisheries Landing Dataset', 'sources', 'Fictional tabular dataset. Not a real document.', 3, 'source'),
  n('srcD', 'Source D · Mangrove Restoration Notes', 'sources', 'Fictional field notes. Not a real document.', 3, 'source'),
  n('srcE', 'Source E · Coastal Health Bulletin', 'sources', 'Fictional public-health bulletin. Not a real document.', 3, 'source'),

  // Sample claims
  n('cl1', 'Warm anomalies co-occur with bleaching', 'marine', 'Sample claim: bleaching was recorded during warm-water anomalies at surveyed sites.', 2, 'claim'),
  n('cl2', 'Seagrass cover declined at monitored sites', 'marine', 'Sample claim: survey transects show reduced seagrass cover across seasons.', 2, 'claim'),
  n('cl3', 'Mangrove belts reduce wave energy', 'infrastructure', 'Sample claim: wave height dropped behind dense mangrove belts.', 2, 'claim'),
  n('cl4', 'Mangroves gave limited protection in extreme surge', 'infrastructure', 'Sample claim: under the most extreme surge scenario, flood depth was similar with or without mangroves.', 2, 'claim'),
  n('cl5', 'Landings fell after reef degradation', 'community', 'Sample claim: recorded landings were lower in seasons following reef damage.', 2, 'claim'),
  n('cl6', 'Flood events precede waterborne illness reports', 'community', 'Sample claim: illness reports rose in the weeks after flood events.', 2, 'claim'),

  // Sample hypotheses (AI-generated in future; hand-written here)
  n('hy1', 'Seagrass loss may amplify nutrient-driven bleaching', 'marine', 'Sample hypothesis — unverified. Proposes an indirect pathway linking two sample claims.', 3, 'hypothesis'),
  n('hy2', 'Mangroves + drainage may outperform either alone', 'policy', 'Sample hypothesis — unverified. Suggests a combined intervention worth testing.', 3, 'hypothesis'),
];

let edgeSeq = 0;
const e = (source: string, target: string, kind: RelationKind, confidence = 0.7, evidence = 1): GraphEdge => ({
  id: `e${++edgeSeq}`,
  source,
  target,
  kind,
  confidence,
  evidence,
});

const edges: GraphEdge[] = [
  // Climate internal
  e('sst', 'heatwave', 'correlates', 0.8, 3),
  e('storms', 'surge', 'influences', 0.85, 4),
  e('slr', 'surge', 'influences', 0.7, 2),
  e('precip', 'drainage', 'influences', 0.6, 2),
  e('acid', 'reef', 'influences', 0.6, 2),
  // Climate → marine
  e('sst', 'bleach', 'influences', 0.8, 4),
  e('heatwave', 'bleach', 'influences', 0.75, 3),
  e('sst', 'seagrass', 'influences', 0.5, 1),
  e('precip', 'nutrients', 'influences', 0.55, 2),
  // Marine internal
  e('bleach', 'reef', 'part_of', 0.9, 2),
  e('reef', 'waveatt', 'influences', 0.7, 3),
  e('mangrove', 'waveatt', 'influences', 0.75, 3),
  e('seagrass', 'waveatt', 'influences', 0.45, 1),
  e('marsh', 'waveatt', 'influences', 0.4, 1),
  e('nutrients', 'seagrass', 'influences', 0.6, 2),
  e('reef', 'fish', 'influences', 0.7, 2),
  e('seagrass', 'fish', 'influences', 0.55, 1),
  e('mangrove', 'fish', 'influences', 0.5, 1),
  // Marine → infrastructure
  e('waveatt', 'erosion', 'influences', 0.65, 2),
  e('waveatt', 'nbs', 'part_of', 0.8, 2),
  e('mangrove', 'nbs', 'part_of', 0.85, 2),
  e('reef', 'nbs', 'part_of', 0.7, 1),
  // Infrastructure internal
  e('surge', 'floodrisk', 'influences', 0.85, 4),
  e('slr', 'floodrisk', 'influences', 0.8, 3),
  e('seawall', 'floodrisk', 'influences', 0.65, 2),
  e('nbs', 'floodrisk', 'influences', 0.55, 2),
  e('drainage', 'floodrisk', 'influences', 0.6, 2),
  e('erosion', 'floodrisk', 'influences', 0.55, 1),
  e('surge', 'ports', 'influences', 0.6, 1),
  e('seawall', 'erosion', 'correlates', 0.4, 1),
  // Infrastructure → community
  e('floodrisk', 'communities', 'influences', 0.8, 3),
  e('floodrisk', 'waterq', 'influences', 0.6, 2),
  e('floodrisk', 'displacement', 'influences', 0.55, 1),
  e('waterq', 'health', 'influences', 0.7, 2),
  e('fish', 'livelihoods', 'influences', 0.75, 2),
  e('livelihoods', 'communities', 'part_of', 0.8, 1),
  e('reef', 'tourism', 'influences', 0.5, 1),
  e('tourism', 'communities', 'part_of', 0.6, 1),
  e('nutrients', 'waterq', 'influences', 0.5, 1),
  // Policy
  e('funding', 'restoration', 'influences', 0.7, 2),
  e('funding', 'seawall', 'influences', 0.6, 1),
  e('restoration', 'mangrove', 'influences', 0.65, 2),
  e('restoration', 'seagrass', 'influences', 0.5, 1),
  e('restoration', 'reef', 'influences', 0.45, 1),
  e('zoning', 'floodrisk', 'influences', 0.55, 1),
  e('insurance', 'floodrisk', 'correlates', 0.5, 1),
  e('monitoring', 'warning', 'influences', 0.6, 1),
  e('warning', 'health', 'influences', 0.45, 1),
  e('warning', 'communities', 'influences', 0.5, 1),
  e('displacement', 'zoning', 'correlates', 0.35, 1),
  // Claims ↔ concepts
  e('cl1', 'bleach', 'supports', 0.7, 2),
  e('cl1', 'sst', 'supports', 0.65, 2),
  e('cl2', 'seagrass', 'supports', 0.6, 1),
  e('cl3', 'mangrove', 'supports', 0.7, 2),
  e('cl3', 'waveatt', 'supports', 0.7, 2),
  e('cl4', 'nbs', 'supports', 0.5, 1),
  e('cl4', 'cl3', 'contradicts', 0.6, 2),
  e('cl5', 'fish', 'supports', 0.55, 1),
  e('cl5', 'livelihoods', 'supports', 0.5, 1),
  e('cl6', 'health', 'supports', 0.55, 1),
  e('cl6', 'floodrisk', 'supports', 0.5, 1),
  // Sources → claims
  e('cl1', 'srcA', 'mentions', 1, 1),
  e('cl2', 'srcA', 'mentions', 1, 1),
  e('cl3', 'srcD', 'mentions', 1, 1),
  e('cl4', 'srcB', 'mentions', 1, 1),
  e('cl5', 'srcC', 'mentions', 1, 1),
  e('cl6', 'srcE', 'mentions', 1, 1),
  e('cl6', 'srcB', 'mentions', 1, 1),
  // Hypotheses
  e('hy1', 'cl2', 'hypothesized', 0.3, 1),
  e('hy1', 'cl1', 'hypothesized', 0.3, 1),
  e('hy1', 'nutrients', 'hypothesized', 0.3, 0),
  e('hy2', 'mangrove', 'hypothesized', 0.25, 0),
  e('hy2', 'drainage', 'hypothesized', 0.25, 0),
  e('hy2', 'cl4', 'hypothesized', 0.3, 1),
];

export const sampleGraph: KnowledgeGraph = {
  name: 'Coastal Resilience (sample)',
  isSample: true,
  clusters,
  nodes,
  edges,
};

export const clusterById = Object.fromEntries(clusters.map((c) => [c.id, c])) as Record<ClusterId, GraphCluster>;
export const nodeById = new Map(nodes.map((node) => [node.id, node]));

/** Adjacency helper: edges touching a node, with the opposite endpoint resolved. */
export function neighbours(graph: KnowledgeGraph, nodeId: string) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => {
      const otherId = edge.source === nodeId ? edge.target : edge.source;
      return { edge, node: byId.get(otherId)!, direction: edge.source === nodeId ? ('out' as const) : ('in' as const) };
    })
    .filter((item) => item.node);
}

export function graphStats(graph: KnowledgeGraph) {
  const byKind = graph.nodes.reduce<Record<NodeKind, number>>(
    (acc, node) => ({ ...acc, [node.kind]: acc[node.kind] + 1 }),
    { concept: 0, claim: 0, source: 0, hypothesis: 0 },
  );
  const byRelation = graph.edges.reduce<Partial<Record<RelationKind, number>>>(
    (acc, edge) => ({ ...acc, [edge.kind]: (acc[edge.kind] ?? 0) + 1 }),
    {},
  );
  return { nodes: graph.nodes.length, edges: graph.edges.length, clusters: graph.clusters.length, byKind, byRelation };
}
