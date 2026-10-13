import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useApiConfig } from '@/contexts/ApiConfigContext';
import { useAuth } from '@/contexts/AuthContext';

/**
 * `apiFetch` for authenticated routes: sends the session token from AuthContext as
 * `Authorization: Bearer`, and on 401 (missing, expired or revoked token) ends the
 * session and goes back to the login screen, once even when several requests fail
 * together. 403 responses are left to the caller,
 * which shows the server message (`{ error, code }`).
 * The returned function is stable, so it can sit in effect dependencies.
 */
// Shared by every hook instance: when several requests get 401 at once, only the
// first one logs out and redirects; the others wait for it.
let sessionEnding: Promise<void> | null = null;

export function useAuthedFetch() {
  const { apiFetch } = useApiConfig();
  const { token, logout } = useAuth();
  const router = useRouter();

  const latest = useRef({ apiFetch, token, logout, router });
  latest.current = { apiFetch, token, logout, router };

  return useCallback(async (path: string, options: RequestInit = {}) => {
    const { apiFetch: doFetch, token: authToken } = latest.current;
    const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await doFetch(path, { ...options, headers });

    if (res.status === 401) {
      // Only end the session the request was sent with (not one opened since).
      if (!sessionEnding && authToken === latest.current.token) {
        const { logout, router } = latest.current;
        sessionEnding = (async () => {
          try {
            await logout();
            router.replace('/login');
          } finally {
            sessionEnding = null;
          }
        })();
      }
      if (sessionEnding) await sessionEnding;
      throw new Error('Session expirée, veuillez vous reconnecter');
    }

    return res;
  }, []);
}
