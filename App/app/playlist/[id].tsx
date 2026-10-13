import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
  Platform,
  AppState,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudio, type QueueItem } from '../../contexts/AudioContext';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { useSocket, useSocketChannel } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { MediaController } from '../../components/mediaController';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { TrackSearchModal } from '../../components/TrackSearchModal';
import { InviteUserModal } from '../../components/InviteUserModal';
import { codeMessage, errorMessage, notify } from '../../utils/feedback';
import { DeezerTrack } from '../(tabs)/home';

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
  ownerId: string;
  invites?: { id: string; playlistId: string; userId: string; canEdit: boolean }[];
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
  const { currentTrack, currentKey, isPlaying, playTrack, togglePlay, updateQueue } = useAudio();
  const apiFetch = useAuthedFetch();
  const { status: socketStatus } = useSocket();
  const { user } = useAuth();
  const [inviteVisible, setInviteVisible] = useState(false);

  // Add Track Search Modal
  const [searchModalVisible, setSearchModalVisible] = useState(false);

  // Realtime: joined `playlist:<id>` on the current connection.
  const [joinedLive, setJoinedLive] = useState(false);
  const live = joinedLive && socketStatus === 'connected';
  // Bumped by every fetch start and socket snapshot: a fetch only applies its result
  // when nothing newer started or arrived in the meantime.
  const fetchSeq = useRef(0);
  const leaving = useRef(false);

  // Loading state for reordering
  const [reordering, setReordering] = useState(false);
  const [copied, setCopied] = useState(false);

  /** Deleted playlist or access lost (eviction): tell the user and go back to the list. */
  const leaveWithNotice = useCallback(
    (message: string) => {
      if (leaving.current) return;
      leaving.current = true;
      setPlaylist(null);
      notify('Playlist', message, () => {
        // Reset once the notice is closed: the next access problem may notify again.
        leaving.current = false;
        router.replace('/(tabs)/playlists');
      });
    },
    [router]
  );

  const fetchPlaylist = useCallback(async () => {
    if (!id) return;
    const seq = ++fetchSeq.current;
    try {
      const response = await apiFetch(`/api/playlists/${id}`);
      const data = await response.json().catch(() => ({}));

      if (response.status === 403 || response.status === 404) {
        // Private playlist without access (or deleted): nothing to show.
        leaveWithNotice(errorMessage(data, 'Accès non autorisé à cette playlist'));
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || 'Impossible de charger la playlist');
      }

      if (seq !== fetchSeq.current) return; // a newer state is on its way
      setPlaylist(data.playlist);
      setCanEdit(data.canEdit ?? true);
    } catch (error: any) {
      console.log('Error loading playlist:', error);
      Alert.alert('Erreur', error.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [id, apiFetch, leaveWithNotice]);

  useEffect(() => {
    fetchPlaylist();
  }, [fetchPlaylist]);

  // Back from background: events may have been missed (or access revoked meanwhile).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchPlaylist();
    });
    return () => sub.remove();
  }, [fetchPlaylist]);

  useSocketChannel('playlist', id, {
    onJoin: (ack) => {
      if (ack.ok) {
        setJoinedLive(true);
        // (Re)joined: only the server knows what changed while we were away.
        fetchPlaylist();
        return;
      }
      setJoinedLive(false);
      if (ack.code === 'PLAYLIST_FORBIDDEN' || ack.code === 'PLAYLIST_NOT_FOUND') {
        leaveWithNotice(codeMessage(ack.code, "Vous n'avez plus accès à cette playlist."));
      }
    },
    onEvent: (event, payload) => {
      switch (event) {
        case 'playlist:tracks-updated':
          if (Array.isArray(payload.tracks)) {
            // Full ordered list from the server: replace ours, then reload the
            // playlist for its new version (used by reorder) without waiting.
            fetchSeq.current += 1;
            setPlaylist((prev) => (prev ? { ...prev, tracks: payload.tracks } : prev));
            // Keep next / previous in sync when this playlist is the one being played.
            updateQueue(`playlist:${id}`, toQueue(payload.tracks));
            fetchPlaylist();
          }
          break;
        case 'playlist:updated':
          // Name, visibility, license...: refetch (edit rights and invite code depend on it).
          fetchPlaylist();
          break;
        case 'playlist:deleted':
          leaveWithNotice('Cette playlist a été supprimée.');
          break;
        case 'playlist:revoked':
          leaveWithNotice("Vous n'avez plus accès à cette playlist.");
          break;
      }
    },
  });

  /** Without the live channel a write is not echoed back: read the playlist again. */
  const syncAfterWrite = () => {
    if (!live) fetchPlaylist();
  };

  const toDeezerTrack = (track: PlaylistTrackItem): DeezerTrack => ({
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
  });

  const toQueue = (tracks: PlaylistTrackItem[]): QueueItem[] =>
    tracks.map((t) => ({ key: t.id, track: toDeezerTrack(t) }));

  const playSong = (track: PlaylistTrackItem) => {
    // The playlist is the queue that next / previous (and remote commands) move through.
    // Tracks are identified by their playlist track id (externalIds may not be numeric).
    playTrack(toDeezerTrack(track), {
      key: track.id,
      queue: toQueue(playlist?.tracks ?? [track]),
      queueId: `playlist:${id}`,
    });
  };


  // Add track to playlist
  const handleAddTrack = async (track: DeezerTrack) => {
    if (!id) return false;
    try {
      const res = await apiFetch(`/api/playlists/${id}/tracks`, {
        method: 'POST',
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

      syncAfterWrite();
      return true;
    } catch (err: any) {
      notify('Information', err.message || "Impossible d'ajouter le titre");
      return false;
    }
  };


  // Remove track
  const handleRemoveTrack = async (trackId: string) => {
    if (!id) return;
    try {
      const res = await apiFetch(
        `/api/playlists/${id}/tracks/${trackId}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur de suppression');
      }

      syncAfterWrite();
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
      const res = await apiFetch(
        `/api/playlists/${id}/tracks/reorder`,
        {
          method: 'PUT',
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
        syncAfterWrite();
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
    // Our own `playlist:deleted` echo (it may arrive before the response) must not
    // show the "deleted" notice.
    leaving.current = true;
    try {
      const res = await apiFetch(`/api/playlists/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de la suppression');
      }
      handleGoBack();
    } catch (err: any) {
      leaving.current = false;
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

  const isOwner = !!user && playlist.ownerId === user.id;

  return (
    <View style={styles.container}>
      {/* Top Navigation */}
      <View style={styles.navBar}>
        <Pressable
          onPress={handleGoBack}
            accessibilityRole="button"
            accessibilityLabel="Retour"
          hitSlop={10}
          style={styles.navIconBtn}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>


        <View style={styles.navActions}>
          {isOwner && (
            <Pressable
              onPress={() => setInviteVisible(true)}
              hitSlop={8}
              style={styles.inviteButton}
              accessibilityRole="button"
              accessibilityLabel="Inviter un utilisateur"
            >
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={styles.inviteButtonText}>
                Inviter{playlist.invites?.length ? ` (${playlist.invites.length})` : ''}
              </Text>
            </Pressable>
          )}
          {playlist.visibility === 'PRIVATE' && playlist.inviteCode && (
            <Pressable
              onPress={handleShareInvite}
            accessibilityRole="button"
            accessibilityLabel="Partager le code d'invitation"
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
            accessibilityRole="button"
            accessibilityLabel="Supprimer la playlist"
            hitSlop={10}
            style={styles.navIconBtn}
          >
            <Ionicons name="trash-outline" size={20} color="#e11d48" />
          </Pressable>
        </View>
      </View>


      <ConnectionBanner />

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
            currentKey === item.id && isPlaying;
          return (
            <View
              style={[
                styles.trackItem,
                currentKey === item.id &&
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
                accessibilityRole="button"
                accessibilityLabel={isThisPlaying ? `Mettre en pause ${item.title}` : `Écouter ${item.title}`}
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
            accessibilityRole="button"
            accessibilityLabel={`Monter ${item.title}`}
                    disabled={index === 0}
                    hitSlop={4}
                    style={{ opacity: index === 0 ? 0.2 : 1 }}
                  >
                    <Ionicons name="chevron-up" size={18} color="#aaa" />
                  </Pressable>

                  <Pressable
                    onPress={() => handleMoveTrack(index, 'DOWN')}
            accessibilityRole="button"
            accessibilityLabel={`Descendre ${item.title}`}
                    disabled={index === playlist.tracks.length - 1}
                    hitSlop={4}
                    style={{ opacity: index === playlist.tracks.length - 1 ? 0.2 : 1 }}
                  >
                    <Ionicons name="chevron-down" size={18} color="#aaa" />
                  </Pressable>

                  <Pressable
                    onPress={() => handleRemoveTrack(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${item.title}`}
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
      <TrackSearchModal
        visible={searchModalVisible}
        title="Ajouter à la playlist"
        onClose={() => setSearchModalVisible(false)}
        onPick={handleAddTrack}
      />

      {isOwner && (
        <InviteUserModal
          visible={inviteVisible}
          invitePath={`/api/playlists/${playlist.id}/invites`}
          invitedIds={playlist.invites?.map((i) => i.userId) ?? []}
          revokePath={(userId) => `/api/playlists/${playlist.id}/invites/${userId}`}
          onClose={() => setInviteVisible(false)}
          onInvited={fetchPlaylist}
        />
      )}
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
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#652edc',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  inviteButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
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
});
