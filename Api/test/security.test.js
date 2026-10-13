import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Low limits for this suite only; read when the limiters are created, so they must
// be set before the app is imported (static imports are hoisted: import helpers
// dynamically).
process.env.RATE_LIMIT_JOIN_CODE_MAX = '5';
process.env.RATE_LIMIT_USER_SEARCH_MAX = '3';
process.env.RATE_LIMIT_FRIEND_REQUEST_MAX = '3';
process.env.RATE_LIMIT_VOTE_MAX = '3';
process.env.RATE_LIMIT_DEVICE_REGISTER_MAX = '2';
process.env.RATE_LIMIT_AUTH_MAX = '3';
delete process.env.RATE_LIMIT_DISABLED;

const {
  startServer,
  stopServer,
  resetDb,
  api,
  createUser,
  createRoom,
  suggestTrack,
  befriend,
  registerDevice,
  connectSocket,
  emitAck,
  sleep,
  prisma,
} = await import('./helpers.js');
const { requestLogger, sanitizeLogValue } = await import('../src/middleware/logger.js');
const { positiveInt } = await import('../src/middleware/rateLimit.js');
const { parseTrustProxy } = await import('../src/app.js');
const authService = await import('../src/services/authService.js');

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;

let baseUrl;

before(async () => {
  await resetDb();
  baseUrl = await startServer();
});

after(stopServer);

function assertRateLimited(res) {
  assert.equal(res.status, 429);
  assert.equal(res.body.code, 'RATE_LIMITED');
  assert.equal(typeof res.body.error, 'string');
}

async function createPlaylist(owner, body = {}) {
  const res = await api('POST', '/api/playlists', {
    token: owner.token,
    body: { name: 'Playlist', visibility: 'PRIVATE', ...body },
  });
  assert.equal(res.status, 201);
  return res.body.playlist;
}

/** Polls SystemLog until `where` matches a row (logs are written after the response). */
async function waitForLog(where, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.systemLog.findFirst({ where, orderBy: { createdAt: 'desc' } });
    if (row || Date.now() > deadline) return row;
    await sleep(50);
  }
}

describe('JWT secrets', () => {
  const GOOD = 'a'.repeat(40);

  function startWith(overrides) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['src/server.js'], {
        cwd: API_DIR,
        // Empty values are not overwritten by dotenv and count as unset.
        env: { ...process.env, PORT: '0', ...overrides },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('process started with an invalid secret configuration'));
      }, 15000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });
  }

  for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    test(`the API refuses to start without ${name}`, async () => {
      const { code, output } = await startWith({ [name]: '' });
      assert.notEqual(code, 0);
      assert.ok(output.includes(`[Config] ${name} is not set: refusing to start.`), output);
    });

    test(`the API refuses to start with a ${name} shorter than 32 characters`, async () => {
      const { code, output } = await startWith({ [name]: 'x'.repeat(31) });
      assert.notEqual(code, 0);
      assert.ok(
        output.includes(`[Config] ${name} is too short (31 characters, 32 minimum): refusing to start.`),
        output
      );
    });
  }

  test('the API refuses to start when both secrets are equal', async () => {
    const { code, output } = await startWith({ JWT_SECRET: GOOD, JWT_REFRESH_SECRET: GOOD });
    assert.notEqual(code, 0);
    assert.ok(
      output.includes('[Config] JWT_SECRET and JWT_REFRESH_SECRET must be different: refusing to start.'),
      output
    );
  });
});

describe('configuration parsing', () => {
  test('rate limit overrides only accept whole positive numbers', () => {
    assert.equal(positiveInt('7', 3), 7);
    assert.equal(positiveInt(' 12 ', 3), 12);
    for (const bad of [undefined, '', '0', '-2', '1.5', '10abc', 'abc', '1e3x']) {
      assert.equal(positiveInt(bad, 3), 3, String(bad));
    }
  });

  test('TRUST_PROXY is off by default', () => {
    for (const off of [undefined, '', 'false', '0']) assert.equal(parseTrustProxy(off), false);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy('loopback'), 'loopback');
  });
});

