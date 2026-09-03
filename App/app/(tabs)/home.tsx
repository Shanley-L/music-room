import { useEffect, useState } from 'react';
import { useAudio } from '../../contexts/AudioContext';
import { AddToPlaylistModal } from '../../components/AddToPlaylistModal';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getApiBaseUrl } from '../../lib/apiConfig';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

export type DeezerTrack = {
  id: number;
  title: string;
  preview: string;
  artist: {
    name: string;
    picture_medium: string;
  };
  album: {
    title: string;
    cover_medium: string;
  };
};

export default function HomeScreen() {
  const router = useRouter();
  const [tracks, setTracks] = useState<DeezerTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<DeezerTrack | null>(null);

  const { currentTrack, playTrack } = useAudio();

  useEffect(() => {
    async function loadDiscover() {
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/deezer/discover`);
        const json = await response.json();
        setTracks(json.response?.tracks?.data || []);
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    }

    loadDiscover();
  }, []);

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Populaire du moment</Text>

      <Pressable
        style={styles.createEventButton}
        onPress={() => router.push('/event/new')}
        accessibilityRole="button"
        accessibilityLabel="Créer un événement"
      >
        <Ionicons
          name="add-circle"
          size={20}
          color="#fff"
          style={{ marginRight: 6 }}
        />
        <Text style={styles.createEventButtonText}>Créer un événement</Text>
      </Pressable>

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id.toString()}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[
          styles.listContent,
          currentTrack && { paddingBottom: 90 },
        ]}
        renderItem={({ item }) => (
          <Pressable onPress={() => playTrack(item)} style={styles.card}>
            <View style={styles.coverWrapper}>
              <Image
                source={{ uri: item.album.cover_medium }}
                style={styles.cover}
              />
              <Pressable
                style={styles.addToPlaylistBtn}
                onPress={() => setSelectedTrackForPlaylist(item)}
                hitSlop={6}
              >
                <Ionicons name="add" size={16} color="#fff" />
              </Pressable>
            </View>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.artistName} numberOfLines={1}>
              {item.artist.name}
            </Text>
          </Pressable>
        )}
      />

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
  loaderContainer: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  createEventButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#652edc',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  createEventButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  card: {
    width: '48%',
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 12,
  },
  coverWrapper: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
    marginBottom: 10,
  },
  cover: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  addToPlaylistBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  trackTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  artistName: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 4,
  },
});