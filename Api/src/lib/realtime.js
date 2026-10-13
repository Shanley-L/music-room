import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import prisma from './prisma.js';
import sharedRedis, { isTokenBlacklisted } from './redis.js';
import { JWT_SECRET } from '../middleware/auth.js';
import { getRoomById, isUserAllowedInRoom } from '../services/roomService.js';
import { getTracksForRoom } from '../services/trackService.js';
import { isUserAllowedInPlaylist, getPlaylistTracks } from '../services/playlistService.js';
import { canControl, COMMAND_RIGHTS } from '../services/delegationService.js';

/**
 * Socket.IO layer. REST stays the only write path for rooms and playlists:
 * sockets authenticate with the same JWT, join `room:<id>` / `playlist:<id>`
 * channels after the same access checks as REST, and only receive broadcasts.
 * Music Control Delegation relays playback commands and player state between a
 * device's player and its watchers (owner and delegates). See Api/REALTIME.md.
 */

const REDIS_CONNECT_TIMEOUT_MS = 2000;
const MAX_CHANNELS_PER_SOCKET = 50;
// Per-socket limit on `device:command` and on `device:state` (separate budgets):
// at most COMMAND_RATE_MAX within COMMAND_RATE_WINDOW_MS.
const COMMAND_RATE_MAX = 10;
const COMMAND_RATE_WINDOW_MS = 1000;
// Upper bound on a serialized `device:state` payload.
const MAX_STATE_BYTES = 8 * 1024;
// setTimeout delays above this overflow (~24.8 days).
const MAX_TIMER_MS = 2 ** 31 - 1;

let io = null;

export const roomChannel = (roomId) => `room:${roomId}`;
export const playlistChannel = (playlistId) => `playlist:${playlistId}`;
/** Watchers of a device (owner and delegates): receive `device:state`. */
export const deviceChannel = (deviceId) => `device:${deviceId}`;
/** Player sockets of a device (owner only): receive `device:command`. */
export const devicePlayerChannel = (deviceId) => `device-player:${deviceId}`;
/** Every socket of a user, joined automatically: receives `device:revoked`. */
export const userChannel = (userId) => `user:${userId}`;

/** Channels the socket subscribed to (its own id and its user channel excluded). */
function subscribedCount(socket) {
  let count = 0;
  for (const channel of socket.rooms) {
    if (channel !== socket.id && channel !== userChannel(socket.data.userId)) count += 1;
  }
  return count;
}

function clientInfo(socket) {
  const auth = socket.handshake?.auth || {};
  const headers = socket.handshake?.headers || {};
  return {
    platform: String(auth.platform || headers['x-platform'] || headers['user-agent'] || 'Unknown Platform'),
    device: String(auth.device || headers['x-device'] || 'Unknown Device'),
    appVersion: String(auth.appVersion || headers['x-app-version'] || '1.0.0'),
    ip: String(socket.handshake?.address || ''),
  };
}

/** Logs a socket action in the same format as the HTTP request logger, and persists it. */
function logSocket(socket, action, status, userId = socket.data?.userId || null) {
  const { platform, device, appVersion, ip } = clientInfo(socket);
  console.log(
    `[LOG] ${new Date().toISOString()} | WS ${action} ${status} | ` +
      `Platform: ${platform} | Device: ${device} | Version: ${appVersion} | User: ${userId || 'anon'}`
  );

  prisma.systemLog
    .create({
      data: {
        userId,
        action: `WS ${action}`,
        method: 'WS',
        endpoint: action.slice(0, 191),
        platform: platform.slice(0, 100),
        device: device.slice(0, 100),
        appVersion: appVersion.slice(0, 50),
        ip: ip.slice(0, 50),
        statusCode: status,
      },
    })
    .catch(() => {
      // Logging must never break the socket flow
    });
}

/** Client-supplied ids are truncated and stripped of line breaks before logging. */
function logId(id) {
  return String(id).slice(0, 64).replace(/[\r\n]/g, ' ');
}

