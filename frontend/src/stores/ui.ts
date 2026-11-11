import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface UiState {
  commandOpen: boolean;
  mobileNavOpen: boolean;
  createWorkspaceOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setCreateWorkspaceOpen: (open: boolean) => void;
}

/** Ephemeral UI state (not persisted). */
export const useUi = create<UiState>((set) => ({
  commandOpen: false,
  mobileNavOpen: false,
  createWorkspaceOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setCreateWorkspaceOpen: (createWorkspaceOpen) => set({ createWorkspaceOpen }),
}));

interface PreferencesState {
  activeWorkspaceId: string | null;
  sidebarCollapsed: boolean;
  reduceMotion: boolean;
  graphLabels: 'auto' | 'all' | 'none';
  setActiveWorkspaceId: (id: string | null) => void;
  toggleSidebar: () => void;
  setReduceMotion: (v: boolean) => void;
  setGraphLabels: (v: 'auto' | 'all' | 'none') => void;
}

/** Per-browser preferences, persisted to localStorage. */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      sidebarCollapsed: false,
      reduceMotion: false,
      graphLabels: 'auto',
      setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setGraphLabels: (graphLabels) => set({ graphLabels }),
    }),
    {
      name: 'astrion.preferences',
      version: 1,
      storage: createJSONStorage(() => {
        try {
          return window.localStorage;
        } catch {
          // Storage can be unavailable (private mode / blocked); fall back to memory.
          const mem = new Map<string, string>();
          return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
        }
      }),
    },
  ),
);
