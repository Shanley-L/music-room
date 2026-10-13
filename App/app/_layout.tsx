import { Slot } from 'expo-router';
import { ApiConfigProvider } from '../contexts/ApiConfigContext';
import { AuthProvider } from '../contexts/AuthContext';
import { SocketProvider } from '../contexts/SocketContext';
import { AudioProvider } from '../contexts/AudioContext';

export default function RootLayout() {
  return (
    <ApiConfigProvider>
      <AuthProvider>
        <SocketProvider>
          <AudioProvider>
            <Slot />
          </AudioProvider>
        </SocketProvider>
      </AuthProvider>
    </ApiConfigProvider>
  );
}