/** Disconnects the socket when its JWT expires; cleared on disconnect. */
function scheduleExpiry(socket, exp) {
  if (typeof exp !== 'number') return;
  const delay = Math.min(Math.max(exp * 1000 - Date.now(), 0), MAX_TIMER_MS);
  const timer = setTimeout(() => {
    logSocket(socket, 'token-expired', 401);
    socket.disconnect(true);
  }, delay);
  socket.once('disconnect', () => clearTimeout(timer));
}

async function authenticate(socket, next) {
  const token = socket.handshake?.auth?.token;
  try {
    if (typeof token !== 'string' || token.length === 0) throw new Error('missing token');
    if (await isTokenBlacklisted(token)) throw new Error('blacklisted token');
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.sub) throw new Error('invalid token');
    socket.data.userId = decoded.sub;
    socket.data.user = { id: decoded.sub, email: decoded.email, name: decoded.name };
    socket.data.exp = decoded.exp;
    return next();
  } catch {
    logSocket(socket, 'connect', 401, null);
    const err = new Error('UNAUTHORIZED');
    err.data = { code: 'UNAUTHORIZED' };
    return next(err);
  }
}

function idFrom(payload, key) {
  const id = payload?.[key];
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

function safeAck(ack, value) {
  if (typeof ack === 'function') ack(value);
}

async function handleRoomJoin(socket, payload, ack) {
  const roomId = idFrom(payload, 'roomId');
  if (!roomId) {
    logSocket(socket, 'room:join', 400);
    return safeAck(ack, { ok: false, code: 'VALIDATION_ERROR' });
  }

  const check = async () => {
    const room = await getRoomById(roomId);
    if (!room) return 'ROOM_NOT_FOUND';
    if (!(await isUserAllowedInRoom(room, socket.data.userId))) return 'ROOM_FORBIDDEN';
    return null;
  };

  return joinChecked(socket, ack, roomChannel(roomId), `room:join ${logId(roomId)}`, check);
}

const STATUS_BY_CODE = {
  ROOM_NOT_FOUND: 404,
  PLAYLIST_NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  TOO_MANY_CHANNELS: 429,
  DEVICE_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  DEVICE_OFFLINE: 503,
};

/**
 * Joins `channel` when `check()` returns null. Access is checked again after
 * joining: a revocation committed between the first check and the join (whose
 * eviction would have missed this socket) is caught by the second one.
 */
async function joinChecked(socket, ack, channel, action, check) {
  let code = null;
  // Tokens revoked (logout) after the handshake can no longer subscribe.
  if (await isTokenBlacklisted(socket.handshake.auth.token)) code = 'UNAUTHORIZED';
  else if (!socket.rooms.has(channel) && subscribedCount(socket) >= MAX_CHANNELS_PER_SOCKET) {
    code = 'TOO_MANY_CHANNELS';
  } else code = await check();

  if (!code) {
    await socket.join(channel);
    try {
      code = await check();
    } catch (err) {
      await socket.leave(channel);
      throw err; // answered INTERNAL_ERROR by `guarded`
    }
    if (code) await socket.leave(channel);
  }

  if (code) {
    logSocket(socket, action, STATUS_BY_CODE[code] || 403);
    return safeAck(ack, { ok: false, code });
  }

  logSocket(socket, action, 200);
  return safeAck(ack, { ok: true });
}

async function handlePlaylistJoin(socket, payload, ack) {
  const playlistId = idFrom(payload, 'playlistId');
  if (!playlistId) {
    logSocket(socket, 'playlist:join', 400);
    return safeAck(ack, { ok: false, code: 'VALIDATION_ERROR' });
  }

  const check = async () => {
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      include: { invites: true },
    });
    if (!playlist) return 'PLAYLIST_NOT_FOUND';
    if (!(await isUserAllowedInPlaylist(playlist, socket.data.userId))) return 'PLAYLIST_FORBIDDEN';
    return null;
  };

  return joinChecked(
    socket,
    ack,
    playlistChannel(playlistId),
    `playlist:join ${logId(playlistId)}`,
    check
  );
}

