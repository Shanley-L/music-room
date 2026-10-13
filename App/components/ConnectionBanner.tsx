import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSocket } from '../contexts/SocketContext';

/** Shows the realtime connection state when it is not live (hidden when connected). */
export function ConnectionBanner() {
  const { status } = useSocket();

  if (status === 'connected' || status === 'idle') return null;

  const unauthorized = status === 'unauthorized';
  const label = unauthorized
    ? 'Temps réel indisponible (session expirée)'
    : status === 'connecting'
      ? 'Connexion au temps réel…'
      : 'Reconnexion…';

  return (
    <View style={[styles.banner, unauthorized && styles.error]}>
      {unauthorized ? (
        <Ionicons name="cloud-offline-outline" size={14} color="#fca5a5" />
      ) : (
        <ActivityIndicator size="small" color="#f59e0b" />
      )}
      <Text style={[styles.text, unauthorized && styles.errorText]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2d1f05',
    borderColor: '#78350f',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    marginBottom: 10,
  },
  error: {
    backgroundColor: '#2a1215',
    borderColor: '#7f1d1d',
  },
  text: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: '#fca5a5',
  },
});
