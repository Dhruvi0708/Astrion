/**
 * Typed contract for the ASTRION API (v1). Mirrors backend/app/schemas — see docs/API_CONTRACT.md.
 */
export type ISODateTime = string;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; request_id?: string };
}

export interface ServiceHealth {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  timestamp: ISODateTime;
}

export type DependencyStatus = 'ok' | 'unavailable' | 'not_configured';

export interface DependencyHealth {
  name: 'postgres' | 'neo4j';
  status: DependencyStatus;
  latency_ms: number | null;
  detail: string | null;
}

export type WorkspaceStatus = 'active' | 'archived';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: WorkspaceStatus;
  source_count: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface WorkspaceCreate {
  name: string;
  description?: string | null;
}

export const SOURCE_TYPES = ['paper', 'report', 'dataset', 'article', 'document', 'web', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type SourceStatus = 'registered' | 'archived';

export interface Source {
  id: string;
  workspace_id: string;
  title: string;
  source_type: SourceType;
  uri: string | null;
  citation: string | null;
  authors: string[];
  published_on: string | null;
  description: string | null;
  status: SourceStatus;
  document_count: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface SourceCreate {
  title: string;
  source_type: SourceType;
  uri?: string | null;
  citation?: string | null;
  authors?: string[];
  published_on?: string | null;
  description?: string | null;
}

export type DocumentProcessingStatus = 'registered' | 'queued' | 'processing' | 'processed' | 'failed';

export interface SourceDocument {
  id: string;
  workspace_id: string;
  source_id: string;
  title: string;
  media_type: string;
  byte_size: number | null;
  content_hash: string | null;
  storage_uri: string | null;
  processing_status: DocumentProcessingStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DocumentCreate {
  title: string;
  media_type: string;
  byte_size?: number | null;
  content_hash?: string | null;
  storage_uri?: string | null;
}
