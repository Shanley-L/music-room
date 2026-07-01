import React, { createContext, useState, useEffect, useContext } from 'react';
import { Platform } from 'react-native'; // 👈 Import Platform
import * as SecureStore from 'expo-secure-store'; 

// Helper abstraction to seamlessly toggle storage mechanisms based on the engine platform
const getAuthToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return localStorage.getItem('user_jwt');
  }
  return await SecureStore.getItemAsync('user_jwt');
};

const setAuthToken = async (token: string): Promise<void> => {
  if (Platform.OS === 'web') {
    localStorage.setItem('user_jwt', token);
    return;
  }
  await SecureStore.setItemAsync('user_jwt', token);
};

const deleteAuthToken = async (): Promise<void> => {
  if (Platform.OS === 'web') {
    localStorage.removeItem('user_jwt');
    return;
  }
  await SecureStore.deleteItemAsync('user_jwt');
};

/* Rest of your context code remains identical, but calls these unified helpers */
interface AuthContextType {
  token: string | null;
  isLoading: boolean;
  login: (userToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        const savedToken = await getAuthToken(); // 👈 Uses helper
        if (savedToken) setToken(savedToken);
      } catch (e) {
        console.error("Failed to restore token", e);
      } finally {
        setIsLoading(false);
      }
    };
    bootstrapAsync();
  }, []);

  const login = async (userToken: string) => {
    setToken(userToken);
    await setAuthToken(userToken); // 👈 Uses helper
  };

  const logout = async () => {
    setToken(null);
    await deleteAuthToken(); // 👈 Uses helper
  };

  return (
    <AuthContext.Provider value={{ token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};