async function handleLeave(socket, payload, ack, key, channelOf, action) {
  const id = idFrom(payload, key);
  if (!id) return safeAck(ack, { ok: false, code: 'VALIDATION_ERROR' });
  await socket.leave(channelOf(id));
  logSocket(socket, `${action} ${logId(id)}`, 200);
  return safeAck(ack, { ok: true });
}

// ---------------------------------------------------------------------------
// Music Control Delegation
// ---------------------------------------------------------------------------

/** Owner registers one of their sockets as the player of a device. */
async function handleDeviceRegister(socket, payload, ack) {
  const deviceId = idFrom(payload, 'deviceId');
  if (!deviceId) {
    logSocket(socket, 'device:register', 400);
    return safeAck(ack, { ok: false, code: 'VALIDATION_ERROR' });
  }

  const check = async () => {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { userId: true },
    });
    if (!device) return 'DEVICE_NOT_FOUND';
    if (device.userId !== socket.data.userId) return 'DEVICE_FORBIDDEN';
    return null;
  };

  return joinChecked(
    socket,
    ack,
    devicePlayerChannel(deviceId),
    `device:register ${logId(deviceId)}`,
    check
  );
}

/** Owner or active delegate subscribes to a device's player state. */
async function handleDeviceWatch(socket, payload, ack) {
  const deviceId = idFrom(payload, 'deviceId');
  if (!deviceId) {
    logSocket(socket, 'device:watch', 400);
    return safeAck(ack, { ok: false, code: 'VALIDATION_ERROR' });
  }

  const check = async () => {
    const access = await canControl(socket.data.userId, deviceId);
    return access.ok ? null : access.code;
  };

  return joinChecked(socket, ack, deviceChannel(deviceId), `device:watch ${logId(deviceId)}`, check);
}

/** Per-socket sliding-window limiter, one budget per `bucket`; true when the event may proceed. */
function takeSlot(socket, bucket) {
  const now = Date.now();
  socket.data.rate ??= {};
  const recent = (socket.data.rate[bucket] || []).filter((t) => now - t < COMMAND_RATE_WINDOW_MS);
  const allowed = recent.length < COMMAND_RATE_MAX;
  if (allowed) recent.push(now);
  socket.data.rate[bucket] = recent;
  return allowed;
}

// Per-device chains: commands for one device are checked and relayed in the
// order the server received them.
const commandChains = new Map();

function inDeviceOrder(deviceId, task) {
  const previous = commandChains.get(deviceId) || Promise.resolve();
  const run = previous.then(task);
  const tail = run.catch(() => {});
  commandChains.set(deviceId, tail);
  tail.then(() => {
    if (commandChains.get(deviceId) === tail) commandChains.delete(deviceId);
  });
  return run;
}

function parseCommand(payload) {
  const deviceId = idFrom(payload, 'deviceId');
  const command = payload?.command;
  if (!deviceId || typeof command !== 'string' || !Object.hasOwn(COMMAND_RIGHTS, command)) {
    return null;
  }
  let value = null;
  if (command === 'setVolume') {
    value = payload.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  }
  return { deviceId, command, value };
}

/**
 * Owner or delegate sends a playback command. Access and the right for this
 * command are re-read from the database every time, then the command is relayed
 * to the device's player sockets. Never executed server-side.
 */
