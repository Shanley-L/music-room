import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudio } from '../../contexts/AudioContext';
import { AddToPlaylistModal } from '../../components/AddToPlaylistModal';
import { DeezerTrack } from './home';
import { getApiBaseUrl } from '../../lib/apiConfig';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DeezerTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<DeezerTrack | null>(null);

  const { currentTrack, isPlaying, playTrack } = useAudio();

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  const performSearch = async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/deezer/search?q=${encodeURIComponent(trimmed)}`
      );
      const json = await response.json();
      setResults(json.results || []);
    } catch (error) {
      console.log('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTextChange = (text: string) => {
    setQuery(text);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!text.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(text);
    }, 400);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Recherche</Text>

      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#888" style={styles.searchIcon} />
        <TextInput
          placeholder="Artistes, titres, albums..."
          placeholderTextColor="#777"
          value={query}
          onChangeText={handleTextChange}
          onSubmitEditing={() => performSearch(query)}
          returnKeyType="search"
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={handleClear} hitSlop={8} style={styles.clearButton}>
            <Ionicons name="close-circle" size={18} color="#888" />
          </Pressable>
        )}
      </View>

      {/* Loading state */}
      {loading && (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#652edc" />
        </View>
      )}

      {/* Results List */}
      {!loading && hasSearched && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[
            styles.listContent,
            currentTrack && { paddingBottom: 90 },
          ]}
          onScrollBeginDrag={Keyboard.dismiss}
          renderItem={({ item }) => {
            const isThisTrackPlaying = currentTrack?.id === item.id && isPlaying;
            return (
              <Pressable
                onPress={() => playSong(item)}
                style={({ pressed }) => [
                  styles.trackRow,
                  currentTrack?.id === item.id && styles.activeTrackRow,
                  pressed && styles.trackRowPressed,
                ]}
              >
                <Image
                  source={{ uri: item.album.cover_medium }}
                  style={styles.cover}
                />
                <View style={styles.trackInfo}>
                  <Text
                    style={[
                      styles.trackTitle,
                      currentTrack?.id === item.id && styles.activeTrackText,
                    ]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.artistName} numberOfLines={1}>
                    {item.artist.name} • {item.album.title}
                  </Text>
                </View>

                {/* Actions: Add to playlist + Play/Pause */}
                <View style={styles.actionsContainer}>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      setSelectedTrackForPlaylist(item);
                    }}
                    hitSlop={6}
                    style={styles.actionBtn}
                  >
                    <Ionicons name="add-circle-outline" size={24} color="#aaa" />
                  </Pressable>

                  <Pressable
                    onPress={() => playTrack(item)}
                    hitSlop={6}
                    style={styles.actionBtn}
                  >
                    <Ionicons
                      name={isThisTrackPlaying ? 'pause-circle' : 'play-circle-outline'}
                      size={28}
                      color={currentTrack?.id === item.id ? '#652edc' : '#888'}
                    />
                  </Pressable>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* No Results */}
      {!loading && hasSearched && results.length === 0 && (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#555" />
          <Text style={styles.emptyTitle}>Aucun résultat</Text>
          <Text style={styles.emptySubtitle}>
            Vérifiez l'orthographe ou essayez un autre mot-clé
          </Text>
        </View>
      )}

      {/* Initial Empty State */}
      {!loading && !hasSearched && (
        <View style={styles.centerContainer}>
          <Ionicons name="musical-notes-outline" size={56} color="#333" />
          <Text style={styles.initialTitle}>Trouvez votre musique</Text>
          <Text style={styles.initialSubtitle}>
            Explorez des millions de morceaux, d'artistes et d'albums sur Deezer
          </Text>
        </View>
      )}

      {/* Add To Playlist Modal */}
      <AddToPlaylistModal
        visible={!!selectedTrackForPlaylist}
        track={selectedTrackForPlaylist}
        onClose={() => setSelectedTrackForPlaylist(null)}
      />
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
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 0,
  },
  clearButton: {
    padding: 4,
  },
  listContent: {
    paddingBottom: 24,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  activeTrackRow: {
    backgroundColor: '#241a3a',
    borderColor: '#652edc',
    borderWidth: 1,
  },
  trackRowPressed: {
    opacity: 0.8,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#282828',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTrackText: {
    color: '#a77bf3',
  },
  artistName: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    padding: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 8,
  },
  emptySubtitle: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  initialTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
  },
  initialSubtitle: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});

