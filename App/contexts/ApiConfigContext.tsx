import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type TokenRefreshListener = (token: string | null) => void;
const refreshListeners: TokenRefreshListener[] = [];

export const addTokenRefreshListener = (listener: TokenRefreshListener) => {
  refreshListeners.push(listener);
  return () => {
    const idx = refreshListeners.indexOf(listener);
    if (idx !== -1) refreshListeners.splice(idx, 1);
  };
};

const notifyTokenRefresh = (token: string | null) => {
  refreshListeners.forEach((fn) => {
    try {
      fn(token);
    } catch (e) {
      console.warn('Error in token refresh listener:', e);
    }
  });
};

let refreshPromise: Promise<string | null> | null = null;

export const refreshAuthToken = async (backendUrl: string): Promise<string | null> => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshToken = await AsyncStorage.getItem('@musicroom_refresh_token');
      if (!refreshToken) {
        notifyTokenRefresh(null);
        return null;
      }

      const res = await fetch(`${backendUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        // Refresh token invalid or revoked or expired
        await AsyncStorage.removeItem('@musicroom_access_token');
        await AsyncStorage.removeItem('@musicroom_refresh_token');
        await AsyncStorage.removeItem('@musicroom_user');
        notifyTokenRefresh(null);
        return null;
      }

      const data = await res.json();
      if (data.accessToken) {
        await AsyncStorage.setItem('@musicroom_access_token', data.accessToken);
        if (data.refreshToken) {
          await AsyncStorage.setItem('@musicroom_refresh_token', data.refreshToken);
        }
        notifyTokenRefresh(data.accessToken);
        return data.accessToken;
      }

      return null;
    } catch (err) {
      console.warn('[refreshAuthToken] Error during refresh:', err);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

interface ApiConfigContextType {
  backendUrl: string;
  setBackendUrl: (url: string) => Promise<void>;
  getApiUrl: (path: string) => string;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
}

const DEFAULT_BACKEND_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const STORAGE_KEY = '@musicroom_backend_url';

const ApiConfigContext = createContext<ApiConfigContextType>({
  backendUrl: DEFAULT_BACKEND_URL,
  setBackendUrl: async () => {},
  getApiUrl: (path: string) => path,
  apiFetch: async () => new Response(),
});

export const ApiConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [backendUrl, setBackendUrlState] = useState<string>(DEFAULT_BACKEND_URL);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) {
        setBackendUrlState(stored);
      }
    });
  }, []);

  const setBackendUrl = async (newUrl: string) => {
    let clean = newUrl.trim();
    if (clean.endsWith('/')) {
      clean = clean.slice(0, -1);
    }
    setBackendUrlState(clean);
    await AsyncStorage.setItem(STORAGE_KEY, clean);
  };

  const getApiUrl = (path: string) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${backendUrl}${cleanPath}`;
  };

  const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
    const fullUrl = getApiUrl(path);

    const token = await AsyncStorage.getItem('@musicroom_access_token');
    const deviceName = Constants.deviceName || (Platform.OS === 'web' ? 'Web Browser' : 'Mobile Device');
    const appVersion = Constants.expoConfig?.version || '1.0.0';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Platform': Platform.OS,
      'X-Device': deviceName,
      'X-App-Version': appVersion,
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response = await fetch(fullUrl, {
      ...options,
      headers,
    });

    // Transparent token refresh on 401 Token expiré (excluding auth routes)
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      const cloned = response.clone();
      const errBody = await cloned.json().catch(() => null);

      if (errBody && (errBody.error === 'Token expiré' || errBody.error?.toLowerCase().includes('expiré'))) {
        const newToken = await refreshAuthToken(backendUrl);

        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          response = await fetch(fullUrl, {
            ...options,
            headers,
          });
        }
      }
    }

    return response;
  };

  return (
    <ApiConfigContext.Provider value={{ backendUrl, setBackendUrl, getApiUrl, apiFetch }}>
      {children}
    </ApiConfigContext.Provider>
  );
};

export const useApiConfig = () => useContext(ApiConfigContext);
