import { useEffect } from 'react';
import { useWorkspaces } from '@/lib/api/hooks';
import { usePreferences } from '@/stores/ui';

/**
 * Resolves the active workspace from the API list and the persisted preference.
 * Falls back to the first workspace when the stored id no longer exists.
 */
export function useActiveWorkspace() {
  const query = useWorkspaces();
  const activeId = usePreferences((s) => s.activeWorkspaceId);
  const setActiveId = usePreferences((s) => s.setActiveWorkspaceId);
  const items = query.data?.items ?? [];
  const active = items.find((w) => w.id === activeId) ?? items[0] ?? null;

  useEffect(() => {
    if (query.isSuccess && active && active.id !== activeId) setActiveId(active.id);
  }, [query.isSuccess, active, activeId, setActiveId]);

  return { ...query, workspaces: items, active, setActiveId };
}
