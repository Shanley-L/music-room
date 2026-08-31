import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function PlaylistsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Playlists</Text>
        <Pressable style={styles.createButton}>
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.placeholderContainer}>
        <Ionicons name="albums-outline" size={48} color="#444" />
        <Text style={styles.placeholderText}>Aucune playlist pour le moment</Text>
        <Text style={styles.placeholderSubtext}>Créez ou rejoignez une playlist collaborative</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  createButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#652edc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  placeholderText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  placeholderSubtext: {
    color: '#666',
    fontSize: 13,
  },
});
