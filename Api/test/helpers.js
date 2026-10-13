import 'dotenv/config';

// Tests truncate tables between files, so they only ever run against an
// explicitly configured test database.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set: refusing to run tests, they wipe the database. ' +
      'Set it in Api/.env (see .env.example) to a dedicated test database.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Tests sign their own tokens: fixed secrets (32+ characters, distinct, as the API
// requires) so `npm test` does not depend on the secrets of Api/.env.
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012345678';

// Suites register many devices for the same owner; production keeps the default
// limit. A suite may set its own value before importing this module.
process.env.RATE_LIMIT_DEVICE_REGISTER_MAX ??= '1000';

import { randomUUID } from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';

const { default: app } = await import('../src/app.js');
const { default: prisma } = await import('../src/lib/prisma.js');
const { default: redis } = await import('../src/lib/redis.js');
const { JWT_SECRET } = await import('../src/middleware/auth.js');
const { initRealtime, closeRealtime } = await import('../src/lib/realtime.js');

export { prisma };

let server;
let baseUrl;

const openSockets = new Set();

/**
 * Starts the app with Socket.IO on an ephemeral port and returns its base URL.
 * `realtime` options are passed to `initRealtime` (e.g. `{ redisClient: null }`).
 */
export async function startServer({ realtime } = {}) {
  if (server) return baseUrl;
  server = http.createServer(app);
  await initRealtime(server, realtime);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

/**
 * Starts a second app instance (own HTTP server + Socket.IO, not the one REST
 * controllers emit through). Returns `{ url, io, close }`.
 */
export async function startExtraInstance(realtime = {}) {
  const extra = http.createServer(app);
  const io = await initRealtime(extra, { ...realtime, register: false });
  await new Promise((resolve) => extra.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${extra.address().port}`,
    io,
    close: () => closeRealtime(io),
  };
}

/** True when the shared Redis answers a PING within one second. */
export async function isRedisUp() {
  if (!redis) return false;
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function stopServer() {
  for (const socket of openSockets) socket.disconnect();
  openSockets.clear();
  if (server) {
    await closeRealtime();
    server = null;
  }
  await prisma.$disconnect().catch(() => {});
  if (redis) redis.disconnect();
}

/** Wipes all tables touched by the tests. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ControlDelegation", "Device", "Friendship", "Vote", "Track", "RoomInvite", "Room", "PlaylistTrack", "PlaylistInvite", "Playlist", "RefreshToken", "SystemLog", "User" RESTART IDENTITY CASCADE'
  );
}

export function tokenFor(user, expiresIn = '1h') {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, jti: randomUUID() },
    JWT_SECRET,
    { expiresIn }
  );
}

/** Creates a user directly through Prisma and returns it with a signed access token. */
export async function createUser(name = 'user') {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `${name}-${suffix}@test.local`,
      name: `${name}-${suffix}`,
      isEmailVerified: true,
    },
  });
  return { ...user, token: tokenFor(user) };
}

/** Minimal JSON HTTP client against the running test server. */
export async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, body: data };
}

/**
 * Creates a room. By default the room is held (PAUSED, nothing playing) so suggested
 * tracks stay QUEUED; the live chain autostarts only IDLE rooms. Pass `{ live: true }`
 * to keep the real behavior.
 */
export async function createRoom(owner, body, { live = false } = {}) {
  const res = await api('POST', '/api/rooms', { token: owner.token, body });
  if (res.status !== 201) {
    throw new Error(`createRoom failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  if (!live) {
    await prisma.room.update({ where: { id: res.body.id }, data: { playbackStatus: 'PAUSED' } });
  }
  return res.body;
}

let trackCounter = 0;
export async function suggestTrack(user, roomId, overrides = {}) {
  trackCounter += 1;
  const res = await api('POST', `/api/rooms/${roomId}/tracks`, {
    token: user.token,
    body: {
      externalId: `ext-${trackCounter}-${randomUUID().slice(0, 6)}`,
      title: `Titre ${trackCounter}`,
      artist: 'Artiste',
      ...overrides,
    },
  });
  if (res.status !== 201) {
    throw new Error(`suggestTrack failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Opens a Socket.IO client. `auth` defaults to the user's token plus client info.
 * Resolves once connected; rejects with the server's connect_error otherwise.
 */
export function connectSocket(user, { auth, url = baseUrl } = {}) {
  const socket = ioClient(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: auth ?? { token: user.token, platform: 'test', device: 'node', appVersion: '0.0.0' },
  });
  openSockets.add(socket);
  socket.received = [];
  socket.onAny((event, payload) => socket.received.push({ event, payload }));

  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      openSockets.delete(socket);
      socket.disconnect();
      reject(err);
    });
  });
}

/** Emits `event` with `payload` and resolves with the server ack. */
export function emitAck(socket, event, payload) {
  return socket.timeout(5000).emitWithAck(event, payload);
}

/**
 * Resolves with the first `event` payload (already received or upcoming) matching
 * `predicate`; rejects after `timeoutMs`.
 */
export function waitForEvent(socket, event, predicate = () => true, timeoutMs = 5000) {
  const past = socket.received.find((r) => r.event === event && predicate(r.payload));
  if (past) return Promise.resolve(past.payload);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Makes `a` and `b` accepted friends through the REST API. */
export async function befriend(a, b) {
  const req = await api('POST', '/api/friends/requests', { token: a.token, body: { userId: b.id } });
  if (req.status !== 201) throw new Error(`friend request failed: ${req.status} ${JSON.stringify(req.body)}`);
  const ok = await api('POST', `/api/friends/requests/${req.body.id}/accept`, { token: b.token });
  if (ok.status !== 200) throw new Error(`accept failed: ${ok.status} ${JSON.stringify(ok.body)}`);
  return req.body;
}

/** Registers a device for `user` through the REST API. */
export async function registerDevice(user, overrides = {}) {
  const res = await api('POST', '/api/devices', {
    token: user.token,
    body: {
      name: 'Téléphone',
      platform: 'android',
      installationId: `inst-${randomUUID()}`,
      ...overrides,
    },
  });
  if (res.status !== 201) throw new Error(`registerDevice failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Grants `delegate` control of `deviceId` (owned by `owner`) through the REST API. */
export async function delegateDevice(owner, deviceId, delegate, rights = {}) {
  const res = await api('POST', `/api/devices/${deviceId}/delegations`, {
    token: owner.token,
    body: { userId: delegate.id, ...rights },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`delegateDevice failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
