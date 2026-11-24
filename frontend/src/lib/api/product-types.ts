/** Types for workspace-level product endpoints (backend/app/services/explorer.py). */
import type { ClaimRecord, ContradictionRecord, HypothesisRecord, InvestigationDetail, AgentExecution, WorkspaceGraph } from './intelligence-types';

type ISODateTime = string;

export interface Dashboard {
  investigations: { total: number; active: number; completed: number; failed: number; by_status: Record<string, number> };
  knowledge: {
    entities: number;
    relationships: number;
    claims: number;
    entity_types: Record<string, number>;
    top_entities: { id: string; name: string; entity_type: string; mention_count: number }[];
  };
  findings: {
    cited_findings: number;
    agreed_hypotheses: number;
    human_verified_hypotheses: number;
    unresolved_hypotheses: number;
    unresolved_contradictions: number;
  };
  documents: { total: number; by_status: Record<string, number> };
  recent_discoveries: {
    change_type: string;
    target_key: string;
    details: Record<string, unknown>;
    investigation: { id: string; title: string | null } | null;
    created_at: ISODateTime;
  }[];
  recent_activity: {
    investigation: { id: string; title: string | null };
    step_key: string | null;
    agent_role: string;
    status: string;
    summary: string | null;
    error: string | null;
    finished_at: ISODateTime | null;
  }[];
}

export interface PageOf<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface InvestigationRef {
  id: string;
  title: string | null;
}

export interface EntityRow {
  id: string;
  key: string;
  name: string;
  entity_type: string;
  aliases: string[];
  mention_count: number;
  claims: number;
  relationships: number;
  investigations: InvestigationRef[];
}

export type WorkspaceHypothesis = HypothesisRecord & { investigation: InvestigationRef };
export type WorkspaceContradiction = ContradictionRecord & { investigation: InvestigationRef };

export interface EvidenceRow {
  id: string;
  quote: string;
  locator: Record<string, unknown>;
  stance: string;
  claim: {
    id: string;
    statement: string;
    kind: string;
    status: string;
    superseded: boolean;
    period: [number | null, number | null] | null;
    extractor: string | null;
  };
  entity: { id: string; name: string; entity_type: string } | null;
  document: { id: string; title: string; media_type: string } | null;
  source: { id: string; title: string; uri: string | null; source_type: string } | null;
  investigations: InvestigationRef[];
  used_by_hypotheses: number;
}

export type Neighbourhood = WorkspaceGraph & { center: string };

export interface DocumentIntelligence {
  document_id: string;
  processing_status: string;
  processing_error: string | null;
  passages: number;
  extracted_characters: number;
  claims: { id: string; statement: string; kind: string; superseded: boolean }[];
  claim_count: number;
  entities: { id: string; name: string; entity_type: string; claims: number }[];
  investigations: (InvestigationRef & { relation: string })[];
}

export interface InvestigationSnapshot {
  detail: InvestigationDetail;
  executions: AgentExecution[];
}

export type { ClaimRecord };
