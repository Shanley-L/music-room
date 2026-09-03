import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { socketAuthMiddleware } from '../src/middleware/auth.js';

function fakeSocket(auth) {
  const socket = { handshake: { auth }, user: null, meta: null };
  return socket;
}

function makeNext() {
  const calls = [];
  const next = (err) => calls.push(err ?? null);
  return { calls, next };
}

function signJwt(secret, claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('socketAuthMiddleware (dev) — accepte le repli x-dev-user-id du payload auth', () => {
  const socket = fakeSocket({ 'x-dev-user-id': 'u1', platform: 'ios', device: 'iPhone', appVersion: '1.0.0' });
  const { calls, next } = makeNext();

  socketAuthMiddleware(socket, next);

  assert.equal(calls.length, 1);
  assert.equal(calls[0], null);
  assert.equal(socket.user.id, 'u1');
  assert.equal(socket.meta.platform, 'ios');
  assert.equal(socket.meta.device, 'iPhone');
  assert.equal(socket.meta.appVersion, '1.0.0');
});

test('socketAuthMiddleware (dev) — rejette sans identifiant dans le payload auth', () => {
  const socket = fakeSocket({});
  const { calls, next } = makeNext();

  socketAuthMiddleware(socket, next);

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test('socketAuthMiddleware (production) — rejette x-dev-user-id sans JWT (AC #3)', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const socket = fakeSocket({ 'x-dev-user-id': 'u1' });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Error);
    assert.match(calls[0].message, /JWT/i);
    assert.equal(socket.user, null);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('socketAuthMiddleware (production) — rejette un JWT invalide', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  try {
    const socket = fakeSocket({ token: 'not.a.jwt' });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Error);
    assert.match(calls[0].message, /Jeton invalide/i);
    assert.equal(socket.user, null);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.JWT_SECRET = prevSecret;
  }
});

test('socketAuthMiddleware (production) — accepte un JWT valide (claims.sub)', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  try {
    const token = signJwt('test-secret', { sub: 'user-42', platform: 'android' });
    const socket = fakeSocket({ token });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], null);
    assert.equal(socket.user.id, 'user-42');
    assert.equal(socket.meta.platform, 'android');
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.JWT_SECRET = prevSecret;
  }
});

test('socketAuthMiddleware (production) — rejette un JWT mal signé', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  try {
    const token = signJwt('wrong-secret', { sub: 'user-42' });
    const socket = fakeSocket({ token });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Error);
    assert.match(calls[0].message, /Jeton invalide/i);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.JWT_SECRET = prevSecret;
  }
});

test('socketAuthMiddleware (production) — rejette un JWT expiré (claims.exp)', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  try {
    const token = signJwt('test-secret', { sub: 'user-42', exp: Math.floor(Date.now() / 1000) - 60 });
    const socket = fakeSocket({ token });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Error);
    assert.match(calls[0].message, /Jeton invalide/i);
    assert.equal(socket.user, null);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.JWT_SECRET = prevSecret;
  }
});

test('socketAuthMiddleware (production) — rejette un JWT non encore valide (claims.nbf)', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  try {
    const token = signJwt('test-secret', { sub: 'user-42', nbf: Math.floor(Date.now() / 1000) + 3600 });
    const socket = fakeSocket({ token });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Error);
    assert.match(calls[0].message, /Jeton invalide/i);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.JWT_SECRET = prevSecret;
  }
});

test('socketAuthMiddleware (production) — accepte un JWT valide non expiré', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  try {
    const token = signJwt('test-secret', { sub: 'user-42', exp: Math.floor(Date.now() / 1000) + 3600 });
    const socket = fakeSocket({ token });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], null);
    assert.equal(socket.user.id, 'user-42');
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.JWT_SECRET = prevSecret;
  }
});

test('socketAuthMiddleware (production) — rejette un sub non-string', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret';
  try {
    const token = signJwt('test-secret', { sub: 42 });
    const socket = fakeSocket({ token });
    const { calls, next } = makeNext();

    socketAuthMiddleware(socket, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Error);
    assert.match(calls[0].message, /Jeton invalide/i);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.JWT_SECRET = prevSecret;
  }
});