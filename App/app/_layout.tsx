import { Slot } from 'expo-router';
import { AuthProvider } from '../context/authContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Slot />
    </AuthProvider>
  );
}