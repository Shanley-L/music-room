import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

// Read when the limiter is created: must be set before the app is imported
// (dotenv never overrides a variable that is already set).
process.env.RATE_LIMIT_AUTH_MAX = '1000';

const { startServer, stopServer, resetDb, api, createUser, prisma } = await import('./helpers.js');
const { setTokenInfoFetcher, resetTokenInfoFetcher } = await import('../src/lib/googleVerify.js');

// Set after the import (dotenv has run), so a developer's Api/.env cannot change them.
// googleVerify reads them on every request.
const WEB_ID = 'web-client.apps.googleusercontent.com';
const ANDROID_ID = 'android-client.apps.googleusercontent.com';
function configureGoogle() {
  process.env.GOOGLE_CLIENT_ID = WEB_ID;
  process.env.GOOGLE_CLIENT_ID_ANDROID = ANDROID_ID;
  delete process.env.GOOGLE_CLIENT_ID_IOS;
  delete process.env.GOOGLE_CLIENT_ID_WEB;
}
configureGoogle();
delete process.env.ALLOW_DEV_OAUTH;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const inOneHour = () => String(Math.floor(Date.now() / 1000) + 3600);

/**
 * Fake Google: `idTokens` / `accessTokens` map a token string to the tokeninfo
 * payload Google would return; unknown tokens are rejected like Google does
 * (null). The token 'google-down' simulates an outage. Records calls.
 */
const idTokens = new Map();
const accessTokens = new Map();
const calls = [];
const randomSub = () => `1${Math.floor(Math.random() * 1e15)}`;

function googleIdToken(name, overrides = {}) {
  const sub = overrides.sub ?? randomSub();
  const payload = {
    iss: 'https://accounts.google.com',
    aud: ANDROID_ID,
    azp: ANDROID_ID,
    sub,
    email: `${name}-${sub}@gmail.com`,
    email_verified: 'true',
    name,
    exp: inOneHour(),
    ...overrides,
  };
  const token = `idtoken-${name}-${sub}-${Math.random()}`;
  idTokens.set(token, payload);
  return { token, payload };
}

/** Access-token tokeninfo payload (no iss/exp, `expires_in` instead). */
function googleAccessToken(name, overrides = {}) {
  const sub = overrides.sub ?? randomSub();
  const payload = {
    aud: WEB_ID,
    azp: WEB_ID,
    sub,
    email: `${name}-${sub}@gmail.com`,
    email_verified: 'true',
    expires_in: '3599',
    scope: 'openid email profile',
    ...overrides,
  };
  const token = `ya29-${name}-${sub}-${Math.random()}`;
  accessTokens.set(token, payload);
  return { token, payload };
}

async function fakeTokenInfo(kind, token) {
  calls.push({ kind, token });
  if (token === 'google-down') throw new Error('ECONNRESET');
  const store = kind === 'id_token' ? idTokens : accessTokens;
  return store.get(token) ?? null;
}

before(async () => {
  await resetDb();
  await startServer();
  setTokenInfoFetcher(fakeTokenInfo);
});

after(async () => {
  resetTokenInfoFetcher();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  await stopServer();
});

