import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, resetDb, api, prisma } from './helpers.js';

before(async () => {
  await resetDb();
  await startServer();
});

after(stopServer);

test('protected routes return 401 without token', async () => {
  const res = await api('GET', '/api/rooms/public');
  assert.equal(res.status, 401);

  const me = await api('GET', '/api/users/me');
  assert.equal(me.status, 401);
});

test('invalid token is rejected', async () => {
  const res = await api('GET', '/api/rooms/public', { token: 'not-a-jwt' });
  assert.equal(res.status, 401);
});

test('register then login returns tokens usable on protected routes', async () => {
  const credentials = { email: 'Alice@Test.local', password: 'secret123', name: 'Alice' };

  const reg = await api('POST', '/api/auth/register', { body: credentials });
  assert.equal(reg.status, 201);
  assert.ok(reg.body.accessToken);
  assert.ok(reg.body.refreshToken);
  assert.equal(reg.body.user.email, 'alice@test.local');
  assert.equal(reg.body.user.password, undefined);

  const dup = await api('POST', '/api/auth/register', { body: credentials });
  assert.equal(dup.status, 400);

  const loginBody = { email: credentials.email, password: credentials.password };

  const unverified = await api('POST', '/api/auth/login', { body: loginBody });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.emailVerificationRequired, true);

  const stored = await prisma.user.findUnique({ where: { email: 'alice@test.local' } });
  const verify = await api('POST', '/api/auth/verify-email', {
    body: { email: 'alice@test.local', code: stored.verificationCode },
  });
  assert.equal(verify.status, 200);

  const login = await api('POST', '/api/auth/login', { body: loginBody });
  assert.equal(login.status, 200);
  assert.ok(login.body.accessToken);

  const bad = await api('POST', '/api/auth/login', {
    body: { email: credentials.email, password: 'wrong-password' },
  });
  assert.equal(bad.status, 401);

  const rooms = await api('GET', '/api/rooms/public', { token: reg.body.accessToken });
  assert.equal(rooms.status, 200);
});

test('register validates input', async () => {
  const res = await api('POST', '/api/auth/register', { body: { email: 'x@test.local' } });
  assert.equal(res.status, 400);
});
