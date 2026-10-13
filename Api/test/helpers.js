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

import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

const { default: app } = await import('../src/app.js');
const { default: prisma } = await import('../src/lib/prisma.js');
const { default: redis } = await import('../src/lib/redis.js');
const { JWT_SECRET } = await import('../src/middleware/auth.js');

export { prisma };

let server;
let baseUrl;

/** Starts the app on an ephemeral port and returns its base URL. */
export async function startServer() {
  if (server) return baseUrl;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

export async function stopServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await prisma.$disconnect().catch(() => {});
  if (redis) redis.disconnect();
}

/** Wipes all tables touched by the auth/room/vote tests. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Vote", "Track", "RoomInvite", "Room", "RefreshToken", "SystemLog", "User" RESTART IDENTITY CASCADE'
  );
}

export function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, jti: randomUUID() },
    JWT_SECRET,
    { expiresIn: '1h' }
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

export async function createRoom(owner, body) {
  const res = await api('POST', '/api/rooms', { token: owner.token, body });
  if (res.status !== 201) {
    throw new Error(`createRoom failed: ${res.status} ${JSON.stringify(res.body)}`);
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
