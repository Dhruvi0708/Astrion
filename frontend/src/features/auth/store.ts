import { create } from 'zustand';
import { api, ApiError, configureAuth } from '@/lib/api/client';
import type { AuthTokens, LoginInput, RegisterInput, User } from '@/lib/api/types';

/**
 * Session state.
 * - The access token lives only in memory (never localStorage), so injected scripts can't read it
 *   from storage and it disappears when the tab closes.
 * - The refresh token is an httpOnly cookie the page can't read; a reload restores the session by
 *   calling /auth/refresh.
 */
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'expired' | 'offline';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  accessToken: string | null;
  expiresAt: number | null;
  bootstrap: () => Promise<void>;
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: (opts?: { everywhere?: boolean }) => Promise<void>;
  /** Single-flight silent refresh; resolves to the new token or null. */
  refresh: () => Promise<string | null>;
  expire: () => void;
}

let refreshInFlight: Promise<string | null> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Lets other modules (e.g. the query cache) react to sign-out / user switch without a circular import. */
export function onSessionCleared(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function scheduleRefresh(expiresInSeconds: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 60s before expiry (or halfway through very short lifetimes).
  const delay = Math.max(5_000, Math.min(expiresInSeconds - 60, expiresInSeconds / 2) * 1000);
  refreshTimer = setTimeout(() => void useAuth.getState().refresh(), delay);
}

function clearTimer() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

export const useAuth = create<AuthState>((set, get) => {
  const apply = (tokens: AuthTokens) => {
    set({ status: 'authenticated', user: tokens.user, accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
    scheduleRefresh(tokens.expires_in);
    return tokens.user;
  };

  const clear = (status: AuthStatus) => {
    clearTimer();
    set({ status, user: null, accessToken: null, expiresAt: null });
    listeners.forEach((fn) => fn());
  };

  return {
    status: 'checking',
    user: null,
    accessToken: null,
    expiresAt: null,

    bootstrap: async () => {
      if (get().status === 'authenticated') return;
      try {
        apply(await api.refresh());
      } catch (error) {
        set({ status: error instanceof ApiError && error.isUnavailable ? 'offline' : 'anonymous', user: null, accessToken: null, expiresAt: null });
      }
    },

    login: async (input) => {
      const previous = get().user?.id;
      const tokens = await api.login(input);
      if (previous && previous !== tokens.user.id) listeners.forEach((fn) => fn());
      return apply(tokens);
    },

    register: async (input) => apply(await api.register(input)),

    logout: async ({ everywhere = false } = {}) => {
      const token = get().accessToken;
      try {
        if (everywhere) await api.logoutAll();
        else if (token) await api.logout(token);
      } catch {
        /* Even if the server is unreachable, drop local credentials. */
      } finally {
        clear('anonymous');
      }
    },

    refresh: () => {
      if (!refreshInFlight) {
        refreshInFlight = api
          .refresh()
          .then((tokens) => {
            apply(tokens);
            return tokens.access_token;
          })
          .catch((error) => {
            if (error instanceof ApiError && error.isUnauthorized) clear(get().status === 'authenticated' ? 'expired' : 'anonymous');
            return null;
          })
          .finally(() => {
            refreshInFlight = null;
          });
      }
      return refreshInFlight;
    },

    expire: () => {
      if (get().status === 'authenticated') clear('expired');
    },
  };
});

configureAuth({
  getAccessToken: () => useAuth.getState().accessToken,
  refresh: () => useAuth.getState().refresh(),
  onSessionExpired: () => useAuth.getState().expire(),
});
