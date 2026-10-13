import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { useAudio } from '../contexts/AudioContext';
import type { PlaybackState } from '../types/room';

type Props = {
  playback: PlaybackState | null;
  /** `Date.now() - Date.parse(serverTime)` is the clock skew; this is `Date.now()` at receipt. */
  receivedAt: number;
  canControl: boolean;
  /** Owner controls (server transitions). Resolves when the request ended. */
  onControl: (action: 'play' | 'pause' | 'resume' | 'skip') => Promise<void>;
  /** The local clip finished: report it so the room advances (server checks and dedupes). */
  onEnded: (trackId: string) => void;
};

// Drift beyond which the local player is re-synchronized.
const DRIFT_MS = 1200;
const TICK_MS = 500;
// `ended` is reported again this often while the room still shows the same finished track.
const ENDED_RETRY_MS = 3000;

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * "Now playing" card. Everybody listens to the server's current track at the
 * synchronized position: expected position = now + skew - startedAt (skew from the
 * `serverTime` of the last payload). Read-only except for the owner's controls.
 */
export function NowPlayingBar({ playback, receivedAt, canControl, onControl, onEnded }: Props) {
  const { pause: pauseGlobalAudio } = useAudio();
  const track = playback?.currentTrack ?? null;
  const source = track?.preview || null;
  const player = useAudioPlayer(source);

  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [displayMs, setDisplayMs] = useState(0);
  const endedReported = useRef<{ trackId: string; at: number } | null>(null);
  const latest = useRef({ playback, receivedAt });
  latest.current = { playback, receivedAt };

  /** Position the room is at right now, in ms (0 when idle). */
  const expectedPosition = useCallback(() => {
    const { playback: state, receivedAt: at } = latest.current;
    if (!state?.currentTrack) return 0;
    const duration = state.currentTrack.durationMs;
    if (state.status === 'PAUSED') return Math.min(state.positionMs, duration);
    if (state.status !== 'PLAYING' || !state.startedAt) return 0;
    const skew = Date.parse(state.serverTime) - at;
    return Math.min(Math.max(Date.now() + skew - Date.parse(state.startedAt), 0), duration);
  }, []);

  // The room's audio replaces whatever the app was playing elsewhere.
  useEffect(() => {
    if (playback?.status === 'PLAYING') {
      try {
        pauseGlobalAudio();
      } catch {
        // no global player yet
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback?.status, track?.id]);

  useEffect(() => {
    try {
      player.volume = muted ? 0 : 1;
    } catch {
      // player released
    }
  }, [player, muted]);

  const syncAudio = useCallback(async () => {
    if (!source) return;
    try {
      const state = latest.current.playback;
      const position = expectedPosition();
      if (state?.status === 'PLAYING') {
        const drift = Math.abs(player.currentTime * 1000 - position);
        if (drift > DRIFT_MS || !player.playing) await player.seekTo(position / 1000);
        await player.play();
        setBlocked(false);
      } else {
        player.pause();
        if (state?.status === 'PAUSED') await player.seekTo(position / 1000);
      }
    } catch (err) {
      // Browsers refuse autoplay before a user gesture.
      console.log('Room audio error:', err);
      setBlocked(true);
    }
  }, [player, source, expectedPosition]);

  // Re-sync on every server state (play, pause, resume, skip, track change, reconnect).
  useEffect(() => {
    endedReported.current = endedReported.current?.trackId === track?.id ? endedReported.current : null;
    syncAudio();
  }, [playback, receivedAt, source, syncAudio, track?.id]);

  // Progress, drift correction and the end-of-clip report.
  useEffect(() => {
    const timer = setInterval(() => {
      const position = expectedPosition();
      setDisplayMs(position);
      const state = latest.current.playback;
      if (state?.status !== 'PLAYING' || !state.currentTrack) return;
      if (position >= state.currentTrack.durationMs - 300) {
        const last = endedReported.current;
        const now = Date.now();
        if (!last || now - last.at > ENDED_RETRY_MS) {
          endedReported.current = { trackId: state.currentTrack.id, at: now };
          onEnded(state.currentTrack.id);
        }
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [expectedPosition, onEnded]);

  useEffect(() => {
    setDisplayMs(expectedPosition());
  }, [playback, receivedAt, expectedPosition]);

  const control = async (action: 'play' | 'pause' | 'resume' | 'skip') => {
    if (busy) return;
    setBusy(true);
    try {
      await onControl(action);
    } finally {
      setBusy(false);
    }
  };

  const status = playback?.status ?? 'IDLE';
  const duration = track?.durationMs ?? 0;
  const progress = duration > 0 ? Math.min(1, displayMs / duration) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {track?.coverUrl ? (
          <Image source={{ uri: track.coverUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Ionicons name="musical-notes" size={26} color="#652edc" />
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.label}>
            {status === 'PLAYING' ? 'EN COURS' : status === 'PAUSED' ? 'EN PAUSE' : 'AU REPOS'}
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {track ? track.title : 'Aucun titre en lecture'}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {track ? track.artist : canControl ? 'Lancez la lecture quand la file est prête' : "En attente de l'organisateur"}
          </Text>
        </View>
        <Pressable
          onPress={() => setMuted((m) => !m)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Activer le son' : 'Couper le son'}
          style={styles.iconBtn}
        >
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={20} color="#a77bf3" />
        </Pressable>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(displayMs)}</Text>
        <Text style={styles.time}>{track ? formatTime(duration) : '--:--'}</Text>
      </View>

      {blocked && status === 'PLAYING' ? (
        <Pressable style={styles.blocked} onPress={syncAudio} accessibilityRole="button">
          <Ionicons name="volume-high" size={14} color="#fff" />
          <Text style={styles.blockedText}>Touchez pour activer le son</Text>
        </Pressable>
      ) : null}

      {canControl ? (
        <View style={styles.controls}>
          {busy ? (
            <ActivityIndicator color="#652edc" />
          ) : (
            <>
              {status === 'PLAYING' ? (
                <ControlButton icon="pause" label="Pause" onPress={() => control('pause')} />
              ) : status === 'PAUSED' ? (
                <ControlButton icon="play" label="Reprendre" onPress={() => control('resume')} />
              ) : (
                <ControlButton icon="play" label="Lancer" onPress={() => control('play')} />
              )}
              <ControlButton
                icon="play-skip-forward"
                label="Suivant"
                onPress={() => control('skip')}
                disabled={status === 'IDLE'}
              />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ControlButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.controlBtn, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name={icon} size={18} color="#fff" />
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1326',
    borderColor: '#652edc',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cover: { width: 56, height: 56, borderRadius: 8 },
  coverPlaceholder: { backgroundColor: '#241a3a', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  label: { color: '#a77bf3', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 2 },
  artist: { color: '#999', fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 6 },
  progressTrack: {
    height: 4,
    backgroundColor: '#2d2340',
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: '#652edc' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  time: { color: '#777', fontSize: 11 },
  blocked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#652edc',
    borderRadius: 8,
    paddingVertical: 8,
    marginTop: 10,
  },
  blockedText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12 },
  controlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#652edc',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  controlText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
