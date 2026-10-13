import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** A failed load: the message and a retry button. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.box}>
      <Ionicons name="cloud-offline-outline" size={36} color="#fca5a5" />
      <Text style={styles.message}>{message}</Text>
      <Pressable
        style={styles.button}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Réessayer"
      >
        <Text style={styles.buttonText}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    gap: 12,
  },
  message: {
    color: '#fca5a5',
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#652edc',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