describe('authentication brute force', () => {
  test('auth endpoints answer 429 RATE_LIMITED past the per-IP limit', async () => {
    const body = { email: 'nobody@test.local', password: 'wrong-password' };
    for (let i = 0; i < 3; i += 1) {
      const res = await api('POST', '/api/auth/login', { body });
      assert.notEqual(res.status, 429);
    }
    assertRateLimited(await api('POST', '/api/auth/login', { body }));
    assertRateLimited(await api('POST', '/api/auth/verify-email', { body: { email: 'x@test.local', code: '1' } }));
  });

  async function userWith(data) {
    const user = await createUser('otp');
    return prisma.user.update({ where: { id: user.id }, data });
  }

  test('email verification: a code allows 5 attempts, then it is replaced', async () => {
    const user = await userWith({ isEmailVerified: false, verificationCode: '123456' });
    for (let i = 0; i < 4; i += 1) {
      const res = await authService.verifyEmail(user.email, '000000');
      assert.equal(res.code, 'INVALID_CODE');
    }
    const fifth = await authService.verifyEmail(user.email, '000000');
    assert.equal(fifth.code, 'CODE_ATTEMPTS_EXCEEDED');

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.match(after.verificationCode, /^\d{6}$/);
    assert.notEqual(after.verificationCode, '123456');
    assert.equal(after.isEmailVerified, false);

    const old = await authService.verifyEmail(user.email, '123456');
    assert.equal(old.code, 'INVALID_CODE');

    // The new code gets a fresh budget and works.
    const ok = await authService.verifyEmail(user.email, after.verificationCode);
    assert.equal(ok.success, true);
  });

  test('email verification: the right code within the budget validates', async () => {
    const user = await userWith({ isEmailVerified: false, verificationCode: '654321' });
    await authService.verifyEmail(user.email, '000000');
    const ok = await authService.verifyEmail(user.email, '654321');
    assert.equal(ok.success, true);
  });

  test('password reset: a code allows 5 attempts, then it is invalidated', async () => {
    const user = await userWith({ password: 'hash' });
    await authService.forgotPassword(user.email);
    const { resetPasswordCode } = await prisma.user.findUnique({ where: { id: user.id } });
    assert.match(resetPasswordCode, /^\d{6}$/);
    const wrong = resetPasswordCode === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i += 1) {
      const res = await authService.resetPassword(user.email, wrong, 'new-password');
      assert.equal(res.code, 'INVALID_CODE');
    }
    const fifth = await authService.resetPassword(user.email, wrong, 'new-password');
    assert.equal(fifth.code, 'CODE_ATTEMPTS_EXCEEDED');

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(after.resetPasswordCode, null);
    assert.equal(after.password, 'hash');

    const old = await authService.resetPassword(user.email, resetPasswordCode, 'new-password');
    assert.equal(old.code, 'INVALID_CODE');

    // A new code (forgot-password) gets a fresh budget.
    await authService.forgotPassword(user.email);
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    const ok = await authService.resetPassword(user.email, fresh.resetPasswordCode, 'new-password');
    assert.equal(ok.success, true);
  });
});

