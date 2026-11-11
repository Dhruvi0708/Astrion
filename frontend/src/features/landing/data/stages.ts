import { Database, FileInput, GitBranch, Network, Sparkles, Telescope, type LucideIcon } from 'lucide-react';

export type StageStatus = 'foundation' | 'planned';

export interface Stage {
  id: string;
  index: number;
  name: string;
  tagline: string;
  description: string;
  produces: string[];
  icon: LucideIcon;
  status: StageStatus;
  /** Honest description of what exists today. */
  phaseNote: string;
}

export const STAGES: Stage[] = [
  {
    id: 'ingest',
    index: 1,
    name: 'Ingest',
    tagline: 'Bring information into ASTRION.',
    description: 'Papers, reports, datasets and articles are registered as sources with full provenance metadata, then stored as versioned documents.',
    produces: ['Sources', 'Documents', 'Content hashes'],
    icon: FileInput,
    status: 'foundation',
    phaseNote: 'Phase 1 ships the source & document metadata API. File upload and parsing are planned.',
  },
  {
    id: 'understand',
    index: 2,
    name: 'Understand',
    tagline: 'Extract entities, claims and evidence.',
    description: 'Language models read each document and extract entities, claims and the exact evidence spans that support them.',
    produces: ['Entities', 'Claims', 'Evidence spans'],
    icon: Telescope,
    status: 'planned',
    phaseNote: 'Data model for claims and evidence exists. Extraction is planned for Phase 2.',
  },
  {
    id: 'connect',
    index: 3,
    name: 'Connect',
    tagline: 'Discover relationships and build the graph.',
    description: 'Entities are resolved across documents and linked by typed relationships in a traceable knowledge graph stored in Neo4j.',
    produces: ['Graph entities', 'Relationships', 'Clusters'],
    icon: GitBranch,
    status: 'foundation',
    phaseNote: 'Neo4j connection layer and graph registry tables exist. Relationship extraction is planned.',
  },
  {
    id: 'investigate',
    index: 4,
    name: 'Investigate',
    tagline: 'Collaborating agents examine the knowledge.',
    description: 'Specialised agents generate questions, traverse the graph, retrieve evidence and challenge each other’s conclusions.',
    produces: ['Investigations', 'Agent executions', 'Findings'],
    icon: Network,
    status: 'planned',
    phaseNote: 'Execution records are modelled. No agents run in Phase 1.',
  },
  {
    id: 'discover',
    index: 5,
    name: 'Discover',
    tagline: 'Surface contradictions, gaps and hypotheses.',
    description: 'Patterns across the graph reveal conflicting evidence, under-studied regions and new testable hypotheses — always labelled as unverified.',
    produces: ['Contradictions', 'Knowledge gaps', 'Hypotheses'],
    icon: Sparkles,
    status: 'planned',
    phaseNote: 'Hypothesis model with verification states exists. Discovery engine is planned.',
  },
  {
    id: 'evolve',
    index: 6,
    name: 'Evolve',
    tagline: 'Track how knowledge changes over time.',
    description: 'New evidence updates confidence, and graph snapshots record how understanding shifted — and why.',
    produces: ['Graph snapshots', 'Confidence history', 'Change log'],
    icon: Database,
    status: 'planned',
    phaseNote: 'Graph snapshot model exists. Versioned evolution tracking is planned.',
  },
];
