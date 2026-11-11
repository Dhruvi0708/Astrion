/**
 * SAMPLE AGENT WORKFLOW — illustrative only.
 *
 * Describes the planned multi-agent investigation roles. The "sequence" below is a hand-written
 * walkthrough used to explain the concept. No agent executes in Phase 1 and none of these steps
 * were produced by a model.
 */
import { CircleHelp, Compass, FileSearch, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';

export type AgentRole = 'inquirer' | 'cartographer' | 'retriever' | 'skeptic' | 'verifier';

export interface AgentDefinition {
  role: AgentRole;
  name: string;
  responsibility: string;
  inputs: string;
  outputs: string;
  icon: LucideIcon;
  color: string;
}

export const AGENTS: AgentDefinition[] = [
  {
    role: 'inquirer',
    name: 'Inquirer',
    responsibility: 'Generates investigation questions from the graph and the user’s research goal.',
    inputs: 'Research goal, graph neighbourhood',
    outputs: 'Ranked investigation questions',
    icon: CircleHelp,
    color: '#4fe3f0',
  },
  {
    role: 'cartographer',
    name: 'Cartographer',
    responsibility: 'Explores relationships — traverses paths and finds structurally interesting connections.',
    inputs: 'Question, Neo4j traversals',
    outputs: 'Candidate paths and subgraphs',
    icon: Compass,
    color: '#7aa2ff',
  },
  {
    role: 'retriever',
    name: 'Retriever',
    responsibility: 'Retrieves the evidence spans that support or weaken each candidate relationship.',
    inputs: 'Candidate paths, document index',
    outputs: 'Evidence with provenance',
    icon: FileSearch,
    color: '#5ee0a5',
  },
  {
    role: 'skeptic',
    name: 'Skeptic',
    responsibility: 'Challenges claims — looks for contradictions, confounders and weak evidence.',
    inputs: 'Claims with evidence',
    outputs: 'Objections and conflict flags',
    icon: ShieldAlert,
    color: '#ff7a8a',
  },
  {
    role: 'verifier',
    name: 'Verifier',
    responsibility: 'Assigns a verification status and records exactly which evidence justified it.',
    inputs: 'Claims, evidence, objections',
    outputs: 'Verification status and rationale',
    icon: ShieldCheck,
    color: '#9d8cff',
  },
];

export const agentByRole = Object.fromEntries(AGENTS.map((a) => [a.role, a])) as Record<AgentRole, AgentDefinition>;

export interface SampleStep {
  id: string;
  role: AgentRole;
  handoffTo?: AgentRole;
  action: string;
  detail: string;
  verification?: 'unverified' | 'conflict' | 'gap' | 'conditional';
}

export const SAMPLE_SEQUENCE: SampleStep[] = [
  {
    id: 's1',
    role: 'inquirer',
    handoffTo: 'cartographer',
    action: 'Proposed an investigation question',
    detail: '“Do mangrove belts reduce flood exposure during extreme storm surge?”',
  },
  {
    id: 's2',
    role: 'cartographer',
    handoffTo: 'retriever',
    action: 'Traced candidate paths',
    detail: 'Mangrove forests → Wave attenuation → Shoreline erosion → Flood risk (2 hops), plus a direct claim link.',
  },
  {
    id: 's3',
    role: 'retriever',
    handoffTo: 'skeptic',
    action: 'Attached evidence',
    detail: 'Claim “Mangrove belts reduce wave energy” ← Source D. Claim “Limited protection in extreme surge” ← Source B.',
  },
  {
    id: 's4',
    role: 'skeptic',
    handoffTo: 'retriever',
    action: 'Flagged a contradiction',
    detail: 'The two claims disagree under extreme conditions. Asked whether surge magnitude explains the difference.',
    verification: 'conflict',
  },
  {
    id: 's5',
    role: 'retriever',
    handoffTo: 'verifier',
    action: 'Reported missing evidence',
    detail: 'No sample source covers salt marshes or mangroves under measured surge heights.',
    verification: 'gap',
  },
  {
    id: 's6',
    role: 'verifier',
    action: 'Recorded a conditional status',
    detail: 'Relationship marked “conditional — unresolved”. Requires additional evidence before any finding is accepted.',
    verification: 'conditional',
  },
];