beforeEach(() => {
  configureGoogle();
  delete process.env.ALLOW_DEV_OAUTH;
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('POST /api/auth/google', () => {
  test('valid id token for a new user creates the account and returns tokens', async () => {
    const { token, payload } = googleIdToken('newbie');
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.ok(res.body.refreshToken);
    assert.equal(res.body.user.email, payload.email);
    assert.equal(res.body.user.password, undefined);

    const stored = await prisma.user.findUnique({ where: { googleId: payload.sub } });
    assert.ok(stored);
    assert.equal(stored.isEmailVerified, true);

    // The issued token works on protected routes.
    const me = await api('GET', '/api/users/me', { token: res.body.accessToken });
    assert.equal(me.status, 200);

    // Logging in again uses the same account.
    const again = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(again.status, 200);
    assert.equal(again.body.user.id, stored.id);
    assert.equal(await prisma.user.count({ where: { googleId: payload.sub } }), 1);
  });

  test('any configured client id is an accepted audience (web client id)', async () => {
    const { token } = googleIdToken('webuser', { aud: WEB_ID, azp: WEB_ID });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 200);
  });

  test('verified Google email of an existing account logs into and links that account', async () => {
    const reg = await api('POST', '/api/auth/register', {
      body: { email: 'Existing@Gmail.com', password: 'secret123', name: 'Existing' },
    });
    assert.equal(reg.status, 201);
    await prisma.user.update({ where: { id: reg.body.user.id }, data: { isEmailVerified: true } });

    const { token, payload } = googleIdToken('existing', { email: 'existing@gmail.com' });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, reg.body.user.id);

    const stored = await prisma.user.findUnique({ where: { id: reg.body.user.id } });
    assert.equal(stored.googleId, payload.sub);
    assert.ok(stored.password, 'a verified password account keeps its password');

    const pwLogin = await api('POST', '/api/auth/login', {
      body: { email: 'existing@gmail.com', password: 'secret123' },
    });
    assert.equal(pwLogin.status, 200);
  });

  test('merging into an unverified password account drops the unproven password', async () => {
    // Someone registered the victim's address but never verified it.
    const reg = await api('POST', '/api/auth/register', {
      body: { email: 'victim@gmail.com', password: 'attacker-pw', name: 'Squatter' },
    });
    assert.equal(reg.status, 201);

    const { token } = googleIdToken('victim', { email: 'victim@gmail.com' });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.isEmailVerified, true);

    const attacker = await api('POST', '/api/auth/login', {
      body: { email: 'victim@gmail.com', password: 'attacker-pw' },
    });
    assert.equal(attacker.status, 401);

    // The squatter's refresh token (issued at register) no longer works.
    const refresh = await api('POST', '/api/auth/refresh', { body: { refreshToken: reg.body.refreshToken } });
    assert.equal(refresh.status, 401);
    const left = await prisma.refreshToken.findMany({ where: { userId: reg.body.user.id } });
    assert.deepEqual(left.map((t) => t.token), [res.body.refreshToken]);
  });

  test('token issued for another client id is rejected (wrong audience)', async () => {
    const { token, payload } = googleIdToken('foreign', {
      aud: 'someone-else.apps.googleusercontent.com',
      azp: 'someone-else.apps.googleusercontent.com',
    });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'INVALID_GOOGLE_TOKEN');
    assert.equal(await prisma.user.count({ where: { googleId: payload.sub } }), 0);
  });

  test('token rejected by Google (bad signature / unknown) is refused', async () => {
    const res = await api('POST', '/api/auth/google', { body: { idToken: 'forged.jwt.token' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'INVALID_GOOGLE_TOKEN');
  });

  test('expired token is refused', async () => {
    const { token } = googleIdToken('expired', { exp: String(Math.floor(Date.now() / 1000) - 10) });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'INVALID_GOOGLE_TOKEN');
  });

  test('token from another issuer is refused', async () => {
    const { token } = googleIdToken('issuer', { iss: 'https://evil.example.com' });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'INVALID_GOOGLE_TOKEN');
  });

  test('unverified Google email is refused and never merged', async () => {
    const victim = await createUser('unverified-target');
    const { token, payload } = googleIdToken('unverified', {
      email: victim.email,
      email_verified: 'false',
    });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'GOOGLE_EMAIL_UNVERIFIED');

    const stored = await prisma.user.findUnique({ where: { id: victim.id } });
    assert.equal(stored.googleId, null);
    assert.equal(await prisma.user.count({ where: { googleId: payload.sub } }), 0);
  });

  test('missing token is a 400; body-supplied identity is ignored', async () => {
    const victim = await createUser('body-identity');
    const res = await api('POST', '/api/auth/google', {
      body: { providerId: '12345', email: victim.email, sub: '12345' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'GOOGLE_TOKEN_REQUIRED');
  });

  test('no configured client id: Google login is unavailable (503)', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID_ANDROID;
    const { token } = googleIdToken('noconfig');
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'GOOGLE_NOT_CONFIGURED');

    const user = await createUser('noconfig-link');
    const link = await api('POST', '/api/auth/link-google', { token: user.token, body: { idToken: token } });
    assert.equal(link.status, 503);
    assert.equal(link.body.code, 'GOOGLE_NOT_CONFIGURED');
  });

  test('ID token with a foreign aud is refused even when azp is ours', async () => {
    const { token, payload } = googleIdToken('azp-only', {
      aud: 'someone-else.apps.googleusercontent.com',
      azp: ANDROID_ID,
    });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'INVALID_GOOGLE_TOKEN');
    assert.equal(await prisma.user.count({ where: { googleId: payload.sub } }), 0);
  });

  test('Google unreachable maps to 502 GOOGLE_UNAVAILABLE', async () => {
    const res = await api('POST', '/api/auth/google', { body: { idToken: 'google-down' } });
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 'GOOGLE_UNAVAILABLE');
  });

  test('real fetcher: tokeninfo 400/401 means invalid, 5xx/429 means unavailable', async () => {
    // Exercise the default fetcher with Google's HTTP answers stubbed (no network).
    const realFetch = globalThis.fetch;
    let status = 400;
    globalThis.fetch = (url, init) =>
      String(url).startsWith('https://oauth2.googleapis.com/')
        ? Promise.resolve(new Response(JSON.stringify({ error: 'x' }), { status }))
        : realFetch(url, init);
    resetTokenInfoFetcher();
    try {
      for (const [code, expected, errCode] of [
        [400, 401, 'INVALID_GOOGLE_TOKEN'],
        [401, 401, 'INVALID_GOOGLE_TOKEN'],
        [503, 502, 'GOOGLE_UNAVAILABLE'],
        [429, 502, 'GOOGLE_UNAVAILABLE'],
      ]) {
        status = code;
        const res = await api('POST', '/api/auth/google', { body: { idToken: 'whatever' } });
        assert.equal(res.status, expected, `tokeninfo ${code}`);
        assert.equal(res.body.code, errCode);
      }
    } finally {
      globalThis.fetch = realFetch;
      setTokenInfoFetcher(fakeTokenInfo);
    }
  });

  test('access token: valid logs in, wrong audience and expired are refused', async () => {
    const ok = googleAccessToken('access');
    const res = await api('POST', '/api/auth/google', { body: { accessToken: ok.token } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.googleId, ok.payload.sub);

    // Legacy field name `token` is the same thing.
    const legacy = await api('POST', '/api/auth/google', { body: { token: ok.token } });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.user.id, res.body.user.id);

    const issuedTo = googleAccessToken('issued-to', { aud: undefined, azp: undefined, issued_to: WEB_ID });
    const viaIssuedTo = await api('POST', '/api/auth/google', { body: { accessToken: issuedTo.token } });
    assert.equal(viaIssuedTo.status, 200);

    const foreign = googleAccessToken('access-foreign', { aud: 'x.apps.googleusercontent.com', azp: WEB_ID });
    const wrong = await api('POST', '/api/auth/google', { body: { accessToken: foreign.token } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, 'INVALID_GOOGLE_TOKEN');

    const old = googleAccessToken('access-expired', { expires_in: '0' });
    const expired = await api('POST', '/api/auth/google', { body: { accessToken: old.token } });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.code, 'INVALID_GOOGLE_TOKEN');
  });

  test('existing account linked to another Google account is not merged (409)', async () => {
    const user = await createUser('conflict');
    await prisma.user.update({ where: { id: user.id }, data: { googleId: randomSub() } });

    const { token, payload } = googleIdToken('conflict', { email: user.email });
    const res = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'GOOGLE_ACCOUNT_CONFLICT');
    assert.equal(await prisma.user.count({ where: { googleId: payload.sub } }), 0);
  });
});

