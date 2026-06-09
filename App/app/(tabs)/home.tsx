import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

type DeezerTrack = {
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
  const [tracks, setTracks] = useState<DeezerTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDiscover() {
      try {
        const response = await fetch('http://localhost:3000/api/deezer/discover');
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
      <Text style={styles.title}>Populaire du moment</Text>

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id.toString()}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <Image
              source={{ uri: item.album.cover_medium }}
              style={styles.cover}
            />

            <Text style={styles.trackTitle} numberOfLines={1}>
              {item.title}
            </Text>

            <Text style={styles.artistName} numberOfLines={1}>
              {item.artist.name}
            </Text>
          </Pressable>
        )}
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
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
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
  cover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    marginBottom: 10,
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