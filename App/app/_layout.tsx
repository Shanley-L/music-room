import { Slot } from 'expo-router';
import { AudioProvider } from '../contexts/AudioContext';

export default function RootLayout() {
  return (
    <AudioProvider>
      <Slot />
    </AudioProvider>
  );
}