describe('invite code bruteforce', () => {
  test('joins by code share one budget across rooms and playlists, then 429', async () => {
    const attacker = await createUser('attacker');
    for (let i = 0; i < 3; i += 1) {
      const res = await api('POST', '/api/rooms/join', { token: attacker.token, body: { inviteCode: `WRONG${i}` } });
      assert.equal(res.status, 404);
    }
    for (let i = 0; i < 2; i += 1) {
      const res = await api('POST', '/api/playlists/join', { token: attacker.token, body: { inviteCode: `WRONG${i}` } });
      assert.equal(res.status, 404);
    }
    assertRateLimited(await api('POST', '/api/rooms/join', { token: attacker.token, body: { inviteCode: 'WRONG9' } }));
    assertRateLimited(await api('POST', '/api/playlists/join', { token: attacker.token, body: { inviteCode: 'WRONG9' } }));

    // The limit is per user: someone else still joins with a valid code.
    const owner = await createUser('owner');
    const guest = await createUser('guest');
    const room = await createRoom(owner, { name: 'Privée', visibility: 'PRIVATE' });
    const ok = await api('POST', '/api/rooms/join', { token: guest.token, body: { inviteCode: room.inviteCode } });
    assert.equal(ok.status, 200);
  });

  test('successful joins do not count', async () => {
    const owner = await createUser('owner');
    const guest = await createUser('guest');
    const room = await createRoom(owner, { name: 'Privée', visibility: 'PRIVATE' });
    for (let i = 0; i < 8; i += 1) {
      const ok = await api('POST', '/api/rooms/join', { token: guest.token, body: { inviteCode: room.inviteCode } });
      assert.equal(ok.status, 200);
    }
    const wrong = await api('POST', '/api/rooms/join', { token: guest.token, body: { inviteCode: 'WRONG' } });
    assert.equal(wrong.status, 404);
  });
});

describe('search and friend request spam', () => {
  test('user search is limited per user', async () => {
    const user = await createUser('searcher');
    for (let i = 0; i < 3; i += 1) {
      const res = await api('GET', '/api/users/search?q=ab', { token: user.token });
      assert.equal(res.status, 200);
    }
    assertRateLimited(await api('GET', '/api/users/search?q=ab', { token: user.token }));
  });

  test('friend requests are limited per user', async () => {
    const spammer = await createUser('spammer');
    for (let i = 0; i < 3; i += 1) {
      const target = await createUser('target');
      const res = await api('POST', '/api/friends/requests', { token: spammer.token, body: { userId: target.id } });
      assert.equal(res.status, 201);
    }
    const target = await createUser('target');
    assertRateLimited(
      await api('POST', '/api/friends/requests', { token: spammer.token, body: { userId: target.id } })
    );
  });

  test('device registration is limited per user', async () => {
    const user = await createUser('devices');
    await registerDevice(user);
    await registerDevice(user);
    assertRateLimited(
      await api('POST', '/api/devices', {
        token: user.token,
        body: { name: 'x', platform: 'android', installationId: 'inst-flood' },
      })
    );
  });
});

describe('vote flood', () => {
  test('votes and unvotes are limited per user, other voters are unaffected', async () => {
    const owner = await createUser('owner');
    const voter = await createUser('voter');
    const other = await createUser('other');
    const room = await createRoom(owner, { name: 'Votes' });
    const track = await suggestTrack(owner, room.id);
    const path = `/api/rooms/${room.id}/tracks/${track.id}/vote`;

    assert.equal((await api('POST', path, { token: voter.token })).status, 200);
    assert.equal((await api('DELETE', path, { token: voter.token })).status, 200);
    assert.equal((await api('POST', path, { token: voter.token })).status, 200);
    assertRateLimited(await api('DELETE', path, { token: voter.token }));

    assert.equal((await api('POST', path, { token: other.token })).status, 200);
  });
});