async function handleDeviceCommand(socket, payload, ack) {
  if (!takeSlot(socket, 'command')) {
    logSocket(socket, 'device:command', 429);
    return safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
  }

  const parsed = parseCommand(payload);
  if (!parsed) {
    logSocket(socket, 'device:command', 400);
    return safeAck(ack, { ok: false, code: 'VALIDATION_ERROR' });
  }
  const { deviceId, command, value } = parsed;
  const action = `device:command ${logId(deviceId)} ${command}`;

  return inDeviceOrder(deviceId, async () => {
    let code = null;
    if (await isTokenBlacklisted(socket.handshake.auth.token)) code = 'UNAUTHORIZED';
    else {
      const access = await canControl(socket.data.userId, deviceId, command);
      if (!access.ok) code = access.code;
    }

    const players = devicePlayerChannel(deviceId);
    if (!code && (await socket.nsp.in(players).fetchSockets()).length === 0) code = 'DEVICE_OFFLINE';

    if (code) {
      logSocket(socket, action, STATUS_BY_CODE[code] || 403);
      return safeAck(ack, { ok: false, code });
    }

    const { id, name } = socket.data.user;
    socket.nsp.to(players).emit('device:command', {
      deviceId,
      command,
      value,
      from: { id, name: name ?? null },
    });
    logSocket(socket, action, 200);
    return safeAck(ack, { ok: true });
  });
}

/**
 * The device's player (an owner socket registered with `device:register`)
 * publishes the playback state to all watchers.
 */
async function handleDeviceState(socket, payload, ack) {
  if (!takeSlot(socket, 'state')) {
    logSocket(socket, 'device:state', 429);
    return safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
  }

  const deviceId = idFrom(payload, 'deviceId');
  const state = payload?.state;
  let valid = !!deviceId && state !== null && typeof state === 'object' && !Array.isArray(state);
  if (valid) {
    try {
      valid = Buffer.byteLength(JSON.stringify(state)) <= MAX_STATE_BYTES;
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    logSocket(socket, 'device:state', 400);
    return safeAck(ack, { ok: false, code: 'VALIDATION_ERROR' });
  }

  const action = `device:state ${logId(deviceId)}`;
  let code = null;
  if (await isTokenBlacklisted(socket.handshake.auth.token)) code = 'UNAUTHORIZED';
  else if (!socket.rooms.has(devicePlayerChannel(deviceId))) code = 'DEVICE_FORBIDDEN';
  else {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { userId: true },
    });
    if (!device) code = 'DEVICE_NOT_FOUND';
    else if (device.userId !== socket.data.userId) code = 'DEVICE_FORBIDDEN';
  }
  if (code) {
    logSocket(socket, action, STATUS_BY_CODE[code] || 403);
    return safeAck(ack, { ok: false, code });
  }

  socket.nsp.to(deviceChannel(deviceId)).emit('device:state', {
    deviceId,
    state,
    at: new Date().toISOString(),
  });
  logSocket(socket, action, 200);
  return safeAck(ack, { ok: true });
}

