import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { useSocket, useSocketChannel } from '../../contexts/SocketContext';
import { ScreenHeader } from '../../components/ScreenHeader';
import { LoadError } from '../../components/LoadError';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { codeMessage, errorMessage, notify, revokeReasonMessage } from '../../utils/feedback';
import type {
  Device,
  DelegationRights,
  PlayerCommand,
  PlayerState,
  ReceivedDelegation,
} from '../../types/device';

type Access = {
  isOwner: boolean;
  deviceName: string;
  ownerName: string | null;
  rights: DelegationRights;
};

const ALL_RIGHTS: DelegationRights = { canPlayPause: true, canSkip: true, canVolume: true };
const VOLUME_STEP = 10;

const COMMAND_A11Y: Record<PlayerCommand, string> = {
  play: 'Lecture',
  pause: 'Pause',
  next: 'Titre suivant',
  previous: 'Titre précédent',
  setVolume: 'Volume',
};

/**
 * Remote control of a device (owner, or friend with an active delegation).
 * Watches `device:<id>` for the player state; buttons follow the rights, which the
 * server re-checks on every `device:command` and pushes with `delegation:updated`.
 * Revocation (`device:revoked`, inactive delegation, refused watch) leaves the screen.
 */
export default function RemoteControlScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const apiFetch = useAuthedFetch();
  const { status, emitAck } = useSocket();

  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ state: PlayerState; at: string } | null>(null);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState<PlayerCommand | null>(null);
  const leaving = useRef(false);

  const leaveWithNotice = useCallback(
    (message: string) => {
      if (leaving.current) return;
      leaving.current = true;
      notify('Télécommande', message, () => router.replace('/remote'));
    },
    [router]
  );

  /** Who am I for this device: a delegate (rights from the server) or its owner. */
  const loadAccess = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch('/api/delegations/received');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, "Impossible de charger l'appareil"));
      const received = (Array.isArray(data) ? (data as ReceivedDelegation[]) : []).find(
        (d) => d.deviceId === id
      );
      if (received) {
        setAccess({
          isOwner: false,
          deviceName: received.device.name,
          ownerName: received.owner.name,
          rights: {
            canPlayPause: received.canPlayPause,
            canSkip: received.canSkip,
            canVolume: received.canVolume,
          },
        });
        setLoadError(null);
        return;
      }

      const mine = await apiFetch('/api/devices');
      const devices = await mine.json().catch(() => ({}));
      if (!mine.ok || !Array.isArray(devices)) {
        throw new Error(errorMessage(devices, "Impossible de charger l'appareil"));
      }
      const own = (devices as Device[]).find((d) => d.id === id);
      if (own) {
        setAccess({ isOwner: true, deviceName: own.name, ownerName: null, rights: ALL_RIGHTS });
        setLoadError(null);
        return;
      }
      // Both lists answered and neither has this device: control is really gone.
      leaveWithNotice("Vous n'avez plus le contrôle de cet appareil.");
    } catch (err: any) {
      console.log('Remote access error:', err);
      setLoadError(err?.message || "Impossible de charger l'appareil");
    } finally {
      setLoading(false);
    }
  }, [id, apiFetch, leaveWithNotice]);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  useSocketChannel('deviceWatch', id, {
    onJoin: (ack) => {
      if (ack.ok) {
        setWatching(true);
        setLiveError(null);
        // (Re)joined: rights may have changed while we were away.
        loadAccess();
        return;
      }
      setWatching(false);
      if (ack.code === 'DELEGATION_FORBIDDEN' || ack.code === 'DEVICE_NOT_FOUND') {
        leaveWithNotice(codeMessage(ack.code, "Vous n'avez plus le contrôle de cet appareil."));
      } else {
        setLiveError(codeMessage(ack.code, 'État du lecteur indisponible.'));
      }
    },
    onEvent: (event, payload) => {
      switch (event) {
        case 'device:state':
          if (payload.state && typeof payload.state === 'object') {
            setPlayer({ state: payload.state, at: payload.at });
            setOffline(false);
          }
          break;
        case 'delegation:updated':
          if (!payload.active) {
            leaveWithNotice(revokeReasonMessage('REVOKED'));
          } else if (payload.rights) {
            setAccess((prev) => (prev ? { ...prev, rights: payload.rights } : prev));
          }
          break;
        case 'device:revoked':
          leaveWithNotice(revokeReasonMessage(payload.reason));
          break;
      }
    },
  });

  const send = async (command: PlayerCommand, value?: number) => {
    if (!id || sending) return;
    setSending(command);
    try {
      const ack = await emitAck('device:command', { deviceId: id, command, value: value ?? null });
      if (ack.ok) {
        setOffline(false);
        return;
      }
      if (ack.code === 'DEVICE_OFFLINE') {
        setOffline(true);
        return;
      }
      if (ack.code === 'DELEGATION_FORBIDDEN') {
        // Right removed or delegation revoked meanwhile: the server state decides.
        loadAccess();
      }
      if (ack.code === 'DEVICE_NOT_FOUND') {
        leaveWithNotice(codeMessage(ack.code, 'Appareil introuvable.'));
        return;
      }
      notify('Télécommande', codeMessage(ack.code, 'Commande refusée.'));
    } finally {
      setSending(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#652edc" />
      </View>
    );
  }

  if (!access) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Télécommande" fallback="/remote" />
        {loadError ? (
          <LoadError
            message={loadError}
            onRetry={() => {
              setLoading(true);
              loadAccess();
            }}
          />
        ) : (
          <Text style={styles.empty}>Appareil indisponible.</Text>
        )}
      </View>
    );
  }

  const { rights } = access;
  const state = player?.state ?? null;
  const live = watching && status === 'connected';
  const canSend = live && !sending;
  const volume = typeof state?.volume === 'number' ? state.volume : null;

  return (
    <View style={styles.container}>
      <ScreenHeader title={access.deviceName} fallback="/remote" />
      <ConnectionBanner />
      {liveError && status === 'connected' ? <Text style={styles.errorText}>{liveError}</Text> : null}

      <Text style={styles.subtitle}>
        {access.isOwner ? 'Votre appareil' : `Appareil de ${access.ownerName}`}
      </Text>

      {offline ? (
        <View style={styles.offlineBox}>
          <Ionicons name="cloud-offline-outline" size={16} color="#fca5a5" />
          <Text style={styles.offlineText}>{codeMessage('DEVICE_OFFLINE', 'Appareil hors ligne.')}</Text>
        </View>
      ) : null}

      <View style={styles.nowPlaying}>
        {state?.coverUrl ? (
          <Image source={{ uri: state.coverUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Ionicons name="musical-notes" size={48} color="#652edc" />
          </View>
        )}
        <Text style={styles.trackTitle} numberOfLines={1}>
          {state ? state.title || 'Aucun titre en cours' : 'En attente du lecteur…'}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {state
            ? state.artist || ''
            : "L'état s'affiche dès que l'appareil joue ou reçoit une commande."}
        </Text>
        {state ? (
          <Text style={styles.stateLine}>
            {state.playing ? 'Lecture en cours' : 'En pause'}
            {volume !== null ? ` · volume ${volume} %` : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.controls}>
        <ControlButton enabled={canSend} sending={sending} onSend={send} icon="play-skip-back" command="previous" allowed={rights.canSkip} />
        {state?.playing ? (
          <ControlButton enabled={canSend} sending={sending} onSend={send} icon="pause" command="pause" allowed={rights.canPlayPause} big />
        ) : (
          <ControlButton enabled={canSend} sending={sending} onSend={send} icon="play" command="play" allowed={rights.canPlayPause} big />
        )}
        <ControlButton enabled={canSend} sending={sending} onSend={send} icon="play-skip-forward" command="next" allowed={rights.canSkip} />
      </View>

      <View style={styles.volumeRow}>
        <ControlButton
          enabled={canSend}
          sending={sending}
          onSend={send}
          icon="volume-low"
          command="setVolume"
          value={Math.max(0, (volume ?? 50) - VOLUME_STEP)}
          allowed={rights.canVolume}
        />
        <View style={styles.volumeBar}>
          <View style={[styles.volumeFill, { width: `${volume ?? 0}%` }]} />
        </View>
        <ControlButton
          enabled={canSend}
          sending={sending}
          onSend={send}
          icon="volume-high"
          command="setVolume"
          value={Math.min(100, (volume ?? 50) + VOLUME_STEP)}
          allowed={rights.canVolume}
        />
      </View>

      {!access.isOwner && (!rights.canPlayPause || !rights.canSkip || !rights.canVolume) ? (
        <Text style={styles.rightsHint}>
          Certaines commandes sont désactivées : le propriétaire ne vous les a pas autorisées.
        </Text>
      ) : null}
    </View>
  );
}

/** One remote button: disabled without the right, offline, or while a command is in flight. */
function ControlButton({
  icon,
  command,
  value,
  allowed,
  enabled,
  sending,
  onSend,
  big = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  command: PlayerCommand;
  value?: number;
  allowed: boolean;
  enabled: boolean;
  sending: PlayerCommand | null;
  onSend: (command: PlayerCommand, value?: number) => void;
  big?: boolean;
}) {
  const disabled = !allowed || !enabled;
  const label =
    command === 'setVolume'
      ? icon === 'volume-low'
        ? 'Baisser le volume'
        : 'Monter le volume'
      : COMMAND_A11Y[command];
  return (
    <Pressable
      onPress={() => onSend(command, value)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[big ? styles.bigButton : styles.button, disabled && styles.buttonDisabled]}
    >
      {sending === command ? (
        <ActivityIndicator color={big ? '#000' : '#fff'} />
      ) : (
        <Ionicons name={icon} size={big ? 34 : 24} color={big ? '#000' : '#fff'} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    color: '#777',
    textAlign: 'center',
    marginVertical: 24,
  },
  subtitle: {
    color: '#888',
    fontSize: 13,
    marginBottom: 12,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  offlineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2a1215',
    borderColor: '#7f1d1d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  offlineText: {
    flex: 1,
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '600',
  },
  nowPlaying: {
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 20,
    marginBottom: 24,
  },
  cover: {
    width: 180,
    height: 180,
    borderRadius: 12,
    marginBottom: 14,
  },
  coverPlaceholder: {
    backgroundColor: '#231c33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  trackArtist: {
    color: '#888',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  stateLine: {
    color: '#a77bf3',
    fontSize: 12,
    marginTop: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    marginBottom: 24,
  },
  button: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.3,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  volumeBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#262626',
    overflow: 'hidden',
  },
  volumeFill: {
    height: 6,
    backgroundColor: '#652edc',
  },
  rightsHint: {
    color: '#777',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
