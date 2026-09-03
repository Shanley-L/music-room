import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DeezerTrack } from '../app/(tabs)/home';
import { Playlist } from '../app/(tabs)/playlists';
import { getApiBaseUrl } from '../lib/apiConfig';

export function AddToPlaylistModal({
  visible,
  track,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  track: DeezerTrack | null;
  onClose: () => void;
  onSuccess?: (playlistName: string) => void;
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      fetch(`${getApiBaseUrl()}/api/playlists`)
        .then((res) => res.json())
        .then((data) => setPlaylists(data.playlists || []))
        .catch((err) => console.log('Error fetching playlists:', err))
        .finally(() => setLoading(false));
    }
  }, [visible]);

  const handleSelectPlaylist = async (playlist: Playlist) => {
    if (!track || addingId) return;

    setAddingId(playlist.id);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalId: track.id,
          title: track.title,
          artist: track.artist.name,
          album: track.album.title,
          coverUrl: track.album.cover_medium,
          preview: track.preview,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Impossible d'ajouter le titre");
      }

      if (onSuccess) {
        onSuccess(playlist.name);
      } else {
        const msg = `"${track.title}" a été ajouté à la playlist "${playlist.name}" !`;
        if (Platform.OS === 'web') {
          window.alert(msg);
        } else {
          Alert.alert('Succès', msg);
        }
      }

      onClose();
    } catch (err: any) {
      if (Platform.OS === 'web') {
        window.alert(err.message || "Erreur lors de l'ajout");
      } else {
        Alert.alert('Erreur', err.message || "Erreur lors de l'ajout");
      }
    } finally {
      setAddingId(null);
    }
  };

  if (!track) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Ajouter à une playlist</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#aaa" />
            </Pressable>
          </View>

          {/* Selected Track Preview */}
          <View style={styles.trackCard}>
            <Image
              source={{ uri: track.album.cover_medium }}
              style={styles.trackCover}
            />
            <View style={styles.trackDetails}>
              <Text style={styles.trackTitle} numberOfLines={1}>
                {track.title}
              </Text>
              <Text style={styles.trackArtist} numberOfLines={1}>
                {track.artist.name}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Sélectionnez une playlist :</Text>

          {/* Playlists List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#652edc" />
            </View>
          ) : playlists.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="albums-outline" size={40} color="#444" />
              <Text style={styles.emptyText}>Aucune playlist disponible</Text>
              <Text style={styles.emptySubtext}>
                Créez d'abord une playlist dans l'onglet Playlists
              </Text>
            </View>
          ) : (
            <FlatList
              data={playlists}
              keyExtractor={(item) => item.id}
              style={styles.list}
              renderItem={({ item }) => {
                const isThisAdding = addingId === item.id;
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.playlistRow,
                      pressed && styles.playlistRowPressed,
                    ]}
                    onPress={() => handleSelectPlaylist(item)}
                    disabled={isThisAdding}
                  >
                    {item.coverUrl ? (
                      <Image
                        source={{ uri: item.coverUrl }}
                        style={styles.playlistCover}
                      />
                    ) : (
                      <View style={styles.playlistPlaceholderCover}>
                        <Ionicons
                          name="musical-notes"
                          size={18}
                          color="#652edc"
                        />
                      </View>
                    )}

                    <View style={styles.playlistInfo}>
                      <Text style={styles.playlistName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.playlistMeta}>
                        {item.trackCount}{' '}
                        {item.trackCount > 1 ? 'titres' : 'titre'} •{' '}
                        {item.visibility === 'PRIVATE' ? '🔒 Privée' : '🌐 Publique'}
                      </Text>
                    </View>

                    <View style={styles.addIconBtn}>
                      {isThisAdding ? (
                        <ActivityIndicator size="small" color="#652edc" />
                      ) : (
                        <Ionicons
                          name="add-circle-outline"
                          size={24}
                          color="#652edc"
                        />
                      )}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '75%',
    borderTopWidth: 1,
    borderTopColor: '#2d2d2d',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#242424',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  trackCover: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  trackDetails: {
    flex: 1,
    marginLeft: 12,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  trackArtist: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 2,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  list: {
    maxHeight: 280,
  },
  loadingContainer: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#777',
    fontSize: 12,
    textAlign: 'center',
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  playlistRowPressed: {
    backgroundColor: '#2a203a',
  },
  playlistCover: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  playlistPlaceholderCover: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#2a1e3a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  playlistName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  playlistMeta: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  addIconBtn: {
    padding: 4,
  },
});
