import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useApiConfig } from '../contexts/ApiConfigContext';

// Closes the auth popup on web when Google redirects back to the app.
WebBrowser.maybeCompleteAuthSession();

/**
 * Google OAuth client ids, from the environment only (App/.env, never committed):
 * EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID / _IOS / _WEB, with EXPO_PUBLIC_GOOGLE_CLIENT_ID
 * as fallback. The API must list the same ids (GOOGLE_CLIENT_ID*), it rejects tokens
 * issued for any other client.
 */
function env(value: string | undefined) {
  return value && value.trim() ? value.trim() : undefined;
}

const fallbackClientId = env(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID);
const googleClientIds = {
  androidClientId: env(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID) ?? fallbackClientId,
  iosClientId: env(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS) ?? fallbackClientId,
  webClientId: env(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB) ?? fallbackClientId,
};

const platformClientId = Platform.select({
  ios: googleClientIds.iosClientId,
  android: googleClientIds.androidClientId,
  default: googleClientIds.webClientId,
});

export const GOOGLE_NOT_CONFIGURED_MESSAGE =
  'Connexion Google non configurée : définissez EXPO_PUBLIC_GOOGLE_CLIENT_ID (ou la variante ' +
  `${Platform.OS === 'ios' ? '_IOS' : Platform.OS === 'android' ? '_ANDROID' : '_WEB'}) dans App/.env, puis relancez l’application.`;

export const isGoogleConfigured = Boolean(platformClientId);

export interface GoogleAuthRenderProps {
  /** Opens the Google sign-in flow (or reports that it is not configured). */
  prompt: () => void;
  /** False while the request is loading or a sign-in is in progress. */
  ready: boolean;
  configured: boolean;
}

interface GoogleAuthProps {
  /** Receives the Google ID token, to send to the API (/auth/google or /auth/link-google). */
  onIdToken: (idToken: string) => void | Promise<void>;
  onError: (message: string) => void;
  children: (props: GoogleAuthRenderProps) => React.ReactNode;
}

/**
 * Real Google sign-in through expo-auth-session. Renders `children` with a
 * `prompt` callback; when no client id is configured for this platform, `prompt`
 * only reports it (the auth hook throws without a client id, so it is not mounted).
 */
export function GoogleAuth({ onIdToken, onError, children }: GoogleAuthProps) {
  if (!isGoogleConfigured) {
    return <>{children({ prompt: () => onError(GOOGLE_NOT_CONFIGURED_MESSAGE), ready: true, configured: false })}</>;
  }
  return (
    <ConfiguredGoogleAuth onIdToken={onIdToken} onError={onError}>
      {children}
    </ConfiguredGoogleAuth>
  );
}

function ConfiguredGoogleAuth({ onIdToken, onError, children }: GoogleAuthProps) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    ...googleClientIds,
    selectAccount: true,
  });
  const [busy, setBusy] = useState(false);
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;

    if (response.type === 'success') {
      const idToken = response.params?.id_token || response.authentication?.idToken;
      if (!idToken) {
        setBusy(false);
        onError('Google n’a pas renvoyé de jeton d’identité.');
        return;
      }
      Promise.resolve(onIdToken(idToken)).finally(() => setBusy(false));
    } else {
      setBusy(false);
      if (response.type === 'error') {
        onError(response.error?.message || 'Erreur lors de la connexion Google.');
      }
    }
  }, [response, onIdToken, onError]);

  const prompt = () => {
    if (!request) return;
    setBusy(true);
    promptAsync().catch((err: unknown) => {
      setBusy(false);
      onError(err instanceof Error ? err.message : 'Impossible d’ouvrir la connexion Google.');
    });
  };

  return <>{children({ prompt, ready: Boolean(request) && !busy, configured: true })}</>;
}

/**
 * True only in development builds when the API has the simulated Google login
 * enabled (ALLOW_DEV_OAUTH=true, never in production).
 */
export function useDevOAuthAvailable() {
  const { apiFetch, backendUrl } = useApiConfig();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!__DEV__) return;
    let cancelled = false;
    apiFetch('/api/auth/providers')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setAvailable(Boolean(data?.devOAuth));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-check when the backend address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  return __DEV__ && available;
}
