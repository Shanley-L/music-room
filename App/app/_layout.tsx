import { Slot } from 'expo-router';
import { ApiConfigProvider } from '../contexts/ApiConfigContext';
import { AuthProvider } from '../contexts/AuthContext';
import { AudioProvider } from '../contexts/AudioContext';

export default function RootLayout() {
  return (
    <ApiConfigProvider>
      <AuthProvider>
        <AudioProvider>
          <Slot />
        </AudioProvider>
      </AuthProvider>
    </ApiConfigProvider>
  );
}