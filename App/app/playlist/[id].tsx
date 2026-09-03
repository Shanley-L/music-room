import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudio } from '../../contexts/AudioContext';
import { MediaController } from '../../components/mediaController';
import { DeezerTrack } from '../(tabs)/home';
import { getApiBaseUrl } from '../../lib/apiConfig';

export type PlaylistTrackItem = {
  id: string;
  externalId: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  preview: string | null;
  duration: number | null;
  position: number;
  addedBy: string;
};

export type PlaylistDetail = {
  id: string;
  name: string;
  description: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  license: 'EVERYONE' | 'INVITED_ONLY';
  inviteCode: string | null;
  coverUrl: string | null;
  version: number;
  tracks: PlaylistTrackItem[];
  createdAt: string;
};

export default function PlaylistEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(true);

  // Global Audio Playback
  const { currentTrack, isPlaying, playTrack, togglePlay } = useAudio();

  // Add Track Search Modal
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DeezerTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Loading state for reordering
  const [reordering, setReordering] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchPlaylist = useCallback(async () => {
    if (!id) return;
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/playlists/${id}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Impossible de charger la playlist');
      }

      setPlaylist(data.playlist);
      setCanEdit(data.canEdit ?? true);
    } catch (error: any) {
      console.log('Error loading playlist:', error);
      Alert.alert('Erreur', error.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchPlaylist();
  }, [fetchPlaylist]);

  const playSong = (track: PlaylistTrackItem) => {
    const deezerTrack: DeezerTrack = {
      id: Number(track.externalId) || 0,
      title: track.title,
      preview: track.preview || '',
      artist: {
        name: track.artist,
        picture_medium: '',
      },
      album: {
        title: track.album || '',
        cover_medium: track.coverUrl || '',
      },
    };

    playTrack(deezerTrack);
  };


  // Search Deezer Tracks
  const performSearch = async (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/deezer/search?q=${encodeURIComponent(term.trim())}`
      );
      const json = await res.json();
      setSearchResults(json.results || []);
    } catch (err) {
      console.log('Search error:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(text);
    }, 400);
  };

  // Add track to playlist
  const handleAddTrack = async (track: DeezerTrack) => {
    if (!id) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/playlists/${id}/tracks`, {
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
        throw new Error(data.error || "Erreur lors de l'ajout");
      }

      // Refresh playlist
      fetchPlaylist();
      setSearchModalVisible(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err: any) {
      if (Platform.OS === 'web') {
        window.alert(err.message || "Impossible d'ajouter le titre");
      } else {
        Alert.alert('Information', err.message || "Impossible d'ajouter le titre");
      }
    }
  };


  // Remove track
  const handleRemoveTrack = async (trackId: string) => {
    if (!id) return;
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/playlists/${id}/tracks/${trackId}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur de suppression');
      }

      fetchPlaylist();
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de supprimer');
    }
  };

  // Move track position (Reordering with optimistic concurrency check)
  const handleMoveTrack = async (index: number, direction: 'UP' | 'DOWN') => {
    if (!playlist || reordering) return;

    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= playlist.tracks.length) return;

    const newTracks = [...playlist.tracks];
    const [moved] = newTracks.splice(index, 1);
    newTracks.splice(targetIndex, 0, moved);

    // Optimistic UI update
    setPlaylist({
      ...playlist,
      tracks: newTracks.map((t, idx) => ({ ...t, position: idx })),
    });

    setReordering(true);
    try {
      const trackIds = newTracks.map((t) => t.id);
      const res = await fetch(
        `${getApiBaseUrl()}/api/playlists/${id}/tracks/reorder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackIds,
            expectedVersion: playlist.version,
          }),
        }
      );

      const data = await res.json();
      if (res.status === 409) {
        // Concurrency conflict detected!
        Alert.alert(
          'Conflit détecté',
          'Cette playlist a été modifiée par un autre utilisateur. Les données ont été actualisées.',
          [{ text: 'OK', onPress: () => fetchPlaylist() }]
        );
      } else if (!res.ok) {
        throw new Error(data.error || 'Erreur lors de la réorganisation');
      } else {
        setPlaylist((prev) => (prev ? { ...prev, version: data.version } : null));
      }
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Erreur de synchronisation');
      fetchPlaylist();
    } finally {
      setReordering(false);
    }
  };

  const handleShareInvite = async () => {
    if (!playlist?.inviteCode) return;
    const message = `Rejoins ma playlist "${playlist.name}" sur Music Room avec le code d'invitation : ${playlist.inviteCode}`;

    if (Platform.OS === 'web') {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(playlist.inviteCode);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } else {
          Alert.alert("Code d'invitation", `Code : ${playlist.inviteCode}`);
        }
      } catch (err) {
        Alert.alert("Code d'invitation", `Code : ${playlist.inviteCode}`);
      }
    } else {
      try {
        await Share.share({ message });
      } catch (err) {
        console.log('Share error:', err);
      }
    }
  };

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/playlists');
    }
  };

  const executeDelete = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/playlists/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Erreur lors de la suppression');
      }
      handleGoBack();
    } catch (err: any) {
      if (Platform.OS === 'web') {
        window.alert(err.message || 'Impossible de supprimer la playlist');
      } else {
        Alert.alert('Erreur', err.message || 'Impossible de supprimer la playlist');
      }
    }
  };

  const handleDeletePlaylist = () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Êtes-vous sûr de vouloir supprimer la playlist "${playlist?.name}" ?`)) {
        executeDelete();
      }
    } else {
      Alert.alert(
        'Supprimer la playlist',
        `Êtes-vous sûr de vouloir supprimer "${playlist?.name}" ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Supprimer',
            style: 'destructive',
            onPress: executeDelete,
          },
        ]
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#652edc" />
      </View>
    );
  }

  if (!playlist) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Playlist introuvable</Text>
        <Pressable style={styles.backBtn} onPress={handleGoBack}>
          <Text style={styles.backBtnText}>Retour aux playlists</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Navigation */}
      <View style={styles.navBar}>
        <Pressable
          onPress={handleGoBack}
          hitSlop={10}
          style={styles.navIconBtn}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>


        <View style={styles.navActions}>
          {playlist.visibility === 'PRIVATE' && playlist.inviteCode && (
            <Pressable
              onPress={handleShareInvite}
              hitSlop={8}
              style={[styles.codeButton, copied && { borderColor: '#10b981', backgroundColor: '#0d281e' }]}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'key'}
                size={14}
                color={copied ? '#10b981' : '#f59e0b'}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.codeButtonText,
                  copied && { color: '#10b981' },
                ]}
              >
                {copied ? 'Copié !' : playlist.inviteCode}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleDeletePlaylist}
            hitSlop={10}
            style={styles.navIconBtn}
          >
            <Ionicons name="trash-outline" size={20} color="#e11d48" />
          </Pressable>
        </View>
      </View>


      {/* Playlist Header Info */}
      <View style={styles.headerInfo}>
        {playlist.coverUrl ? (
          <Image source={{ uri: playlist.coverUrl }} style={styles.playlistCover} />
        ) : (
          <View style={styles.placeholderCover}>
            <Ionicons name="musical-notes" size={36} color="#652edc" />
          </View>
        )}

        <View style={styles.headerDetails}>
          <Text style={styles.playlistTitle} numberOfLines={2}>
            {playlist.name}
          </Text>
          {playlist.description ? (
            <Text style={styles.playlistDesc} numberOfLines={2}>
              {playlist.description}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            <View
              style={[
                styles.badge,
                playlist.visibility === 'PRIVATE'
                  ? styles.privateBadge
                  : styles.publicBadge,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  {
                    color:
                      playlist.visibility === 'PRIVATE' ? '#f59e0b' : '#10b981',
                  },
                ]}
              >
                {playlist.visibility === 'PRIVATE' ? '🔒 Privée' : '🌐 Publique'}
              </Text>
            </View>

            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {playlist.tracks.length}{' '}
                {playlist.tracks.length > 1 ? 'titres' : 'titre'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Add Track Action Bar */}
      {canEdit && (
        <Pressable
          style={styles.addTrackBar}
          onPress={() => setSearchModalVisible(true)}
        >
          <Ionicons name="add-circle" size={20} color="#652edc" />
          <Text style={styles.addTrackBarText}>Ajouter des titres</Text>
        </Pressable>
      )}

      {/* Tracks List */}
      <FlatList
        data={playlist.tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          currentTrack && { paddingBottom: 90 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyTracks}>
            <Ionicons name="musical-note" size={44} color="#333" />
            <Text style={styles.emptyTracksTitle}>Playlist vide</Text>
            <Text style={styles.emptyTracksSub}>
              Ajoutez des morceaux depuis Deezer pour composer votre playlist
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isThisPlaying =
            currentTrack?.id === Number(item.externalId) && isPlaying;
          return (
            <View
              style={[
                styles.trackItem,
                currentTrack?.id === Number(item.externalId) &&
                  styles.activeTrackItem,
              ]}
            >
              <Text style={styles.positionIndex}>{index + 1}</Text>

              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.trackCover} />
              ) : (
                <View style={styles.trackCoverPlaceholder}>
                  <Ionicons name="musical-notes" size={16} color="#666" />
                </View>
              )}

              <Pressable
                style={styles.trackCenter}
                onPress={() => playSong(item)}
              >
                <Text style={styles.trackItemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.trackItemArtist} numberOfLines={1}>
                  {item.artist}
                </Text>
              </Pressable>

              {/* Play preview button */}
              <Pressable
                onPress={() => playSong(item)}
                hitSlop={6}
                style={styles.actionIcon}
              >
                <Ionicons
                  name={isThisPlaying ? 'pause-circle' : 'play-circle-outline'}
                  size={24}
                  color={isThisPlaying ? '#652edc' : '#888'}
                />
              </Pressable>

              {/* Reordering and delete controls (if canEdit) */}
              {canEdit && (
                <View style={styles.orderActions}>
                  <Pressable
                    onPress={() => handleMoveTrack(index, 'UP')}
                    disabled={index === 0}
                    hitSlop={4}
                    style={{ opacity: index === 0 ? 0.2 : 1 }}
                  >
                    <Ionicons name="chevron-up" size={18} color="#aaa" />
                  </Pressable>

                  <Pressable
                    onPress={() => handleMoveTrack(index, 'DOWN')}
                    disabled={index === playlist.tracks.length - 1}
                    hitSlop={4}
                    style={{ opacity: index === playlist.tracks.length - 1 ? 0.2 : 1 }}
                  >
                    <Ionicons name="chevron-down" size={18} color="#aaa" />
                  </Pressable>

                  <Pressable
                    onPress={() => handleRemoveTrack(item.id)}
                    hitSlop={6}
                    style={{ marginLeft: 4 }}
                  >
                    <Ionicons name="close-circle-outline" size={18} color="#e11d48" />
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Floating Media Player */}
      {currentTrack && (
        <MediaController
          track={currentTrack}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
        />
      )}

      {/* ADD TRACK SEARCH MODAL */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalNav}>
            <Text style={styles.modalHeading}>Ajouter à la playlist</Text>
            <Pressable
              onPress={() => setSearchModalVisible(false)}
              hitSlop={8}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>

          {/* Search bar */}
          <View style={styles.modalSearchBar}>
            <Ionicons name="search" size={18} color="#888" style={{ marginRight: 8 }} />
            <TextInput
              placeholder="Rechercher sur Deezer..."
              placeholderTextColor="#777"
              value={searchQuery}
              onChangeText={handleSearchChange}
              style={styles.modalSearchInput}
              autoFocus
            />
          </View>

          {searching ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#652edc" />
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={{ padding: 16 }}
              renderItem={({ item }) => (
                <View style={styles.searchResultItem}>
                  <Image
                    source={{ uri: item.album.cover_medium }}
                    style={styles.resultCover}
                  />
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.resultArtist} numberOfLines={1}>
                      {item.artist.name}
                    </Text>
                  </View>

                  <Pressable
                    style={styles.addBtn}
                    onPress={() => handleAddTrack(item)}
                  >
                    <Ionicons name="add" size={20} color="#fff" />
                  </Pressable>
                </View>
              )}
            />
          )}
        </View>
      </Modal>
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
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  navIconBtn: {
    padding: 6,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  codeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#261b05',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#78350f',
  },
  codeButtonText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  playlistCover: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#282828',
  },
  placeholderCover: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#231c33',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#39255c',
  },
  headerDetails: {
    flex: 1,
    marginLeft: 14,
  },
  playlistTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  playlistDesc: {
    color: '#888',
    fontSize: 12,
    marginTop: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  badge: {
    backgroundColor: '#262626',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  publicBadge: { backgroundColor: '#0d281e' },
  privateBadge: { backgroundColor: '#2d1f05' },
  badgeText: {
    color: '#aaa',
    fontSize: 11,
    fontWeight: '600',
  },
  addTrackBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#241a3a',
    borderColor: '#652edc',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 14,
    gap: 6,
  },
  addTrackBarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
  },
  activeTrackItem: {
    backgroundColor: '#231838',
    borderColor: '#652edc',
    borderWidth: 1,
  },
  positionIndex: {
    color: '#555',
    fontSize: 12,
    fontWeight: '700',
    width: 22,
    textAlign: 'center',
  },
  trackCover: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  trackCoverPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#242424',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCenter: {
    flex: 1,
    marginLeft: 10,
    marginRight: 6,
  },
  trackItemTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  trackItemArtist: {
    color: '#777',
    fontSize: 11,
    marginTop: 2,
  },
  actionIcon: {
    padding: 4,
  },
  orderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
    gap: 2,
  },
  emptyTracks: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTracksTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyTracksSub: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  backBtn: {
    backgroundColor: '#652edc',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#141414',
    paddingTop: 20,
  },
  modalNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  modalHeading: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  modalSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#202020',
    borderRadius: 10,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#303030',
  },
  modalSearchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
  },
  resultCover: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  resultInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  resultTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  resultArtist: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#652edc',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
