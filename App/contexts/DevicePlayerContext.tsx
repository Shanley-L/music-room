import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getClientInfo } from './ApiConfigContext';
import { useAuth } from './AuthContext';
import { useAudio } from './AudioContext';
import { useSocket, useSocketChannel } from './SocketContext';
import { useAuthedFetch } from '../hooks/use-authed-fetch';
import { codeMessage, errorMessage } from '../utils/feedback';
import type { Device, PlayerCommand, PlayerState } from '../types/device';

/**
 * Music Control Delegation, player side (contract: Api/REALTIME.md).
 *
 * - Registers this installation as a device of the logged-in user
 *   (`POST /api/devices`, stable `installationId` kept in AsyncStorage).
 * - In player mode, joins `device:register` for that device (again after every
 *   reconnection), executes received `device:command`s with the AudioContext and
 *   publishes the playback state with `device:state` when it changes (throttled),
 *   and after every command so remotes always get the resulting state.
 * - Registration is retried whenever the socket (re)connects without a device.
 */

const INSTALLATION_KEY = '@musicroom_installation_id';
const playerModeKey = (userId: string) => `@musicroom_player_mode:${userId}`;
// The server accepts 10 `device:state` per second and per socket.
const STATE_MIN_INTERVAL_MS = 300;

export type PlayerStatus = 'off' | 'connecting' | 'ready' | 'error';

type LastCommand = { command: PlayerCommand; from: string; at: number };

interface DevicePlayerContextType {
  /** This installation's device id, once registered. */
  deviceId: string | null;
  registering: boolean;
  registerError: string | null;
  registerDevice: () => Promise<void>;
  /** Drops the registration (this device was deleted); player mode is turned off. */
  forgetDevice: () => void;
  playerMode: boolean;
  setPlayerMode: (on: boolean) => void;
  playerStatus: PlayerStatus;
  playerError: string | null;
  lastCommand: LastCommand | null;
}

const DevicePlayerContext = createContext<DevicePlayerContextType>({
  deviceId: null,
  registering: false,
  registerError: null,
  registerDevice: async () => {},
  forgetDevice: () => {},
  playerMode: false,
  setPlayerMode: () => {},
  playerStatus: 'off',
  playerError: null,
  lastCommand: null,
});

async function getInstallationId() {
  const stored = await AsyncStorage.getItem(INSTALLATION_KEY);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(INSTALLATION_KEY, created);
  return created;
}

