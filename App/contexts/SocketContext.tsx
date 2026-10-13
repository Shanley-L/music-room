import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getClientInfo, useApiConfig } from './ApiConfigContext';
import { useAuth } from './AuthContext';

/**
 * Shared Socket.IO client (contract: Api/REALTIME.md).
 *
 * - Connects when a session token exists, disconnects on logout, and reconnects to
 *   the new URL when the backend URL changes.
 * - Channels are reference counted: screens subscribe with `useSocketChannel`, and
 *   every channel is joined again after each (re)connection. Subscribers get the join
 *   ack each time, so they refetch server state after a reconnect instead of trusting
 *   what they had. Kinds: `room` and `playlist` (`*:join` / `*:leave`), `devicePlayer`
 *   (`device:register` / `device:unregister`, this app is the device's player) and
 *   `deviceWatch` (`device:watch` / `device:unwatch`, remote control).
 * - `emitAck` sends any other event with an ack (e.g. `device:command`, `device:state`).
 */

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized';

export type ChannelKind = 'room' | 'playlist' | 'devicePlayer' | 'deviceWatch';

/**
 * Ack of a join or of `emitAck`. Local codes: `TIMEOUT` (no ack within ACK_TIMEOUT_MS)
 * and `NOT_CONNECTED` (`emitAck` while the socket is down).
 */
export type JoinAck = { ok: true } | { ok: false; code: string };

type EventListener = (event: string, payload: any) => void;

type Subscriber = { onJoin: (ack: JoinAck) => void };

type Channel = {
  kind: ChannelKind;
  id: string;
  subscribers: Set<Subscriber>;
  lastAck: JoinAck | null;
  /** Bumped by every join and connection change: only the latest join's ack applies. */
  joinSeq: number;
};

interface SocketContextType {
  status: SocketStatus;
  /** Subscribes to a channel; returns the unsubscribe function. */
  subscribe: (kind: ChannelKind, id: string, subscriber: Subscriber) => () => void;
  /** Receives every server event; returns the unsubscribe function. */
  addListener: (listener: EventListener) => () => void;
  /** Emits `event` and resolves with the server ack (never rejects). */
  emitAck: (event: string, payload: unknown) => Promise<JoinAck>;
}

const ACK_TIMEOUT_MS = 8000;
// Manual reconnection (cases socket.io does not retry by itself): capped backoff.
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

const SocketContext = createContext<SocketContextType>({
  status: 'idle',
  subscribe: () => () => {},
  addListener: () => () => {},
  emitAck: async () => ({ ok: false, code: 'NOT_CONNECTED' }),
});

/** Join / leave events and id field of each channel kind (Api/REALTIME.md). */
const CHANNELS: Record<ChannelKind, { join: string; leave: string; field: string }> = {
  room: { join: 'room:join', leave: 'room:leave', field: 'roomId' },
  playlist: { join: 'playlist:join', leave: 'playlist:leave', field: 'playlistId' },
  devicePlayer: { join: 'device:register', leave: 'device:unregister', field: 'deviceId' },
  deviceWatch: { join: 'device:watch', leave: 'device:unwatch', field: 'deviceId' },
};

