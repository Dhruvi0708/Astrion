import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type { DocumentCreate, SourceCreate, WorkspaceCreate } from './types';

export const queryKeys = {
  health: ['health'] as const,
  dependency: (name: string) => ['health', name] as const,
  workspaces: ['workspaces'] as const,
  sources: (workspaceId: string) => ['workspaces', workspaceId, 'sources'] as const,
  documents: (sourceId: string) => ['sources', sourceId, 'documents'] as const,
};

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