describe('profile isolation', () => {
  let owner;
  before(async () => {
    owner = await createUser('profile');
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        bio: 'public bio',
        musicPreferences: 'jazz',
        friendsInfo: 'friends only',
        privateInfo: 'private only',
        password: 'hash',
      },
    });
  });

  const SECRET_FIELDS = ['password', 'verificationCode', 'resetPasswordCode', 'resetPasswordExpires'];
  const PRIVATE_FIELDS = ['email', 'privateInfo', 'googleId', 'facebookId', 'isEmailVerified', ...SECRET_FIELDS];

  test('an anonymous caller sees public fields only', async () => {
    const res = await api('GET', `/api/users/${owner.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.bio, 'public bio');
    for (const field of ['friendsInfo', ...PRIVATE_FIELDS]) assert.equal(res.body[field], undefined, field);
  });

  test('a stranger sees public fields only', async () => {
    const stranger = await createUser('stranger');
    const res = await api('GET', `/api/users/${owner.id}`, { token: stranger.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.bio, 'public bio');
    assert.equal(res.body.musicPreferences, 'jazz');
    for (const field of ['friendsInfo', ...PRIVATE_FIELDS]) assert.equal(res.body[field], undefined, field);
  });

  test('a pending friend request does not unlock friends fields', async () => {
    const pending = await createUser('pending');
    const req = await api('POST', '/api/friends/requests', { token: pending.token, body: { userId: owner.id } });
    assert.equal(req.status, 201);
    const res = await api('GET', `/api/users/${owner.id}`, { token: pending.token });
    assert.equal(res.body.friendsInfo, undefined);
  });

  test('an accepted friend sees public + friends fields, no private ones', async () => {
    const friend = await createUser('friend');
    await befriend(owner, friend);
    const res = await api('GET', `/api/users/${owner.id}`, { token: friend.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.bio, 'public bio');
    assert.equal(res.body.friendsInfo, 'friends only');
    for (const field of PRIVATE_FIELDS) assert.equal(res.body[field], undefined, field);
  });

  test('the owner sees every field except secrets', async () => {
    for (const path of [`/api/users/${owner.id}`, '/api/users/me']) {
      const res = await api('GET', path, { token: owner.token });
      assert.equal(res.status, 200);
      assert.equal(res.body.privateInfo, 'private only');
      assert.equal(res.body.friendsInfo, 'friends only');
      assert.equal(res.body.email, owner.email);
      for (const field of SECRET_FIELDS) assert.equal(res.body[field], undefined, field);
    }
  });
});

describe('invite code regeneration', () => {
  test('room: owner gets a new code, the old one is rejected, non-owner 403', async () => {
    const owner = await createUser('owner');
    const stranger = await createUser('stranger');
    const room = await createRoom(owner, { name: 'Privée', visibility: 'PRIVATE' });
    assert.match(room.inviteCode, CODE_RE);

    const denied = await api('POST', `/api/rooms/${room.id}/invite-code`, { token: stranger.token });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'NOT_ROOM_OWNER');

    const res = await api('POST', `/api/rooms/${room.id}/invite-code`, { token: owner.token });
    assert.equal(res.status, 200);
    assert.match(res.body.inviteCode, CODE_RE);
    assert.notEqual(res.body.inviteCode, room.inviteCode);

    const old = await api('POST', '/api/rooms/join', { token: stranger.token, body: { inviteCode: room.inviteCode } });
    assert.equal(old.status, 404);
    assert.equal(old.body.code, 'INVALID_INVITE_CODE');

    const fresh = await api('POST', '/api/rooms/join', {
      token: stranger.token,
      body: { inviteCode: ` ${res.body.inviteCode.toLowerCase()} ` },
    });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.inviteCode, undefined);

    const publicRoom = await createRoom(owner, { name: 'Publique' });
    const conflict = await api('POST', `/api/rooms/${publicRoom.id}/invite-code`, { token: owner.token });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'ROOM_NOT_PRIVATE');

    const missing = await api('POST', '/api/rooms/unknown-room/invite-code', { token: owner.token });
    assert.equal(missing.status, 404);
  });

  test('playlist: owner gets a new code, the old one is rejected, non-owner 403', async () => {
    const owner = await createUser('owner');
    const stranger = await createUser('stranger');
    const playlist = await createPlaylist(owner);
    assert.match(playlist.inviteCode, CODE_RE);

    const denied = await api('POST', `/api/playlists/${playlist.id}/invite-code`, { token: stranger.token });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'NOT_PLAYLIST_OWNER');

    const res = await api('POST', `/api/playlists/${playlist.id}/invite-code`, { token: owner.token });
    assert.equal(res.status, 200);
    assert.match(res.body.inviteCode, CODE_RE);
    assert.notEqual(res.body.inviteCode, playlist.inviteCode);

    const old = await api('POST', '/api/playlists/join', {
      token: stranger.token,
      body: { inviteCode: playlist.inviteCode },
    });
    assert.equal(old.status, 404);
    assert.equal(old.body.code, 'INVALID_INVITE_CODE');

    const fresh = await api('POST', '/api/playlists/join', {
      token: stranger.token,
      body: { inviteCode: res.body.inviteCode },
    });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.playlist.inviteCode, null);

    const missing = await api('POST', '/api/playlists/unknown/invite-code', { token: owner.token });
    assert.equal(missing.status, 404);
  });
});

describe('action logs', () => {
  test('an authenticated REST request is logged with platform, device, appVersion and user', async () => {
    const user = await createUser('logged');
    const res = await fetch(`${baseUrl}/api/rooms/mine`, {
      headers: {
        Authorization: `Bearer ${user.token}`,
        'X-Platform': 'android',
        'X-Device': 'Pixel 8',
        'X-App-Version': '2.3.4',
      },
    });
    assert.equal(res.status, 200);

    const row = await waitForLog({ userId: user.id, endpoint: '/api/rooms/mine' });
    assert.ok(row, 'SystemLog row written');
    assert.equal(row.method, 'GET');
    assert.equal(row.platform, 'android');
    assert.equal(row.device, 'Pixel 8');
    assert.equal(row.appVersion, '2.3.4');
    assert.equal(row.statusCode, 200);
  });

  test('control characters in client info cannot forge log lines (REST)', async () => {
    const { EventEmitter } = await import('node:events');
    const req = {
      headers: {
        'x-platform': 'android\n[LOG] forged | User: admin',
        'x-device': 'Pixel\r\n\u001b[31mred',
        'x-app-version': '1.0\u2028x',
      },
      method: 'GET',
      originalUrl: '/api/forged-log-test',
      socket: {},
    };
    const res = new EventEmitter();
    res.statusCode = 200;

    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      requestLogger(req, res, () => {});
      res.emit('finish');
    } finally {
      console.log = original;
    }

    assert.equal(lines.length, 1);
    assert.equal(lines[0].split('\n').length, 1);
    assert.doesNotMatch(lines[0], /[\u0000-\u001f\u2028]/);
    assert.match(lines[0], /Platform: android \[LOG\] forged/);

    const row = await waitForLog({ endpoint: '/api/forged-log-test' });
    assert.ok(row);
    for (const field of ['platform', 'device', 'appVersion']) {
      assert.doesNotMatch(row[field], /[\u0000-\u001f\u2028]/, field);
    }
    assert.equal(sanitizeLogValue('a\nb', 100), 'a b');
  });

  test('control characters in socket auth info are stripped before logging', async () => {
    const user = await createUser('socketlf');
    const room = await createRoom(user, { name: 'LF' });
    const socket = await connectSocket(user, {
      auth: { token: user.token, platform: 'ios\nforged', device: 'dev\r\nice', appVersion: '1\n2' },
    });
    await emitAck(socket, 'room:join', { roomId: room.id });
    const row = await waitForLog({ userId: user.id, method: 'WS', action: { startsWith: 'WS room:join' } });
    assert.ok(row);
    assert.equal(row.platform, 'ios forged');
    assert.equal(row.device, 'dev  ice');
    assert.equal(row.appVersion, '1 2');
    socket.disconnect();
  });

  test('a socket event is logged with platform, device, appVersion and user', async () => {
    const user = await createUser('socket');
    const room = await createRoom(user, { name: 'Logs' });
    const socket = await connectSocket(user, {
      auth: { token: user.token, platform: 'ios', device: 'iPhone 15', appVersion: '9.9.9' },
    });
    const ack = await emitAck(socket, 'room:join', { roomId: room.id });
    assert.equal(ack.ok, true);

    const row = await waitForLog({ userId: user.id, method: 'WS', action: { startsWith: 'WS room:join' } });
    assert.ok(row, 'SystemLog row written');
    assert.equal(row.platform, 'ios');
    assert.equal(row.device, 'iPhone 15');
    assert.equal(row.appVersion, '9.9.9');
    socket.disconnect();
  });
});