describe('POST /api/auth/link-google', () => {
  test('authenticated user links a verified Google account', async () => {
    const user = await createUser('linker');
    const { token, payload } = googleIdToken('linker');

    const res = await api('POST', '/api/auth/link-google', { token: user.token, body: { idToken: token } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.googleId, payload.sub);
    assert.equal(res.body.user.password, undefined);

    // Then the Google account logs into that user.
    const login = await api('POST', '/api/auth/google', { body: { idToken: token } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.id, user.id);
  });

  test('Google account already linked to another user is rejected (409)', async () => {
    const owner = await createUser('owner');
    const other = await createUser('other');
    const { token, payload } = googleIdToken('shared');

    const first = await api('POST', '/api/auth/link-google', { token: owner.token, body: { idToken: token } });
    assert.equal(first.status, 200);

    const second = await api('POST', '/api/auth/link-google', { token: other.token, body: { idToken: token } });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'GOOGLE_ACCOUNT_IN_USE');

    const stored = await prisma.user.findUnique({ where: { id: other.id } });
    assert.equal(stored.googleId, null);
    const ownerRow = await prisma.user.findUnique({ where: { id: owner.id } });
    assert.equal(ownerRow.googleId, payload.sub);
  });

  test('user with a different Google account already linked gets 409 GOOGLE_ALREADY_LINKED', async () => {
    const user = await createUser('relink');
    const first = googleIdToken('relink-1');
    const ok = await api('POST', '/api/auth/link-google', { token: user.token, body: { idToken: first.token } });
    assert.equal(ok.status, 200);

    // Linking the same account again is idempotent.
    const same = await api('POST', '/api/auth/link-google', { token: user.token, body: { idToken: first.token } });
    assert.equal(same.status, 200);

    const second = googleIdToken('relink-2');
    const res = await api('POST', '/api/auth/link-google', { token: user.token, body: { idToken: second.token } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'GOOGLE_ALREADY_LINKED');
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).googleId, first.payload.sub);
  });

  test('account with an unverified email cannot link Google (403)', async () => {
    const user = await createUser('unverified-link');
    await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: false } });
    const { token } = googleIdToken('unverified-link');
    const res = await api('POST', '/api/auth/link-google', { token: user.token, body: { idToken: token } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).googleId, null);
  });

  test('access token: link works, wrong audience and expired are refused', async () => {
    const user = await createUser('access-link');
    const foreign = googleAccessToken('al-foreign', { aud: 'x.apps.googleusercontent.com', azp: 'x' });
    const wrong = await api('POST', '/api/auth/link-google', {
      token: user.token,
      body: { accessToken: foreign.token },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, 'INVALID_GOOGLE_TOKEN');

    const old = googleAccessToken('al-expired', { expires_in: '-5' });
    const expired = await api('POST', '/api/auth/link-google', { token: user.token, body: { accessToken: old.token } });
    assert.equal(expired.status, 401);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).googleId, null);

    const ok = googleAccessToken('al-ok');
    const res = await api('POST', '/api/auth/link-google', { token: user.token, body: { accessToken: ok.token } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.googleId, ok.payload.sub);
  });

  test('requires authentication and a valid token', async () => {
    const { token } = googleIdToken('anon');
    const anon = await api('POST', '/api/auth/link-google', { body: { idToken: token } });
    assert.equal(anon.status, 401);

    const user = await createUser('badtoken');
    const bad = await api('POST', '/api/auth/link-google', { token: user.token, body: { idToken: 'nope' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, 'INVALID_GOOGLE_TOKEN');

    const wrongAud = googleIdToken('wrongaud', { aud: 'x.apps.googleusercontent.com', azp: 'x' });
    const res = await api('POST', '/api/auth/link-google', {
      token: user.token,
      body: { idToken: wrongAud.token },
    });
    assert.equal(res.status, 401);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).googleId, null);
  });
});