export const DevicePlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const apiFetch = useAuthedFetch();
  const { status: socketStatus, emitAck } = useSocket();
  const audio = useAudio();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [playerMode, setPlayerModeState] = useState(false);
  const [joinAck, setJoinAck] = useState<{ ok: boolean; code?: string } | null>(null);
  const [lastCommand, setLastCommand] = useState<LastCommand | null>(null);

  const userId = user?.id ?? null;

  const registerDevice = useCallback(async () => {
    if (!token || !userId) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const installationId = await getInstallationId();
      const res = await apiFetch('/api/devices', {
        method: 'POST',
        body: JSON.stringify({
          name: getClientInfo().device.slice(0, 100),
          platform: Platform.OS,
          installationId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, "Impossible d'enregistrer cet appareil"));
      setDeviceId((data as Device).id);
    } catch (err: any) {
      setRegisterError(err?.message || "Impossible d'enregistrer cet appareil");
    } finally {
      setRegistering(false);
    }
  }, [apiFetch, token, userId]);

  // Register this installation once per session; forget everything on logout.
  useEffect(() => {
    setDeviceId(null);
    setJoinAck(null);
    setLastCommand(null);
    setPlayerModeState(false);
    if (!token || !userId) return;
    registerDevice();
    AsyncStorage.getItem(playerModeKey(userId))
      .then((stored) => setPlayerModeState(stored === 'on'))
      .catch(() => {});
    // `registerDevice` changes with the token: only a new user triggers a new registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const setPlayerMode = useCallback(
    (on: boolean) => {
      setPlayerModeState(on);
      if (!on) setJoinAck(null);
      if (userId) AsyncStorage.setItem(playerModeKey(userId), on ? 'on' : 'off').catch(() => {});
    },
    [userId]
  );

  // Not persisted: the saved preference applies again once a device is registered.
  const forgetDevice = useCallback(() => {
    setDeviceId(null);
    setJoinAck(null);
    setPlayerModeState(false);
  }, []);

  // Registration failed or was dropped: try again each time the socket (re)connects.
  const previousSocketStatus = useRef(socketStatus);
  useEffect(() => {
    const wasConnected = previousSocketStatus.current === 'connected';
    previousSocketStatus.current = socketStatus;
    if (socketStatus === 'connected' && !wasConnected && !deviceId && !registering && userId) {
      registerDevice();
    }
  }, [socketStatus, deviceId, registering, userId, registerDevice]);

  // --- State publishing -----------------------------------------------------

  const state: PlayerState = {
    playing: audio.isPlaying,
    trackId: audio.currentKey,
    title: audio.currentTrack?.title ?? null,
    artist: audio.currentTrack?.artist.name ?? null,
    coverUrl: audio.currentTrack?.album.cover_medium || null,
    volume: audio.volume,
  };
  const stateJson = JSON.stringify(state);

  const ready = playerMode && !!deviceId && joinAck?.ok === true && socketStatus === 'connected';

  const lastSentRef = useRef<string | null>(null);
  const lastSentAtRef = useRef(0);
  const sentForceRef = useRef(0);
  // Bumped after each command: remotes get the resulting state even when nothing changed.
  const [forceTick, setForceTick] = useState(0);

  // Publishes the state this render produced, at most once per STATE_MIN_INTERVAL_MS:
  // a newer state cancels the pending send (cleanup) and is sent instead.
  useEffect(() => {
    if (!ready || !deviceId) {
      // Next registration publishes again whatever was sent before.
      lastSentRef.current = null;
      return;
    }
    if (stateJson === lastSentRef.current && forceTick === sentForceRef.current) return;
    const wait = Math.max(0, lastSentAtRef.current + STATE_MIN_INTERVAL_MS - Date.now());
    const timer = setTimeout(() => {
      lastSentAtRef.current = Date.now();
      emitAck('device:state', { deviceId, state: JSON.parse(stateJson) }).then((ack) => {
        if (ack.ok) {
          lastSentRef.current = stateJson;
          sentForceRef.current = forceTick;
        } else console.log('device:state refused:', ack.code);
      });
    }, wait);
    return () => clearTimeout(timer);
  }, [ready, deviceId, stateJson, forceTick, emitAck]);

  // --- Commands ---------------------------------------------------------------

  const execute = (command: PlayerCommand, value: unknown) => {
    switch (command) {
      case 'play':
        audio.resume();
        break;
      case 'pause':
        audio.pause();
        break;
      case 'next':
        audio.next();
        break;
      case 'previous':
        audio.previous();
        break;
      case 'setVolume':
        if (typeof value === 'number' && Number.isFinite(value)) audio.setVolume(value);
        break;
    }
  };

  useSocketChannel('devicePlayer', playerMode && deviceId ? deviceId : undefined, {
    onJoin: (ack) => {
      setJoinAck(ack.ok ? { ok: true } : { ok: false, code: ack.code });
      // The device was deleted (from another phone): it must be registered again.
      if (!ack.ok && ack.code === 'DEVICE_NOT_FOUND') forgetDevice();
    },
    onEvent: (event, payload) => {
      if (event !== 'device:command') return;
      execute(payload.command, payload.value);
      setLastCommand({ command: payload.command, from: payload.from?.name || '?', at: Date.now() });
      setForceTick((tick) => tick + 1);
    },
  });

  let playerStatus: PlayerStatus = 'off';
  let playerError: string | null = null;
  if (playerMode && deviceId) {
    if (joinAck && !joinAck.ok) {
      playerStatus = 'error';
      playerError = codeMessage(joinAck.code || '', 'Impossible de devenir le lecteur de cet appareil.');
    } else playerStatus = ready ? 'ready' : 'connecting';
  }

  return (
    <DevicePlayerContext.Provider
      value={{
        deviceId,
        registering,
        registerError,
        registerDevice,
        forgetDevice,
        playerMode,
        setPlayerMode,
        playerStatus,
        playerError,
        lastCommand,
      }}
    >
      {children}
    </DevicePlayerContext.Provider>
  );
};

export const useDevicePlayer = () => useContext(DevicePlayerContext);
