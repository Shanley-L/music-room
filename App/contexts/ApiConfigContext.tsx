import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

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

  const apiFetch = async (path: string, options: RequestInit = {}) => {
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

    return fetch(fullUrl, {
      ...options,
      headers,
    });
  };

  return (
    <ApiConfigContext.Provider value={{ backendUrl, setBackendUrl, getApiUrl, apiFetch }}>
      {children}
    </ApiConfigContext.Provider>
  );
};

export const useApiConfig = () => useContext(ApiConfigContext);