const channelKey = (kind: ChannelKind, id: string) => `${kind}:${id}`;
const idField = (kind: ChannelKind) => CHANNELS[kind].field;

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { backendUrl } = useApiConfig();
  const { token } = useAuth();
  const [status, setStatus] = useState<SocketStatus>('idle');

  const socketRef = useRef<Socket | null>(null);
  const channelsRef = useRef(new Map<string, Channel>());
  const listenersRef = useRef(new Set<EventListener>());

  /** Forgets join results and invalidates in-flight joins (connection lost or replaced). */
  const resetChannels = useCallback(() => {
    channelsRef.current.forEach((channel) => {
      channel.lastAck = null;
      channel.joinSeq += 1;
    });
  }, []);

  const joinChannel = useCallback((socket: Socket, channel: Channel) => {
    channel.lastAck = null;
    const seq = ++channel.joinSeq;
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit(CHANNELS[channel.kind].join, { [idField(channel.kind)]: channel.id }, (err: Error | null, ack: JoinAck) => {
        // Ignore acks for a socket that has been replaced or a channel since dropped.
        if (socketRef.current !== socket) return;
        if (channelsRef.current.get(channelKey(channel.kind, channel.id)) !== channel) return;
        // A newer join (reconnection) or a disconnection happened since: stale result.
        if (channel.joinSeq !== seq) return;
        const result: JoinAck = err || !ack ? { ok: false, code: 'TIMEOUT' } : ack;
        channel.lastAck = result;
        channel.subscribers.forEach((s) => s.onJoin(result));
      });
  }, []);

  useEffect(() => {
    // New socket (token or URL changed): previous join results do not apply.
    resetChannels();
    if (!token) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    const socket = io(backendUrl, {
      transports: ['websocket'],
      // A function so that every reconnection sends the current handshake data.
      auth: (cb) => cb({ token, ...getClientInfo() }),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;

    const scheduleRetry = () => {
      if (retryTimer) return;
      const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
      retryAttempt += 1;
      setStatus('reconnecting');
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!socket.connected && !socket.active) socket.connect();
      }, delay);
    };

    socket.on('connect', () => {
      retryAttempt = 0;
      setStatus('connected');
      channelsRef.current.forEach((channel) => joinChannel(socket, channel));
    });

    socket.on('disconnect', (reason) => {
      resetChannels();
      if (reason === 'io client disconnect') return;
      setStatus('reconnecting');
      // The server drops the socket when the JWT expires and does not reconnect it
      // by itself: try again, delayed and capped (a refused token ends in
      // `connect_error` UNAUTHORIZED).
      if (reason === 'io server disconnect') scheduleRetry();
    });

    socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      if (err?.message === 'UNAUTHORIZED' || err?.data?.code === 'UNAUTHORIZED') {
        // Middleware refusals are not retried by socket.io: the REST layer will end the session.
        setStatus('unauthorized');
        return;
      }
      // socket.io gave up (not active): keep trying ourselves.
      if (socket.active) setStatus('reconnecting');
      else scheduleRetry();
    });

    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));

    socket.onAny((event: string, payload: any) => {
      listenersRef.current.forEach((listener) => listener(event, payload));
    });

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      resetChannels();
      socket.removeAllListeners();
      socket.offAny();
      socket.io.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [backendUrl, token, joinChannel, resetChannels]);

  const subscribe = useCallback(
    (kind: ChannelKind, id: string, subscriber: Subscriber) => {
      const key = channelKey(kind, id);
      let channel = channelsRef.current.get(key);
      const socket = socketRef.current;

      if (!channel) {
        channel = { kind, id, subscribers: new Set(), lastAck: null, joinSeq: 0 };
        channelsRef.current.set(key, channel);
        channel.subscribers.add(subscriber);
        if (socket?.connected) joinChannel(socket, channel);
      } else {
        channel.subscribers.add(subscriber);
        // Already joined on this connection: hand the existing result to the newcomer.
        if (channel.lastAck) subscriber.onJoin(channel.lastAck);
      }

      const subscribed = channel;
      return () => {
        subscribed.subscribers.delete(subscriber);
        if (subscribed.subscribers.size > 0) return;
        if (channelsRef.current.get(key) === subscribed) channelsRef.current.delete(key);
        const current = socketRef.current;
        if (current?.connected) current.emit(CHANNELS[kind].leave, { [idField(kind)]: id }, () => {});
      };
    },
    [joinChannel]
  );

  const addListener = useCallback((listener: EventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const emitAck = useCallback((event: string, payload: unknown) => {
    const socket = socketRef.current;
    if (!socket?.connected) return Promise.resolve<JoinAck>({ ok: false, code: 'NOT_CONNECTED' });
    return new Promise<JoinAck>((resolve) => {
      socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err: Error | null, ack: JoinAck) => {
        resolve(err || !ack ? { ok: false, code: 'TIMEOUT' } : ack);
      });
    });
  }, []);

  return (
    <SocketContext.Provider value={{ status, subscribe, addListener, emitAck }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);

/**
 * Joins `kind:id` while mounted (and again after every reconnection).
 * - `onJoin(ack)`: called with each join result; refetch server state when `ack.ok`.
 * - `onEvent(event, payload)`: every server event whose payload targets this channel
 *   (`payload.roomId` / `payload.playlistId` / `payload.deviceId` equals `id`), including
 *   those sent to the user's personal channel (`room:revoked`, `device:revoked`...).
 * Callbacks may change between renders; the latest ones are used.
 */
export function useSocketChannel(
  kind: ChannelKind,
  id: string | undefined,
  handlers: {
    onJoin?: (ack: JoinAck) => void;
    onEvent?: (event: string, payload: any) => void;
  }
) {
  const { subscribe, addListener } = useSocket();
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!id) return;
    const field = idField(kind);
    const removeListener = addListener((event, payload) => {
      if (payload && payload[field] === id) handlersRef.current.onEvent?.(event, payload);
    });
    const unsubscribe = subscribe(kind, id, {
      onJoin: (ack) => handlersRef.current.onJoin?.(ack),
    });
    return () => {
      removeListener();
      unsubscribe();
    };
  }, [kind, id, subscribe, addListener]);
}
