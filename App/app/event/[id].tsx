import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Share,
  Platform,
  AppState,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket, useSocketChannel } from '../../contexts/SocketContext';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { TrackSearchModal } from '../../components/TrackSearchModal';
import { InviteUserModal } from '../../components/InviteUserModal';
import { NowPlayingBar } from '../../components/NowPlayingBar';
import { EditRoomModal } from '../../components/EditRoomModal';
import { codeMessage, confirmAction, errorMessage, notify } from '../../utils/feedback';
import { LoadError } from '../../components/LoadError';
import { LICENSE_LABELS, PlaybackState, ROLE_LABELS, Room, RoomTrack } from '../../types/room';
import type { DeezerTrack } from '../(tabs)/home';

// A `vote:changed` echo of my own vote arrives within this delay of the response.
const LOCAL_ECHO_MS = 2000;
const VOTE_REFETCH_DELAY_MS = 500;
const LOCATION_TIMEOUT_MS = 10000;

function votedIn(tracks: RoomTrack[]) {
  return new Set(tracks.filter((t) => t.hasVoted).map((t) => t.id));
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventVoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const apiFetch = useAuthedFetch();
  const { user } = useAuth();
  const { status } = useSocket();

  const [room, setRoom] = useState<Room | null>(null);
  const [queue, setQueue] = useState<RoomTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinedLive, setJoinedLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tracks I voted for, from the server's per-user `hasVoted` (REST only: the shared
  // `queue:updated` broadcast does not carry it, so it is kept between snapshots).
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [playbackReceivedAt, setPlaybackReceivedAt] = useState(0);
  const [editVisible, setEditVisible] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const [suggestVisible, setSuggestVisible] = useState(false);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  // Bumped by every queue snapshot (fetch start or socket event): a fetch only applies
  // its result if nothing newer started or arrived in the meantime.
  const queueSeq = useRef(0);
  const leaving = useRef(false);
  // My own votes in flight (or just answered): their `vote:changed` echo needs no refetch.
  const localVotes = useRef(new Map<string, number>());
  const voteRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const live = joinedLive && status === 'connected';
  const isOwner = !!room && !!user && room.ownerId === user.id;
  const permissions = room?.permissions;
  const voteBlocked = permissions ? !permissions.canVote : false;
  const role = room?.myRole ?? (isOwner ? 'OWNER' : 'MEMBER');

  const leaveWithNotice = useCallback(
    (message: string) => {
      if (leaving.current) return;
      leaving.current = true;
      notify('Événement', message, () => {
        // Reset once the notice is closed: the next access problem may notify again.
        leaving.current = false;
        router.replace('/(tabs)/events');
      });
    },
    [router]
  );

  const fetchRoom = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/api/rooms/${id}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 || res.status === 404) {
        leaveWithNotice(errorMessage(data, "Vous n'avez pas accès à cet événement."));
        return;
      }
      if (!res.ok) throw new Error(errorMessage(data, "Impossible de charger l'événement"));
      setRoom(data);
      setLoadError(null);
    } catch (err: any) {
      console.log('Error loading room:', err);
      setLoadError(err?.message || "Impossible de charger l'événement");
    }
  }, [id, apiFetch, leaveWithNotice]);

  const fetchQueue = useCallback(async () => {
    if (!id) return;
    const seq = ++queueSeq.current;
    try {
      const res = await apiFetch(`/api/rooms/${id}/tracks`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 || res.status === 404) {
        leaveWithNotice(errorMessage(data, "Vous n'avez pas accès à cet événement."));
        return;
      }
      if (!res.ok) throw new Error(errorMessage(data, 'Impossible de charger la file'));
      if (seq === queueSeq.current && Array.isArray(data)) {
        setQueue(data);
        setMyVotes(votedIn(data));
      }
    } catch (err: any) {
      console.log('Error loading queue:', err);
    }
  }, [id, apiFetch, leaveWithNotice]);

  /** Applies a server playback state unless a newer one was already applied. */
  const applyPlayback = useCallback((state: PlaybackState | null | undefined) => {
    if (!state || typeof state.serverTime !== 'string') return;
    setPlayback((prev) => {
      if (prev && Date.parse(prev.serverTime) > Date.parse(state.serverTime)) return prev;
      setPlaybackReceivedAt(Date.now());
      return state;
    });
  }, []);

  const fetchPlayback = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/api/rooms/${id}/playback`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) applyPlayback(data);
    } catch (err) {
      console.log('Error loading playback:', err);
    }
  }, [id, apiFetch, applyPlayback]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchRoom(), fetchQueue(), fetchPlayback()]);
    setLoading(false);
  }, [fetchRoom, fetchQueue, fetchPlayback]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(
    () => () => {
      if (voteRefetchTimer.current) clearTimeout(voteRefetchTimer.current);
    },
    []
  );

  // Back from background: the socket may have missed events (or access was revoked).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAll();
    });
    return () => sub.remove();
  }, [refreshAll]);

  const setVoted = (trackId: string, voted: boolean) => {
    setMyVotes((prev) => {
      if (prev.has(trackId) === voted) return prev;
      const next = new Set(prev);
      if (voted) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
  };

  useSocketChannel('room', id, {
    onJoin: (ack) => {
      if (ack.ok) {
        applyPlayback(ack.playback);
        setJoinedLive(true);
        setLiveError(null);
        // (Re)joined: whatever happened while away is only known by the server.
        refreshAll();
        return;
      }
      setJoinedLive(false);
      if (ack.code === 'ROOM_FORBIDDEN' || ack.code === 'ROOM_NOT_FOUND') {
        leaveWithNotice(codeMessage(ack.code, "Vous n'avez plus accès à cet événement."));
      } else {
        setLiveError(codeMessage(ack.code, 'Mises à jour en direct indisponibles.'));
      }
    },
    onEvent: (event, payload) => {
      switch (event) {
        case 'queue:updated':
          if (Array.isArray(payload.queue)) {
            queueSeq.current += 1;
            const queueIds = new Set((payload.queue as RoomTrack[]).map((t) => t.id));
            setQueue(payload.queue);
            // No `hasVoted` here: keep my votes, minus tracks gone from the queue.
            setMyVotes((prev) => {
              const next = new Set([...prev].filter((trackId) => queueIds.has(trackId)));
              return next.size === prev.size ? prev : next;
            });
          }
          break;
        case 'playback:updated':
          applyPlayback(payload as PlaybackState);
          break;
        case 'room:updated':
          // Settings, roles or permissions may have changed: they are per user, reread.
          fetchRoom();
          break;
        case 'vote:changed': {
          // A vote not made from this screen (maybe mine from another device): reread
          // the queue for `hasVoted`, at most once per burst.
          const localUntil = localVotes.current.get(payload.trackId) ?? 0;
          if (localUntil > Date.now()) break;
          if (voteRefetchTimer.current) clearTimeout(voteRefetchTimer.current);
          voteRefetchTimer.current = setTimeout(() => {
            voteRefetchTimer.current = null;
            fetchQueue();
          }, VOTE_REFETCH_DELAY_MS);
          break;
        }
        case 'track:removed':
          setVoted(payload.trackId, false);
          break;
        case 'room:deleted':
          leaveWithNotice('Cet événement a été supprimé.');
          break;
        case 'room:revoked':
          leaveWithNotice("Vous n'avez plus accès à cet événement.");
          break;
      }
    },
  });

  const controlPlayback = useCallback(
    async (action: 'play' | 'pause' | 'resume' | 'skip') => {
      try {
        const res = await apiFetch(`/api/rooms/${id}/playback/${action}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) applyPlayback(data);
        else notify('Lecture', errorMessage(data, 'Action impossible'));
      } catch (err: any) {
        notify('Lecture', err?.message || 'Action impossible');
      }
    },
    [id, apiFetch, applyPlayback]
  );

  const reportEnded = useCallback(
    async (trackId: string) => {
      try {
        const res = await apiFetch(`/api/rooms/${id}/playback/ended`, {
          method: 'POST',
          body: JSON.stringify({ trackId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) applyPlayback(data);
      } catch (err) {
        console.log('Error reporting end of track:', err);
      }
    },
    [id, apiFetch, applyPlayback]
  );

  const removeTrack = (track: RoomTrack) => {
    confirmAction('Retirer ce titre ?', `${track.title} sera retiré de la file.`, 'Retirer', async () => {
      try {
        const res = await apiFetch(`/api/rooms/${id}/tracks/${track.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) notify('Titre', errorMessage(data, 'Impossible de retirer ce titre'));
        else syncAfterWrite();
      } catch (err: any) {
        notify('Titre', err?.message || 'Impossible de retirer ce titre');
      }
    });
  };

  const regenerateCode = () => {
    confirmAction(
      "Régénérer le code ?",
      "L'ancien code ne fonctionnera plus. Les invités actuels gardent leur accès.",
      'Régénérer',
      async () => {
        try {
          const res = await apiFetch(`/api/rooms/${id}/invite-code`, { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) notify('Code', errorMessage(data, 'Impossible de régénérer le code'));
          else fetchRoom();
        } catch (err: any) {
          notify('Code', err?.message || 'Impossible de régénérer le code');
        }
      }
    );
  };

  const deleteRoom = () => {
    confirmAction(
      "Supprimer l'événement ?",
      'La salle, ses titres et ses votes seront supprimés pour tout le monde.',
      'Supprimer',
      async () => {
        try {
          const res = await apiFetch(`/api/rooms/${id}`, { method: 'DELETE' });
          if (res.ok || res.status === 204) {
            leaving.current = true;
            router.replace('/(tabs)/events');
            return;
          }
          const data = await res.json().catch(() => ({}));
          notify('Suppression', errorMessage(data, "Impossible de supprimer l'événement"));
        } catch (err: any) {
          notify('Suppression', err?.message || "Impossible de supprimer l'événement");
        }
      }
    );
  };

  /** Without the live channel, a write is not echoed back: read the queue again. */
  const syncAfterWrite = () => {
    if (!live) fetchQueue();
  };

  const getVotePosition = async (): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== 'granted') {
        notify(
          'Localisation requise',
          'Autorisez la localisation : votre position est requise pour voter dans cet événement.'
        );
        return null;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('location timeout')), LOCATION_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch (err) {
      console.log('Location error:', err);
      notify('Localisation', 'Impossible de récupérer votre position.');
      return null;
    }
  };

  const toggleVote = async (track: RoomTrack) => {
    if (!room || pending.has(track.id)) return;
    if (voteBlocked && !myVotes.has(track.id)) {
      notify('Vote', permissions?.voteBlockedReason || 'Vous ne pouvez pas voter ici.');
      return;
    }
    const voted = myVotes.has(track.id);
    setPending((prev) => new Set(prev).add(track.id));
    localVotes.current.set(track.id, Infinity);
    try {
      let body: Record<string, number> = {};
      const needsPosition =
        room.license === 'GEO_TIME_RESTRICTED' &&
        room.latitude != null &&
        room.longitude != null &&
        room.radiusM != null;
      if (!voted && needsPosition) {
        const position = await getVotePosition();
        if (!position) return;
        body = position;
      }

      const res = await apiFetch(`/api/rooms/${room.id}/tracks/${track.id}/vote`, {
        method: voted ? 'DELETE' : 'POST',
        body: voted ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // The response queue carries `hasVoted` for me: it is the authority.
        const updated = Array.isArray(data.queue)
          ? (data.queue as RoomTrack[]).find((t) => t.id === track.id)
          : undefined;
        setVoted(track.id, typeof updated?.hasVoted === 'boolean' ? updated.hasVoted : !voted);
        syncAfterWrite();
        return;
      }

      if (data.code === 'ALREADY_VOTED') setVoted(track.id, true);
      if (data.code === 'VOTE_NOT_FOUND') setVoted(track.id, false);
      if (data.code === 'TRACK_NOT_FOUND') fetchQueue();
      if (data.code === 'ROOM_FORBIDDEN' || data.code === 'ROOM_NOT_FOUND') {
        leaveWithNotice(errorMessage(data, "Vous n'avez plus accès à cet événement."));
        return;
      }
      notify('Vote', errorMessage(data, 'Vote impossible'));
    } catch (err: any) {
      notify('Vote', err.message || 'Vote impossible');
    } finally {
      localVotes.current.set(track.id, Date.now() + LOCAL_ECHO_MS);
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  const suggestTrack = async (track: DeezerTrack) => {
    if (!id) return false;
    try {
      const res = await apiFetch(`/api/rooms/${id}/tracks`, {
        method: 'POST',
        body: JSON.stringify({
          externalId: String(track.id),
          title: track.title,
          artist: track.artist.name,
          album: track.album.title || null,
          preview: track.preview || null,
          coverUrl: track.album.cover_medium || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, "Impossible d'ajouter ce titre"));
      syncAfterWrite();
      return true;
    } catch (err: any) {
      notify('Suggestion', err.message || "Impossible d'ajouter ce titre");
      return false;
    }
  };

  const shareInviteCode = async () => {
    if (!room?.inviteCode) return;
    if (Platform.OS === 'web') {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(room.inviteCode);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return;
        }
      } catch {
        // fall through to the alert
      }
      notify("Code d'invitation", room.inviteCode);
      return;
    }
    try {
      await Share.share({
        message: `Rejoins l'événement "${room.name}" sur Music Room avec le code : ${room.inviteCode}`,
      });
    } catch (err) {
      console.log('Share error:', err);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/events');
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#652edc" />
      </View>
    );
  }

  if (!room && loadError) {
    return (
      <View style={styles.centerContainer}>
        <LoadError
          message={loadError}
          onRetry={() => {
            setLoading(true);
            refreshAll();
          }}
        />
        <Pressable style={styles.primaryBtn} onPress={goBack} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Retour aux événements</Text>
        </Pressable>
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Événement introuvable</Text>
        <Pressable style={styles.primaryBtn} onPress={goBack}>
          <Text style={styles.primaryBtnText}>Retour aux événements</Text>
        </Pressable>
      </View>
    );
  }

  const hasZone = room.latitude != null && room.longitude != null && room.radiusM != null;

  return (
    <View style={styles.container}>
      <View style={styles.navBar}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          style={styles.navIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        {isOwner && (
          <View style={styles.navActions}>
            {room.inviteCode ? (
              <Pressable
                onPress={shareInviteCode}
                accessibilityRole="button"
                accessibilityLabel="Partager le code d'invitation"
                hitSlop={8}
                style={[styles.codeButton, copied && styles.codeButtonCopied]}
              >
                <Ionicons
                  name={copied ? 'checkmark' : 'key'}
                  size={14}
                  color={copied ? '#10b981' : '#f59e0b'}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.codeButtonText, copied && { color: '#10b981' }]}>
                  {copied ? 'Copié !' : room.inviteCode}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setInviteVisible(true)}
              hitSlop={8}
              style={styles.inviteButton}
              accessibilityRole="button"
              accessibilityLabel="Inviter un utilisateur"
            >
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={styles.inviteButtonText}>Inviter</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ConnectionBanner />
      {liveError && status === 'connected' ? (
        <Text style={styles.liveError}>{liveError}</Text>
      ) : null}

      <View style={styles.headerInfo}>
        <Text style={styles.title} numberOfLines={2}>
          {room.name}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, room.visibility === 'PRIVATE' ? styles.privateBadge : styles.publicBadge]}>
            <Text
              style={[styles.badgeText, { color: room.visibility === 'PRIVATE' ? '#f59e0b' : '#10b981' }]}
            >
              {room.visibility === 'PRIVATE' ? 'Privé' : 'Public'}
            </Text>
          </View>
          <View style={[styles.badge, styles.licenseBadge]}>
            <Text style={[styles.badgeText, { color: '#a77bf3' }]}>{LICENSE_LABELS[room.license]}</Text>
          </View>
          <View style={[styles.badge, styles.roleBadge]}>
            <Text style={[styles.badgeText, { color: '#fff' }]}>{ROLE_LABELS[role]}</Text>
          </View>
          {isOwner && room.invites ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {room.invites.length} {room.invites.length > 1 ? 'invités' : 'invité'}
              </Text>
            </View>
          ) : null}
        </View>
        {room.license === 'GEO_TIME_RESTRICTED' && (
          <View style={styles.geoInfo}>
            {room.voteStartAt || room.voteEndAt ? (
              <Text style={styles.geoText}>
                <Ionicons name="time-outline" size={12} color="#888" /> Vote{' '}
                {room.voteStartAt ? `du ${formatDateTime(room.voteStartAt)} ` : ''}
                {room.voteEndAt ? `jusqu'au ${formatDateTime(room.voteEndAt)}` : ''}
              </Text>
            ) : null}
            {hasZone ? (
              <Text style={styles.geoText}>
                <Ionicons name="location-outline" size={12} color="#888" /> Sur place, dans un rayon de{' '}
                {room.radiusM} m
              </Text>
            ) : null}
          </View>
        )}
      </View>

      <NowPlayingBar
        playback={playback}
        receivedAt={playbackReceivedAt}
        canControl={!!permissions?.canControlPlayback || isOwner}
        onControl={controlPlayback}
        onEnded={reportEnded}
      />

      {voteBlocked ? (
        <View style={styles.voteBlocked}>
          <Ionicons name="lock-closed" size={14} color="#f59e0b" />
          <Text style={styles.voteBlockedText}>
            Vote indisponible : {permissions?.voteBlockedReason || 'licence de la salle'}
          </Text>
        </View>
      ) : permissions?.voteRequiresLocation && permissions.voteBlockedReason ? (
        <Text style={styles.hint}>{permissions.voteBlockedReason}</Text>
      ) : null}

      {isOwner ? (
        <View style={styles.manageBox}>
          <Pressable
            onPress={() => setManageOpen((o) => !o)}
            style={styles.manageHeader}
            accessibilityRole="button"
            accessibilityLabel="Gérer l'événement"
          >
            <Ionicons name="settings-outline" size={16} color="#a77bf3" />
            <Text style={styles.manageTitle}>Gérer l'événement</Text>
            <Ionicons name={manageOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#888" />
          </Pressable>
          {manageOpen ? (
            <View style={styles.manageActions}>
              <Pressable style={styles.manageBtn} onPress={() => setEditVisible(true)} accessibilityRole="button">
                <Text style={styles.manageBtnText}>Modifier</Text>
              </Pressable>
              {room.visibility === 'PRIVATE' ? (
                <Pressable style={styles.manageBtn} onPress={regenerateCode} accessibilityRole="button">
                  <Text style={styles.manageBtnText}>Nouveau code</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.manageBtn, styles.dangerBtn]} onPress={deleteRoom} accessibilityRole="button">
                <Text style={[styles.manageBtnText, { color: '#fca5a5' }]}>Supprimer</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable
        style={styles.suggestBar}
        onPress={() => setSuggestVisible(true)}
        accessibilityRole="button"
      >
        <Ionicons name="add-circle" size={20} color="#652edc" />
        <Text style={styles.suggestBarText}>Suggérer un titre</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>À suivre</Text>
      <FlatList
        data={queue}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyQueue}>
            <Ionicons name="musical-note" size={44} color="#333" />
            <Text style={styles.emptyQueueTitle}>Rien à suivre</Text>
            <Text style={styles.emptyQueueSub}>Suggérez un titre depuis Deezer</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const voted = myVotes.has(item.id);
          const busy = pending.has(item.id);
          return (
            <View style={[styles.trackItem, index === 0 && styles.nextTrackItem]}>
              <Text style={styles.positionIndex}>{index + 1}</Text>
              <View style={styles.trackCenter}>
                <Text style={styles.trackTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.trackArtist} numberOfLines={1}>
                  {item.artist}
                  {index === 0 ? '  •  Prochain titre' : ''}
                </Text>
              </View>
              {permissions?.canRemoveTrack ? (
                <Pressable
                  onPress={() => removeTrack(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Retirer ${item.title}`}
                  style={{ marginRight: 8 }}
                >
                  <Ionicons name="trash-outline" size={18} color="#888" />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => toggleVote(item)}
                disabled={busy || (voteBlocked && !voted)}
                accessibilityRole="button"
                accessibilityLabel={
                  voted ? `Retirer mon vote pour ${item.title}` : `Voter pour ${item.title}`
                }
                hitSlop={6}
                style={[
                  styles.voteButton,
                  voted && styles.voteButtonActive,
                  (busy || (voteBlocked && !voted)) && { opacity: 0.5 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name={voted ? 'heart' : 'heart-outline'} size={18} color={voted ? '#fff' : '#a77bf3'} />
                )}
                <Text style={[styles.voteCount, voted && { color: '#fff' }]}>{item.voteCount}</Text>
              </Pressable>
            </View>
          );
        }}
      />

      <TrackSearchModal
        visible={suggestVisible}
        title="Suggérer un titre"
        onClose={() => setSuggestVisible(false)}
        onPick={suggestTrack}
      />

      {isOwner && (
        <EditRoomModal
          visible={editVisible}
          room={room}
          onClose={() => setEditVisible(false)}
          onSaved={fetchRoom}
        />
      )}

      {isOwner && (
        <InviteUserModal
          visible={inviteVisible}
          invitePath={`/api/rooms/${room.id}/invites`}
          invitedIds={room.invites?.map((i) => i.userId) ?? []}
          revokePath={(userId) => `/api/rooms/${room.id}/invites/${userId}`}
          onClose={() => setInviteVisible(false)}
          onInvited={fetchRoom}
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
    gap: 10,
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
  codeButtonCopied: {
    borderColor: '#10b981',
    backgroundColor: '#0d281e',
  },
  codeButtonText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
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
  liveError: {
    color: '#fca5a5',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  headerInfo: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  licenseBadge: { backgroundColor: '#211339' },
  badgeText: {
    color: '#aaa',
    fontSize: 11,
    fontWeight: '600',
  },
  geoInfo: {
    marginTop: 8,
    gap: 2,
  },
  geoText: {
    color: '#888',
    fontSize: 12,
  },
  roleBadge: { backgroundColor: '#652edc' },
  voteBlocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2d1f05',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  voteBlockedText: { color: '#f59e0b', fontSize: 12, flex: 1 },
  hint: { color: '#888', fontSize: 12, marginBottom: 10, textAlign: 'center' },
  manageBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  manageHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manageTitle: { color: '#fff', fontSize: 13, fontWeight: '700', flex: 1 },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  manageBtn: {
    backgroundColor: '#262626',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dangerBtn: { backgroundColor: '#2a1212' },
  manageBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  sectionTitle: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  suggestBar: {
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
  suggestBarText: {
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
    padding: 10,
    marginBottom: 8,
  },
  nextTrackItem: {
    backgroundColor: '#231838',
    borderColor: '#652edc',
    borderWidth: 1,
  },
  positionIndex: {
    color: '#555',
    fontSize: 12,
    fontWeight: '700',
    width: 24,
    textAlign: 'center',
  },
  trackCenter: {
    flex: 1,
    marginLeft: 8,
    marginRight: 8,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  trackArtist: {
    color: '#777',
    fontSize: 12,
    marginTop: 2,
  },
  voteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#652edc',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 64,
    justifyContent: 'center',
  },
  voteButtonActive: {
    backgroundColor: '#652edc',
  },
  voteCount: {
    color: '#a77bf3',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyQueue: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyQueueTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyQueueSub: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
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
  primaryBtn: {
    backgroundColor: '#652edc',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
});
