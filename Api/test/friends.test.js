import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  stopServer,
  resetDb,
  api,
  createUser,
  befriend,
  prisma,
  tokenFor,
} from './helpers.js';

let alice;
let bob;
let carol;

before(async () => {
  await resetDb();
  await startServer();
  alice = await createUser('alice');
  bob = await createUser('bob');
  carol = await createUser('carol');
});

after(stopServer);

describe('friend requests', () => {
  test('request is pending, accepting makes both friends', async () => {
    const req = await api('POST', '/api/friends/requests', {
      token: alice.token,
      body: { userId: bob.id },
    });
    assert.equal(req.status, 201);
    assert.equal(req.body.status, 'PENDING');
    assert.deepEqual(req.body.user, { id: bob.id, name: bob.name });

    const bobRequests = await api('GET', '/api/friends/requests', { token: bob.token });
    assert.equal(bobRequests.body.incoming.length, 1);
    assert.equal(bobRequests.body.incoming[0].user.id, alice.id);
    const aliceRequests = await api('GET', '/api/friends/requests', { token: alice.token });
    assert.equal(aliceRequests.body.outgoing.length, 1);

    // Not friends yet.
    assert.deepEqual((await api('GET', '/api/friends', { token: alice.token })).body, []);

    // The requester cannot accept their own request.
    const self = await api('POST', `/api/friends/requests/${req.body.id}/accept`, {
      token: alice.token,
    });
    assert.equal(self.status, 403);
    assert.equal(self.body.code, 'NOT_REQUEST_ADDRESSEE');

    // A stranger cannot see it.
    const stranger = await api('POST', `/api/friends/requests/${req.body.id}/accept`, {
      token: carol.token,
    });
    assert.equal(stranger.status, 404);

    const accepted = await api('POST', `/api/friends/requests/${req.body.id}/accept`, {
      token: bob.token,
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.status, 'ACCEPTED');

    const aliceFriends = await api('GET', '/api/friends', { token: alice.token });
    assert.deepEqual(aliceFriends.body, [{ id: bob.id, name: bob.name }]);
    const bobFriends = await api('GET', '/api/friends', { token: bob.token });
    assert.deepEqual(bobFriends.body, [{ id: alice.id, name: alice.name }]);

    const again = await api('POST', `/api/friends/requests/${req.body.id}/accept`, {
      token: bob.token,
    });
    assert.equal(again.status, 409);
  });

  test('self request is 400 CANNOT_FRIEND_SELF', async () => {
    const res = await api('POST', '/api/friends/requests', {
      token: alice.token,
      body: { userId: alice.id },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'CANNOT_FRIEND_SELF');
    assert.ok(res.body.error);
  });

  test('duplicate request (same direction, or already friends) is 409', async () => {
    const first = await api('POST', '/api/friends/requests', {
      token: alice.token,
      body: { userId: carol.id },
    });
    assert.equal(first.status, 201);

    const same = await api('POST', '/api/friends/requests', {
      token: alice.token,
      body: { userId: carol.id },
    });
    assert.equal(same.status, 409);
    assert.equal(same.body.code, 'FRIENDSHIP_EXISTS');

    // alice and bob are already friends.
    const friends = await api('POST', '/api/friends/requests', {
      token: bob.token,
      body: { userId: alice.id },
    });
    assert.equal(friends.status, 409);

    // Cancel so other tests start clean.
    const cancel = await api('DELETE', `/api/friends/requests/${first.body.id}`, {
      token: alice.token,
    });
    assert.equal(cancel.status, 204);
  });

  test('requesting a user who already asked you accepts their request (200)', async () => {
    const erin = await createUser('erin');
    const frank = await createUser('frank');
    const first = await api('POST', '/api/friends/requests', {
      token: erin.token,
      body: { userId: frank.id },
    });
    assert.equal(first.status, 201);

    const back = await api('POST', '/api/friends/requests', {
      token: frank.token,
      body: { userId: erin.id },
    });
    assert.equal(back.status, 200);
    assert.equal(back.body.id, first.body.id);
    assert.equal(back.body.status, 'ACCEPTED');
    assert.deepEqual(back.body.user, { id: erin.id, name: erin.name });
    assert.deepEqual((await api('GET', '/api/friends', { token: erin.token })).body, [
      { id: frank.id, name: frank.name },
    ]);
    assert.equal((await api('GET', '/api/friends/requests', { token: frank.token })).body.incoming.length, 0);
  });

  test('unknown user is 404, missing userId is 400', async () => {
    const unknown = await api('POST', '/api/friends/requests', {
      token: alice.token,
      body: { userId: 'does-not-exist' },
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'USER_NOT_FOUND');

    const missing = await api('POST', '/api/friends/requests', { token: alice.token, body: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, 'VALIDATION_ERROR');
  });

  test('addressee can decline a pending request', async () => {
    const req = await api('POST', '/api/friends/requests', {
      token: carol.token,
      body: { userId: bob.id },
    });
    assert.equal(req.status, 201);
    const decline = await api('DELETE', `/api/friends/requests/${req.body.id}`, {
      token: bob.token,
    });
    assert.equal(decline.status, 204);
    assert.equal((await api('GET', '/api/friends/requests', { token: bob.token })).body.incoming.length, 0);
    const gone = await api('DELETE', `/api/friends/requests/${req.body.id}`, { token: bob.token });
    assert.equal(gone.status, 404);
  });

  test('unfriend removes the friendship for both, unknown friend is 404', async () => {
    const dave = await createUser('dave');
    await befriend(carol, dave);

    const res = await api('DELETE', `/api/friends/${carol.id}`, { token: dave.token });
    assert.equal(res.status, 204);
    assert.deepEqual((await api('GET', '/api/friends', { token: carol.token })).body, []);

    const again = await api('DELETE', `/api/friends/${carol.id}`, { token: dave.token });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'NOT_FRIENDS');

    // They can become friends again later.
    await befriend(dave, carol);
  });

  test('friend routes require a JWT', async () => {
    const res = await api('GET', '/api/friends');
    assert.equal(res.status, 401);
  });
});

describe('user search', () => {
  test('returns up to 20 {id, name}, case-insensitive, excluding self', async () => {
    const tag = `zq${Date.now().toString(36)}`;
    const me = await prisma.user.create({
      data: { email: `${tag}-me@test.local`, name: `${tag} me`, privateInfo: 'secret' },
    });
    await prisma.user.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        email: `${tag}-${i}@test.local`,
        name: `${tag.toUpperCase()} user ${i}`,
        privateInfo: 'secret',
      })),
    });
    const token = tokenFor(me);

    const res = await api('GET', `/api/users/search?q=${tag}`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 20);
    for (const user of res.body) {
      assert.deepEqual(Object.keys(user).sort(), ['id', 'name']);
      assert.notEqual(user.id, me.id);
    }
  });

  test('matches a partial name', async () => {
    const res = await api('GET', `/api/users/search?q=${encodeURIComponent(bob.name.slice(0, 6))}`, {
      token: alice.token,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.some((u) => u.id === bob.id));
    assert.ok(!res.body.some((u) => u.id === alice.id));
  });

  test('LIKE wildcards in q are matched literally', async () => {
    const wildcards = await api('GET', '/api/users/search?q=__', { token: alice.token });
    assert.equal(wildcards.status, 200);
    assert.deepEqual(wildcards.body, []);
    const percent = await api('GET', `/api/users/search?q=${encodeURIComponent('%%')}`, {
      token: alice.token,
    });
    assert.deepEqual(percent.body, []);

    const odd = await prisma.user.create({
      data: { email: `odd-${Date.now()}@test.local`, name: 'odd_name%\\x' },
    });
    const literal = await api('GET', `/api/users/search?q=${encodeURIComponent('_name%\\')}`, {
      token: alice.token,
    });
    assert.deepEqual(literal.body, [{ id: odd.id, name: odd.name }]);
  });

  test('q shorter than 2 characters is 400', async () => {
    const short = await api('GET', '/api/users/search?q=a', { token: alice.token });
    assert.equal(short.status, 400);
    assert.equal(short.body.code, 'VALIDATION_ERROR');
    const missing = await api('GET', '/api/users/search', { token: alice.token });
    assert.equal(missing.status, 400);
  });

  test('search requires a JWT', async () => {
    const res = await api('GET', '/api/users/search?q=al');
    assert.equal(res.status, 401);
  });
});
