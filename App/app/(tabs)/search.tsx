import { View, Text, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SearchScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Recherche</Text>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#888" style={styles.searchIcon} />
        <TextInput
          placeholder="Artistes, titres, albums..."
          placeholderTextColor="#888"
          style={styles.searchInput}
          editable={true}
        />
      </View>

      <View style={styles.placeholderContainer}>
        <Ionicons name="musical-notes-outline" size={48} color="#444" />
        <Text style={styles.placeholderText}>Recherchez vos musiques préférées</Text>
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
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
  },
  placeholderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  placeholderText: {
    color: '#666',
    fontSize: 15,
  },
});
