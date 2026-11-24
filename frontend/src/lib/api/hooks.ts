import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, streamEvents } from './client';
import type { DocumentCreate, InvestigationCreate, InvestigationDetail, InvestigationSnapshot, SourceCreate, WorkspaceCreate } from './types';
import { isActive } from './intelligence-types';

export const queryKeys = {
  health: ['health'] as const,
  dependency: (name: string) => ['health', name] as const,
  workspaces: ['workspaces'] as const,
  sources: (workspaceId: string) => ['workspaces', workspaceId, 'sources'] as const,
  documents: (sourceId: string) => ['sources', sourceId, 'documents'] as const,
  workspaceDocuments: (workspaceId: string) => ['workspaces', workspaceId, 'documents'] as const,
  intelligence: ['intelligence', 'status'] as const,
  investigations: (workspaceId: string) => ['workspaces', workspaceId, 'investigations'] as const,
  investigation: (id: string) => ['investigations', id] as const,
  investigationPart: (id: string, part: string) => ['investigations', id, part] as const,
  graph: (workspaceId: string, investigationId?: string, includeClaims?: boolean) =>
    ['workspaces', workspaceId, 'graph', investigationId ?? 'all', includeClaims ? 'claims' : 'entities'] as const,
  entity: (workspaceId: string, entityId: string) => ['workspaces', workspaceId, 'entities', entityId] as const,
};

/** How often a running investigation's recorded state is re-read from the server. */
export const LIVE_POLL_MS = 1500;

/** Retry once for transient outages only; validation and not-found errors surface immediately. */
const retry = (count: number, error: unknown) => error instanceof ApiError && error.isUnavailable && count < 1;

export function useServiceHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: api.health, retry, refetchInterval: 30_000 });
}

export function useDependencyHealth(name: 'postgres' | 'neo4j') {
  return useQuery({
    queryKey: queryKeys.dependency(name),
    queryFn: () => api.dependencyHealth(name),
    retry,
    refetchInterval: 60_000,
  });
}

export function useWorkspaces() {
  return useQuery({ queryKey: queryKeys.workspaces, queryFn: () => api.listWorkspaces({ limit: 100 }), retry });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkspaceCreate) => api.createWorkspace(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workspaces }),
  });
}

export function useSources(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.sources(workspaceId ?? 'none'),
    queryFn: () => api.listSources(workspaceId as string, { limit: 100 }),
    enabled: Boolean(workspaceId),
    retry,
  });
}

export function useCreateSource(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SourceCreate) => api.createSource(workspaceId as string, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sources(workspaceId as string) });
      qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useDocuments(sourceId: string | null) {
  return useQuery({
    queryKey: queryKeys.documents(sourceId ?? 'none'),
    queryFn: () => api.listDocuments(sourceId as string),
    enabled: Boolean(sourceId),
    retry,
  });
}

export function useCreateDocument(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DocumentCreate) => api.createDocument(sourceId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documents(sourceId) });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useUploadDocument(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, title }: { file: File; title?: string }) => api.uploadDocument(sourceId, file, title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documents(sourceId) });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useWorkspaceDocuments(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaceDocuments(workspaceId ?? 'none'),
    queryFn: () => api.listWorkspaceDocuments(workspaceId as string),
    enabled: Boolean(workspaceId),
    retry,
  });
}

/* ------------------------------------------------------------------ intelligence */

export function useIntelligenceStatus() {
  return useQuery({ queryKey: queryKeys.intelligence, queryFn: api.intelligenceStatus, retry, staleTime: 60_000 });
}

export function useInvestigations(workspaceId: string | null, filters: { status?: string; q?: string } = {}) {
  const filtered = Boolean(filters.status || filters.q);
  return useQuery({
    queryKey: filtered ? [...queryKeys.investigations(workspaceId ?? 'none'), filters] : queryKeys.investigations(workspaceId ?? 'none'),
    queryFn: () =>
      filtered ? api.listInvestigationsFiltered(workspaceId as string, { ...filters, limit: 100 }) : api.listInvestigations(workspaceId as string),
    placeholderData: filtered ? keepPreviousData : undefined,
    enabled: Boolean(workspaceId),
    retry,
    // Keep the list's status badges honest while anything is still running.
    refetchInterval: (q) => (q.state.data?.items.some((i) => isActive(i.status)) ? LIVE_POLL_MS * 2 : false),
  });
}

