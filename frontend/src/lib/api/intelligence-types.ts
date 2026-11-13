/**
 * Intelligence-engine types. They mirror backend/app/schemas/investigation.py and the payloads
 * built in backend/app/services/{investigations,graph}.py.
 */

type ISODateTime = string;

export type InvestigationStatus = 'draft' | 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type AgentRole = 'system' | 'orchestrator' | 'research' | 'knowledge' | 'hypothesis' | 'contradiction' | 'verification' | 'synthesis';
export type ExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
export type Verdict = 'supported' | 'partially_supported' | 'unsupported' | 'insufficient_evidence' | 'contradicted';

export interface IntelligenceStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  is_fixture: boolean;
  neo4j_configured: boolean;
  detail: string;
}

export interface InvestigationCreate {
  title: string;
  question: string;
  document_ids: string[];
}

export interface Investigation {
  id: string;
  workspace_id: string;
  title: string;
  question: string;
  status: InvestigationStatus;
  document_ids: string[];
  summary: string | null;
  error: string | null;
  run_count: number;
  started_at: ISODateTime | null;
  finished_at: ISODateTime | null;
  llm_provider: string | null;
  llm_model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface SubQuestion {
  id: string;
  question: string;
  rationale: string;
}

export interface InvestigationPlan {
  objective: string;
  scope_notes: string;
  sub_questions: SubQuestion[];
  key_terms: string[];
  evidence_needs: string[];
  initial_assessment: string;
}

export interface StageProgress {
  stage: string;
  role: AgentRole;
  status: ExecutionStatus;
  steps: number;
  succeeded: number;
  failed: number;
  summary: string | null;
}

export interface InvestigationDetail extends Investigation {
  plan: InvestigationPlan | null;
  progress: StageProgress[];
  counts: Record<string, number>;
  can_start: boolean;
  can_resume: boolean;
  can_cancel: boolean;
}

export interface AgentExecution {
  id: string;
  step_key: string | null;
  agent_role: AgentRole;
  status: ExecutionStatus;
  attempt: number;
  parent_execution_id: string | null;
  depends_on: string[];
  provider: string | null;
  model_requested: string | null;
  model: string | null;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  summary: string | null;
  error: string | null;
  started_at: ISODateTime | null;
  finished_at: ISODateTime | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
}

export interface EvidenceLocator {
  chunk_id?: string;
  chunk_index?: number;
  char_start?: number;
  char_end?: number;
  page?: number | null;
}

export interface DocRef {
  id: string;
  title: string;
}

export interface SourceRef {
  id: string;
  title: string;
  uri: string | null;
}

export interface ClaimRecord {
  id: string;
  statement: string;
  kind: 'explicit' | 'inferred';
  confidence: number | null;
  temporal_scope: string | null;
  extractor: string | null;
  subject: { id: string; name: string; entity_type: string } | null;
  document: DocRef | null;
  source: SourceRef | null;
  evidence: { id: string; quote: string; locator: EvidenceLocator; stance: string }[];
  investigation_id: string | null;
  created_at: ISODateTime;
}

export interface VerificationRecord {
  id: string;
  target_type: 'hypothesis' | 'contradiction';
  target_id: string;
  verdict: Verdict;
  reasoning: string;
  issues: string[];
  missing_evidence: string[];
  unsupported_claim_ids: string[];
  execution_id: string | null;
}

export interface ConfidenceMethod {
  method: string;
  score: number;
  band: 'low' | 'medium' | 'high';
  inputs: Record<string, string | number | null>;
  components: Record<string, number>;
}

export interface HypothesisRecord {
  id: string;
  statement: string;
  rationale: string;
  test_plan: string | null;
  origin: 'human' | 'ai_generated';
  status: 'unverified' | 'in_review' | 'conditional' | 'verified' | 'refuted';
  confidence: number | null;
  confidence_method: ConfidenceMethod | null;
  supporting_claim_ids: string[];
  opposing_claim_ids: string[];
  verification: VerificationRecord | null;
  generated_by_execution_id: string | null;
}

export interface ContradictionRecord {
  id: string;
  kind: 'direct' | 'temporal' | 'contextual';
  is_genuine: boolean;
  severity: 'low' | 'medium' | 'high';
  explanation: string;
  claim_a: ClaimRecord;
  claim_b: ClaimRecord;
  verification: VerificationRecord | null;
}

export interface Citation {
  claim_id: string;
  statement: string;
  kind: string;
  temporal_scope: string | null;
  document: DocRef | null;
  source: SourceRef | null;
  evidence: { quote: string; locator: EvidenceLocator }[];
}

export interface ReportContent {
  title: string;
  answer_status: 'answered' | 'partially_answered' | 'insufficient_evidence';
  executive_summary: string;
  key_findings: { statement: string; claim_refs: string[]; confidence: 'low' | 'medium' | 'high'; basis: string }[];
  hypotheses: { ref: string; assessment: string }[];
  contradictions: { ref: string; assessment: string }[];
  unresolved_questions: string[];
  limitations: string[];
  citations: Record<string, Citation>;
  hypothesis_ids: Record<string, string>;
  contradiction_ids: Record<string, string>;
  documents_without_evidence: string[];
  generated_by: { provider: string | null; model: string | null; is_fixture: boolean };
}

export interface InvestigationReport {
  id: string;
  run_number: number;
  provider: string | null;
  model: string | null;
  created_at: ISODateTime;
  content: ReportContent;
}

export interface GraphChangeRecord {
  id: string;
  change_type: string;
  target_key: string;
  details: Record<string, unknown>;
  created_at: ISODateTime;
}

export interface WorkspaceGraphNode {
  key: string;
  kind: 'entity' | 'claim';
  label: string;
  entity_type?: string;
  entity_id?: string;
  mention_count?: number;
  aliases?: string[];
  claim_id?: string;
  claim_kind?: string;
}

export interface WorkspaceGraphEdge {
  key: string;
  type: string;
  source: string;
  target: string;
  support_count: number;
  claim_ids: string[];
  confidence: number | null;
}

export interface WorkspaceGraph {
  source: 'neo4j' | 'postgres';
  fallback_reason: string | null;
  nodes: WorkspaceGraphNode[];
  edges: WorkspaceGraphEdge[];
}

export interface EntityDetail {
  id: string;
  key: string;
  name: string;
  entity_type: string;
  description: string | null;
  aliases: string[];
  mention_count: number;
  last_seen_at: ISODateTime | null;
  graph_synced_at: ISODateTime | null;
  claims: {
    id: string;
    statement: string;
    kind: string;
    temporal_scope: string | null;
    investigation_id: string | null;
    document: DocRef | null;
    source: SourceRef | null;
    evidence: { quote: string; locator: EvidenceLocator }[];
  }[];
  relationships: {
    id: string;
    type: string;
    direction: 'in' | 'out';
    other: { id: string; name: string; entity_type: string; key: string };
    support_count: number;
    confidence: number | null;
    claim_ids: string[];
  }[];
}

export interface InvestigationComparison {
  investigations: {
    id: string;
    title: string;
    status: InvestigationStatus;
    answer_status: string | null;
    hypotheses: { id: string; statement: string; status: string; confidence: number | null }[];
    entity_count: number;
  }[];
  shared_entities: { id: string; name: string }[];
}

export const ACTIVE_STATUSES: InvestigationStatus[] = ['queued', 'running', 'cancelling'];
export const isActive = (status: InvestigationStatus | undefined) => Boolean(status && ACTIVE_STATUSES.includes(status));
