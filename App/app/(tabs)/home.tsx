import { useState, useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAudio } from '../../contexts/AudioContext';
import { AddToPlaylistModal } from '../../components/AddToPlaylistModal';
import { Ionicons } from '@expo/vector-icons';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';

export type DeezerTrack = {
  id: number;
  title: string;
  preview: string;
  artist: { name: string; picture_medium: string; };
  album: { title: string; cover_medium: string; };
};

export default function HomeScreen() {
  const router = useRouter();
  const [userData, setUserData] = useState<{ email: string } | null>(null);
  const [tracks, setTracks] = useState<DeezerTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<DeezerTrack | null>(null);

  const { currentTrack, playTrack } = useAudio();

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function verifyAndLoad() {
        try {
          const token = Platform.OS === 'web' ? localStorage.getItem('music_room_token') : null;

          if (token) {
            const authResponse = await fetch('http://localhost:3000/api/users/me', {
              headers: { 'Authorization': `Bearer ${token}` }
            });

            if (authResponse.ok && isActive) {
              const authData = await authResponse.json();
              setUserData(authData.user);
            } else if (isActive) {
              if (Platform.OS === 'web') localStorage.removeItem('music_room_token');
              setUserData(null);
            }
          } else if (isActive) {
            setUserData(null);
          }

          if (tracks.length === 0) {
            const response = await fetch('http://localhost:3000/api/deezer/discover');
            const json = await response.json();
            if (isActive) setTracks(json.response?.tracks?.data || []);
          }

        } catch (error) {
          console.error('Home screen load error:', error);
        } finally {
          if (isActive) setLoading(false);
        }
      }

      verifyAndLoad();

      return () => {
        isActive = false;
      };
    }, [tracks.length])
  );

  const handleLogout = () => {
    if (Platform.OS === 'web') localStorage.removeItem('music_room_token');
    setUserData(null); 
  };

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      
      <View style={styles.topBar}>
        {userData ? (
          <>
            <View>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.emailText}>{userData.email}</Text>
            </View>
            <Pressable onPress={handleLogout} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={24} color="#fff" />
            </Pressable>
          </>
        ) : (
          <View style={styles.guestBar}>
            <Text style={styles.welcomeText}>Welcome to Music Room</Text>
            <Pressable onPress={() => router.push('/login')} style={styles.loginBtn}>
              <Text style={styles.loginBtnText}>Log In</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Text style={styles.headerTitle}>Populaire du moment</Text>

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
              {userData && (
                <Pressable
                  style={styles.addToPlaylistBtn}
                  onPress={() => setSelectedTrackForPlaylist(item)}
                  hitSlop={6}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                </Pressable>
              )}
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
    paddingTop: 40, 
    paddingHorizontal: 16,
  },
  loaderContainer: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: '#1e1e1e',
    padding: 12,
    borderRadius: 12,
  },
  guestBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flex: 1,
  },
  loginBtn: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  loginBtnText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  welcomeText: {
    color: '#aaa',
    fontSize: 12,
  },
  emailText: {
    color: '#1DB954',
    fontSize: 14,
    fontWeight: 'bold',
  },
  logoutBtn: {
    padding: 8,
  },
  headerTitle: {
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