export function useCreateInvestigation(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InvestigationCreate) => api.createInvestigation(workspaceId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.investigations(workspaceId as string) }),
  });
}

/**
 * Investigation detail. While the run is active it is kept fresh by server-sent events; polling is the
 * fallback, used only when `shouldPoll` says the stream is not live.
 */
export function useInvestigation(id: string | undefined, shouldPoll: () => boolean = () => true) {
  return useQuery({
    queryKey: queryKeys.investigation(id ?? 'none'),
    queryFn: () => api.getInvestigation(id as string),
    enabled: Boolean(id),
    retry,
    refetchInterval: (q) => (isActive(q.state.data?.status) && shouldPoll() ? LIVE_POLL_MS : false),
  });
}

/** A sub-resource of an investigation, refreshed alongside the detail while the run is active. */
function useInvestigationPart<T>(id: string | undefined, part: string, fetcher: (id: string) => Promise<T>, detail: InvestigationDetail | undefined) {
  return useQuery({
    // The status is part of the key so a finished run is re-read once, with its final results.
    queryKey: [...queryKeys.investigationPart(id ?? 'none', part), detail?.run_count ?? 0, isActive(detail?.status) ? 'live' : (detail?.status ?? '')],
    queryFn: () => fetcher(id as string),
    enabled: Boolean(id) && Boolean(detail),
    retry,
    refetchInterval: isActive(detail?.status) ? LIVE_POLL_MS : false,
    placeholderData: (previous) => previous,
  });
}

export const useExecutions = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'executions', api.listExecutions, d);
export const useClaims = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'claims', api.listClaims, d);
export const useHypotheses = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'hypotheses', api.listHypotheses, d);
export const useContradictions = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'contradictions', api.listContradictions, d);
export const useReports = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'reports', api.listReports, d);
export const useGraphChanges = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'graph-changes', api.listGraphChanges, d);

export function useInvestigationAction(id: string, action: 'start' | 'resume' | 'cancel') {
  const qc = useQueryClient();
  const fn = { start: api.startInvestigation, resume: api.resumeInvestigation, cancel: api.cancelInvestigation }[action];
  return useMutation({
    mutationFn: () => fn(id),
    onSuccess: (detail) => {
      qc.setQueryData(queryKeys.investigation(id), detail);
      qc.invalidateQueries({ queryKey: ['investigations', id] });
      qc.invalidateQueries({ queryKey: queryKeys.investigations(detail.workspace_id) });
      qc.invalidateQueries({ queryKey: ['workspaces', detail.workspace_id, 'graph'] });
    },
  });
}

export function useWorkspaceGraph(workspaceId: string | null, opts: { investigationId?: string; includeClaims?: boolean; live?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.graph(workspaceId ?? 'none', opts.investigationId, opts.includeClaims),
    queryFn: () => api.workspaceGraph(workspaceId as string, { investigation_id: opts.investigationId, include_claims: opts.includeClaims, limit: 400 }),
    enabled: Boolean(workspaceId),
    retry,
    refetchInterval: opts.live ? LIVE_POLL_MS * 2 : false,
    placeholderData: (previous) => previous,
  });
}

export function useEntityDetail(workspaceId: string | null, entityId: string | null) {
  return useQuery({
    queryKey: queryKeys.entity(workspaceId ?? 'none', entityId ?? 'none'),
    queryFn: () => api.entityDetail(workspaceId as string, entityId as string),
    enabled: Boolean(workspaceId && entityId),
    retry,
  });
}

export function useComparison(workspaceId: string | null, ids: string[]) {
  return useQuery({
    queryKey: ['workspaces', workspaceId ?? 'none', 'compare', ...ids],
    queryFn: () => api.compareInvestigations(workspaceId as string, ids),
    enabled: Boolean(workspaceId) && ids.length >= 2,
    retry,
  });
}

