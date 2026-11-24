import { Database, FileInput, GitBranch, Network, Sparkles, Telescope, type LucideIcon } from 'lucide-react';

export type StageStatus = 'live';

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
    status: 'live',
    phaseNote: 'Upload PDF, text, Markdown, CSV, JSON or HTML. Text is extracted into passages, with honest processing status.',
  },
  {
    id: 'understand',
    index: 2,
    name: 'Understand',
    tagline: 'Extract entities, claims and evidence.',
    description: 'Language models read each document and extract entities, claims and the exact evidence spans that support them.',
    produces: ['Entities', 'Claims', 'Evidence spans'],
    icon: Telescope,
    status: 'live',
    phaseNote: 'The Research agent extracts claims whose quotes are checked verbatim against the source passage.',
  },
  {
    id: 'connect',
    index: 3,
    name: 'Connect',
    tagline: 'Discover relationships and build the graph.',
    description: 'Entities are resolved across documents and linked by typed relationships in a traceable knowledge graph stored in Neo4j.',
    produces: ['Graph entities', 'Relationships', 'Clusters'],
    icon: GitBranch,
    status: 'live',
    phaseNote: 'Entities are de-duplicated and linked by typed relationships in PostgreSQL and Neo4j, with a consistency check.',
  },
  {
    id: 'investigate',
    index: 4,
    name: 'Investigate',
    tagline: 'Collaborating agents examine the knowledge.',
    description: 'Specialised agents generate questions, traverse the graph, retrieve evidence and challenge each other’s conclusions.',
    produces: ['Investigations', 'Agent executions', 'Findings'],
    icon: Network,
    status: 'live',
    phaseNote: 'Nine agents plan, research, debate and verify within hard budgets. Every step is recorded and resumable.',
  },
  {
    id: 'discover',
    index: 5,
    name: 'Discover',
    tagline: 'Surface contradictions, gaps and hypotheses.',
    description: 'Patterns across the graph reveal conflicting evidence, under-studied regions and new testable hypotheses — always labelled as unverified.',
    produces: ['Contradictions', 'Knowledge gaps', 'Hypotheses'],
    icon: Sparkles,
    status: 'live',
    phaseNote: 'Hypotheses carry a reasoning type and falsification conditions; conflicts are detected and resolved over time.',
  },
  {
    id: 'evolve',
    index: 6,
    name: 'Evolve',
    tagline: 'Track how knowledge changes over time.',
    description: 'New evidence updates confidence, and graph snapshots record how understanding shifted — and why.',
    produces: ['Graph snapshots', 'Confidence history', 'Change log'],
    icon: Database,
    status: 'live',
    phaseNote: 'New investigations reuse workspace memory; outdated claims are superseded and every change is logged.',
  },
];
