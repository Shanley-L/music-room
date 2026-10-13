import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApiConfig, addTokenRefreshListener } from './ApiConfigContext';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  friendsInfo?: string;
  privateInfo?: string;
  musicPreferences?: string;
  isEmailVerified?: boolean;
  googleId?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; emailVerificationRequired?: boolean; email?: string }>;
  register: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string; user?: User; accessToken?: string; refreshToken?: string }>;
  logout: () => Promise<void>;
  oauthLogin: (provider: 'google', name?: string, email?: string) => Promise<{ success: boolean; error?: string }>;
  googleLogin: (token?: string, idToken?: string) => Promise<{ success: boolean; error?: string }>;
  verifyEmail: (code: string, email?: string) => Promise<{ success: boolean; error?: string }>;
  forgotPassword: (email: string) => Promise<{ success: boolean; error?: string; resetCode?: string }>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (data: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  linkOAuth: (provider: 'google', providerId: string) => Promise<{ success: boolean; error?: string }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

const TOKEN_KEY = '@musicroom_access_token';
const REFRESH_TOKEN_KEY = '@musicroom_refresh_token';
const USER_KEY = '@musicroom_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { apiFetch } = useApiConfig();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    loadStoredAuth();

    const unsubscribe = addTokenRefreshListener((newToken) => {
      if (newToken) {
        setToken(newToken);
      } else {
        setToken(null);
        setUser(null);
      }
    });

    return unsubscribe;
  }, []);

  const loadStoredAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
      const storedUser = await AsyncStorage.getItem(USER_KEY);

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        // Silently fetch fresh profile (will transparently refresh if expired)
        fetchMe(storedToken);
      }
    } catch (e) {
      console.error('Failed to load auth from storage', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMe = async (authToken?: string) => {
    try {
      const res = await apiFetch('/api/users/me', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (res.ok) {
        const freshUser = await res.json();
        setUser(freshUser);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
      } else if (res.status === 401) {
        // If refresh failed and still 401, clear stale state
        setUser(null);
        setToken(null);
        await AsyncStorage.removeItem(TOKEN_KEY);
        await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
        await AsyncStorage.removeItem(USER_KEY);
      }
    } catch (e) {
      // offline or server restarting
    }
  };

  const saveSession = async (newToken: string, newRefreshToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    await AsyncStorage.setItem(TOKEN_KEY, newToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser));
  };

  const login = async (email: string, password: string) => {
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Erreur lors de la connexion',
          emailVerificationRequired: data.emailVerificationRequired || false,
          email: data.email || email,
        };
      }

      await saveSession(data.accessToken, data.refreshToken, data.user);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Impossible de joindre le serveur' };
    }
  };

  const register = async (email: string, password: string, name: string) => {
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || 'Erreur lors de l’inscription' };
      }

      // Do NOT log in immediately: email verification is mandatory
      return {
        success: true,
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Impossible de joindre le serveur' };
    }
  };

  const oauthLogin = async (provider: 'google', mockName?: string, mockEmail?: string) => {
    try {
      // Generated OAuth ID simulation for dev / cross-platform test
      const providerId = `${provider}_id_${Date.now().toString(36)}`;
      const name = mockName || 'Google Explorer';
      const email = mockEmail || `${provider}_${Date.now()}@musicroom.social`;

      const res = await apiFetch('/api/auth/oauth', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          providerId,
          email,
          name,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || 'Erreur OAuth' };
      }

      await saveSession(data.accessToken, data.refreshToken, data.user);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Impossible de joindre le serveur' };
    }
  };

  const googleLogin = async (googleAccessToken?: string, googleIdToken?: string) => {
    try {
      const res = await apiFetch('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({
          token: googleAccessToken,
          idToken: googleIdToken,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || 'Erreur Google Auth' };
      }

      await saveSession(data.accessToken, data.refreshToken, data.user);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Impossible de joindre le serveur' };
    }
  };

  const logout = async () => {
    try {
      const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      await apiFetch('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch (e) {
      // ignore
    } finally {
      setUser(null);
      setToken(null);
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
      await AsyncStorage.removeItem(USER_KEY);
    }
  };

  const verifyEmail = async (code: string, targetEmail?: string) => {
    const emailToVerify = targetEmail || user?.email;
    if (!emailToVerify) return { success: false, error: 'Email manquant' };
    try {
      const res = await apiFetch('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email: emailToVerify, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Code invalide' };
      }
      if (user) {
        await fetchMe();
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const forgotPassword = async (email: string) => {
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      return { success: true, resetCode: data.resetCode };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const resetPassword = async (email: string, code: string, newPassword: string) => {
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, resetCode: code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const updateProfile = async (data: Partial<User>) => {
    try {
      const res = await apiFetch('/api/users/me', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      const updated = await res.json();
      if (!res.ok) return { success: false, error: updated.error };
      setUser(updated);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const linkOAuth = async (provider: 'google', providerId: string) => {
    try {
      const res = await apiFetch('/api/auth/link-oauth', {
        method: 'POST',
        body: JSON.stringify({ provider, providerId }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error };
      setUser(data.user);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const refreshProfile = async () => {
    await fetchMe();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        logout,
        oauthLogin,
        googleLogin,
        verifyEmail,
        forgotPassword,
        resetPassword,
        updateProfile,
        linkOAuth,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