/* ------------------------------------------------------------------ Phase 3 */

export const useRuns = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'runs', api.listRuns, d);
export const useAssessments = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'assessments', api.listAssessments, d);
export const useMessages = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'messages', api.listMessages, d);
export const useSourceAssessments = (id: string | undefined, d?: InvestigationDetail) => useInvestigationPart(id, 'sources', api.listSourceAssessments, d);

export function useWorkspaceInsights(workspaceId: string | null) {
  return useQuery({
    queryKey: ['workspaces', workspaceId ?? 'none', 'insights'],
    queryFn: () => api.workspaceInsights(workspaceId as string),
    enabled: Boolean(workspaceId),
    retry,
  });
}

export function useEntityTimeline(workspaceId: string | null, entityId: string | null) {
  return useQuery({
    queryKey: ['workspaces', workspaceId ?? 'none', 'entities', entityId ?? 'none', 'timeline'],
    queryFn: () => api.entityTimeline(workspaceId as string, entityId as string),
    enabled: Boolean(workspaceId && entityId),
    retry,
  });
}

/* ------------------------------------------------------------------ product views */

export function useDashboard(workspaceId: string | null) {
  return useQuery({
    queryKey: ['workspaces', workspaceId ?? 'none', 'dashboard'],
    queryFn: () => api.dashboard(workspaceId as string),
    enabled: Boolean(workspaceId),
    retry,
    refetchInterval: (q) => ((q.state.data?.investigations.active ?? 0) > 0 ? LIVE_POLL_MS * 2 : false),
  });
}

export function useExplorer<T>(kind: string, workspaceId: string | null, params: Record<string, string | number | undefined>, fetcher: () => Promise<T>) {
  return useQuery({
    queryKey: ['workspaces', workspaceId ?? 'none', 'explorer', kind, params],
    queryFn: fetcher,
    enabled: Boolean(workspaceId),
    retry,
    placeholderData: keepPreviousData,
  });
}

export function useDocumentIntelligence(documentId: string | null) {
  return useQuery({
    queryKey: ['documents', documentId ?? 'none', 'intelligence'],
    queryFn: () => api.documentIntelligence(documentId as string),
    enabled: Boolean(documentId),
    retry,
  });
}

export function useProcessDocument(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.processDocument(documentId),
    onSuccess: (data) => {
      qc.setQueryData(['documents', data.document_id, 'intelligence'], data);
      qc.invalidateQueries({ queryKey: queryKeys.documents(sourceId) });
    },
  });
}

export type LiveState = 'connecting' | 'live' | 'ended' | 'polling';

/**
 * Subscribes to the investigation's server-sent events while the run is active and writes each recorded
 * snapshot into the query cache. If the stream fails, the regular polling in useInvestigation takes over.
 */
export function useInvestigationEvents(id: string | undefined, active: boolean): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('ended');
  useEffect(() => {
    if (!id || !active) {
      setState('ended');
      return;
    }
    const ctrl = new AbortController();
    let ended = false;
    setState('connecting');
    streamEvents(
      `/v1/investigations/${id}/events`,
      (event, data) => {
        if (event === 'snapshot') {
          const snap = data as InvestigationSnapshot;
          setState('live');
          qc.setQueryData(queryKeys.investigation(id), snap.detail);
          qc.setQueriesData({ queryKey: queryKeys.investigationPart(id, 'executions') }, snap.executions);
        } else if (event === 'end') {
          ended = true;
          setState('ended');
          qc.invalidateQueries({ queryKey: ['investigations', id] });
        }
      },
      ctrl.signal,
    )
      .catch(() => undefined)
      .then(() => {
        // Failed, or closed without an `end` event (time limit, proxy, sign-out): let polling take over.
        if (!ended && !ctrl.signal.aborted) setState('polling');
      });
    return () => ctrl.abort();
  }, [id, active, qc]);
  return state;
}