/** Wraps an async event handler so failures answer `INTERNAL_ERROR` instead of crashing. */
function guarded(socket, action, handler) {
  return async (payload, ack) => {
    if (typeof payload === 'function' && ack === undefined) {
      ack = payload;
      payload = undefined;
    }
    try {
      await handler(socket, payload, ack);
    } catch (err) {
      console.error(`[Realtime] ${action} failed`, err);
      logSocket(socket, action, 500);
      safeAck(ack, { ok: false, code: 'INTERNAL_ERROR' });
    }
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Builds pub/sub clients for the Redis adapter, or returns null when Redis is not
 * reachable (the caller then keeps the default in-memory adapter).
 */
async function connectAdapterClients(redisClient) {
  if (!redisClient || typeof redisClient.duplicate !== 'function') return null;

  const pub = redisClient.duplicate({ lazyConnect: true });
  const sub = redisClient.duplicate({ lazyConnect: true });
  const swallow = () => {};
  pub.on('error', swallow);
  sub.on('error', swallow);

  try {
    await withTimeout(Promise.all([pub.connect(), sub.connect()]), REDIS_CONNECT_TIMEOUT_MS);
  } catch {
    pub.disconnect();
    sub.disconnect();
    return null;
  }

  // A Redis outage after startup must not turn broadcasts into unhandled rejections.
  const publish = pub.publish.bind(pub);
  pub.publish = (...args) =>
    publish(...args).catch((err) => {
      console.error('[Realtime] Redis publish failed:', err?.message || err);
      return 0;
    });

  return { pub, sub };
}

/**
 * Attaches Socket.IO to `httpServer`. Uses the Redis adapter when Redis is
 * reachable, otherwise the in-memory adapter. Returns the io server.
 * Options: `redisClient` (defaults to the shared client; `null` forces in-memory).
 */
export async function initRealtime(
  httpServer,
  { redisClient = sharedRedis, register = true } = {}
) {
  const server = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*' },
  });

  // The adapter is chosen once, at boot: Redis coming up later is not picked up.
  const clients = await connectAdapterClients(redisClient);
  if (clients) {
    server.adapter(createAdapter(clients.pub, clients.sub));
    server.realtimeClients = [clients.pub, clients.sub];
    console.log('[Realtime] Socket.IO using Redis adapter');
  } else {
    server.realtimeClients = [];
    console.log('[Realtime] Redis unavailable, Socket.IO using in-memory adapter');
  }

  server.use(authenticate);

  server.on('connection', (socket) => {
    logSocket(socket, 'connect', 101);
    scheduleExpiry(socket, socket.data.exp);
    // Per-user channel (not counted in the channel cap), used for `device:revoked`.
    socket.join(userChannel(socket.data.userId));

    socket.on('room:join', guarded(socket, 'room:join', handleRoomJoin));
    socket.on(
      'room:leave',
      guarded(socket, 'room:leave', (s, p, a) => handleLeave(s, p, a, 'roomId', roomChannel, 'room:leave'))
    );
    socket.on('playlist:join', guarded(socket, 'playlist:join', handlePlaylistJoin));
    socket.on(
      'playlist:leave',
      guarded(socket, 'playlist:leave', (s, p, a) =>
        handleLeave(s, p, a, 'playlistId', playlistChannel, 'playlist:leave')
      )
    );

    socket.on('device:register', guarded(socket, 'device:register', handleDeviceRegister));
    socket.on(
      'device:unregister',
      guarded(socket, 'device:unregister', (s, p, a) =>
        handleLeave(s, p, a, 'deviceId', devicePlayerChannel, 'device:unregister')
      )
    );
    socket.on('device:watch', guarded(socket, 'device:watch', handleDeviceWatch));
    socket.on(
      'device:unwatch',
      guarded(socket, 'device:unwatch', (s, p, a) =>
        handleLeave(s, p, a, 'deviceId', deviceChannel, 'device:unwatch')
      )
    );
    socket.on('device:command', guarded(socket, 'device:command', handleDeviceCommand));
    socket.on('device:state', guarded(socket, 'device:state', handleDeviceState));

    socket.on('disconnect', () => logSocket(socket, 'disconnect', 200));
  });

  // `register: false` builds an extra server (e.g. a second instance in tests)
  // that is not the one REST controllers emit through.
  if (register) io = server;
  return server;
}

/**
 * Closes an io server (default: the registered one), the HTTP server it is
 * attached to, and its adapter clients.
 */
export async function closeRealtime(target = io) {
  if (!target) return;
  if (target === io) io = null;
  await new Promise((resolve) => target.close(() => resolve()));
  for (const client of target.realtimeClients || []) client.disconnect();
}

export function getIo() {
  return io;
}

export function emitToRoom(roomId, event, payload) {
  if (!io) return;
  io.to(roomChannel(roomId)).emit(event, payload);
}

export function emitToPlaylist(playlistId, event, payload) {
  if (!io) return;
  io.to(playlistChannel(playlistId)).emit(event, payload);
}

// Per-channel promise chains: each "state" broadcast reads the state fresh from the
// database once the previous one for the same channel has been sent, so the last
// event a client receives always reflects the latest committed state, even when
// concurrent writes finish out of order.
const stateChains = new Map();

