import { Slot } from 'expo-router';
import { ApiConfigProvider } from '../contexts/ApiConfigContext';
import { AuthProvider } from '../contexts/AuthContext';
import { AudioProvider } from '../contexts/AudioContext';
import { SocketProvider } from '../contexts/SocketContext';
import { DevicePlayerProvider } from '../contexts/DevicePlayerContext';

export default function RootLayout() {
  return (
    <ApiConfigProvider>
      <AuthProvider>
        <SocketProvider>
          <AudioProvider>
            <DevicePlayerProvider>
              <Slot />
            </DevicePlayerProvider>
          </AudioProvider>
        </SocketProvider>
      </AuthProvider>
    </ApiConfigProvider>
  );
}