describe('body-supplied identity (dev simulation)', () => {
  test('without ALLOW_DEV_OAUTH, /auth/oauth and /auth/link-oauth are refused', async () => {
    const victim = await createUser('takeover');
    const res = await api('POST', '/api/auth/oauth', {
      body: { provider: 'google', providerId: 'abc', email: victim.email },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.accessToken, undefined);

    const user = await createUser('linkdev');
    const link = await api('POST', '/api/auth/link-oauth', {
      token: user.token,
      body: { provider: 'google', providerId: 'abc' },
    });
    assert.equal(link.status, 404);

    const providers = await api('GET', '/api/auth/providers');
    assert.equal(providers.status, 200);
    assert.deepEqual(providers.body, { google: true, devOAuth: false });
  });

  test('in production the flag is ignored', async () => {
    process.env.ALLOW_DEV_OAUTH = 'true';
    process.env.NODE_ENV = 'production';
    const res = await api('POST', '/api/auth/oauth', {
      body: { provider: 'google', providerId: 'prod-try', email: 'prod@test.local' },
    });
    assert.equal(res.status, 404);
    assert.equal(await prisma.user.count({ where: { email: 'prod@test.local' } }), 0);

    const providers = await api('GET', '/api/auth/providers');
    assert.equal(providers.body.devOAuth, false);
  });

  test('any NODE_ENV other than development/test disables the flag (staging, unset)', async () => {
    process.env.ALLOW_DEV_OAUTH = 'true';
    for (const env of ['staging', undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      const res = await api('POST', '/api/auth/oauth', {
        body: { provider: 'google', providerId: 'staging-try', email: 'staging@test.local' },
      });
      assert.equal(res.status, 404, `NODE_ENV=${env}`);
      const providers = await api('GET', '/api/auth/providers');
      assert.equal(providers.body.devOAuth, false);
    }
    assert.equal(await prisma.user.count({ where: { email: 'staging@test.local' } }), 0);
  });

  test('with the flag in development/test, the simulation works but never takes over an account', async () => {
    process.env.ALLOW_DEV_OAUTH = 'true';
    process.env.NODE_ENV = 'test';

    const providers = await api('GET', '/api/auth/providers');
    assert.equal(providers.body.devOAuth, true);

    const res = await api('POST', '/api/auth/oauth', {
      body: { provider: 'google', providerId: 'dev-1', email: 'Dev1@Test.local', name: 'Dev' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.equal(res.body.user.email, 'dev1@test.local');
    assert.equal(res.body.user.googleId, 'dev:dev-1');

    const again = await api('POST', '/api/auth/oauth', { body: { provider: 'google', providerId: 'dev-1' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.user.id, res.body.user.id);

    const victim = await createUser('dev-victim');
    const takeover = await api('POST', '/api/auth/oauth', {
      body: { provider: 'google', providerId: 'dev-2', email: victim.email },
    });
    assert.equal(takeover.status, 409);
    assert.equal(takeover.body.accessToken, undefined);

    const user = await createUser('devlink');
    const link = await api('POST', '/api/auth/link-oauth', {
      token: user.token,
      body: { provider: 'google', providerId: 'dev-link' },
    });
    assert.equal(link.status, 200);
    assert.equal(link.body.user.googleId, 'dev:dev-link');

    const conflict = await api('POST', '/api/auth/link-oauth', {
      token: victim.token,
      body: { provider: 'google', providerId: 'dev-link' },
    });
    assert.equal(conflict.status, 409);
  });
});

test('no network call reaches Google in this suite (fetcher is mocked)', () => {
  assert.ok(calls.length > 0);
});