function emitFreshState(key, load, send) {
  if (!io) return Promise.resolve();
  const previous = stateChains.get(key) || Promise.resolve();
  const next = previous
    .then(async () => {
      const state = await load();
      send(state);
    })
    .catch((err) => console.error(`[Realtime] broadcast ${key} failed`, err));
  stateChains.set(key, next);
  next.finally(() => {
    if (stateChains.get(key) === next) stateChains.delete(key);
  });
  return next;
}

/** Broadcasts `queue:updated {roomId, queue}` with the current server queue. */
export function emitRoomQueue(roomId) {
  return emitFreshState(
    `queue:${roomId}`,
    () => getTracksForRoom(roomId),
    (queue) => emitToRoom(roomId, 'queue:updated', { roomId, queue })
  );
}

/** Broadcasts `playlist:tracks-updated {playlistId, tracks}` with the full ordered list. */
export function emitPlaylistTracks(playlistId) {
  return emitFreshState(
    `tracks:${playlistId}`,
    () => getPlaylistTracks(playlistId),
    (tracks) => emitToPlaylist(playlistId, 'playlist:tracks-updated', { playlistId, tracks })
  );
}

/**
 * Removes matching sockets from a channel (works across instances with the Redis
 * adapter). `filter(socket)` receives sockets with `data.userId`; omitted = all.
 */
async function evict(channel, filter) {
  if (!io) return;
  // Called after a committed write: a failure here is logged, never surfaced as a 500.
  try {
    const sockets = await io.in(channel).fetchSockets();
    await Promise.all(
      sockets.filter((s) => !filter || filter(s)).map((s) => s.leave(channel))
    );
  } catch (err) {
    console.error(`[Realtime] eviction from ${channel} failed`, err);
  }
}

/** Removes `userId`'s sockets from a room channel; no userId removes everyone. */
export function evictFromRoom(roomId, userId) {
  return evict(roomChannel(roomId), userId ? (s) => s.data?.userId === userId : undefined);
}

/** Removes sockets of a playlist channel matching `filter` (all when omitted). */
export function evictFromPlaylist(playlistId, filter) {
  return evict(playlistChannel(playlistId), filter);
}

/**
 * A user lost control of a device (delegation revoked, friendship ended): their
 * sockets stop watching it, then receive `device:revoked { deviceId, reason }`.
 * Never throws.
 */
export async function revokeDeviceAccess(deviceId, userId, reason = 'REVOKED') {
  if (!io) return;
  await evict(deviceChannel(deviceId), (s) => s.data?.userId === userId);
  try {
    io.to(userChannel(userId)).emit('device:revoked', { deviceId, reason });
  } catch (err) {
    console.error(`[Realtime] device:revoked to ${userId} failed`, err);
  }
}

/**
 * A device was deleted: every socket leaves its watcher and player channels and
 * each former delegate receives `device:revoked { deviceId, reason: 'DEVICE_DELETED' }`.
 * Never throws.
 */
export async function closeDevice(deviceId, delegateIds = []) {
  if (!io) return;
  await evict(deviceChannel(deviceId));
  await evict(devicePlayerChannel(deviceId));
  for (const userId of new Set(delegateIds)) {
    try {
      io.to(userChannel(userId)).emit('device:revoked', { deviceId, reason: 'DEVICE_DELETED' });
    } catch (err) {
      console.error(`[Realtime] device:revoked to ${userId} failed`, err);
    }
  }
}

/**
 * A delegation was granted or its rights changed: the delegate's sockets receive
 * `delegation:updated { deviceId, rights, active }`. Never throws.
 */
export function notifyDelegationUpdated(delegation) {
  if (!io || !delegation) return;
  const { deviceId, canPlayPause, canSkip, canVolume, active } = delegation;
  const delegateId = delegation.delegate?.id ?? delegation.delegateId;
  try {
    io.to(userChannel(delegateId)).emit('delegation:updated', {
      deviceId,
      rights: { canPlayPause, canSkip, canVolume },
      active,
    });
  } catch (err) {
    console.error(`[Realtime] delegation:updated to ${delegateId} failed`, err);
  }
}
