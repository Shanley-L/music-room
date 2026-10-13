import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  stopServer,
  resetDb,
  api,
  createUser,
  createRoom,
  suggestTrack,
  prisma,
} from './helpers.js';

// Paris, Place de la Concorde
const CENTER = { latitude: 48.8656, longitude: 2.3212 };
// ~300 m away
const NEAR = { latitude: 48.8683, longitude: 2.3212 };
// Eiffel Tower, ~2 km away
const FAR = { latitude: 48.8584, longitude: 2.2945 };

const hour = 3600e3;

let owner;
let invitee;
let stranger;

function vote(user, roomId, trackId, body) {
  return api('POST', `/api/rooms/${roomId}/tracks/${trackId}/vote`, { token: user.token, body });
}

function assertQueueConsistent(queue) {
  queue.forEach((t, i) => assert.equal(t.position, i + 1, 'positions are contiguous from 1'));
  for (let i = 1; i < queue.length; i++) {
    const prev = queue[i - 1];
    const cur = queue[i];
    assert.ok(
      prev.voteCount > cur.voteCount ||
        (prev.voteCount === cur.voteCount && new Date(prev.createdAt) <= new Date(cur.createdAt)),
      'ordered by votes desc then createdAt asc'
    );
  }
}

before(async () => {
  await resetDb();
  await startServer();
  owner = await createUser('owner');
  invitee = await createUser('invitee');
  stranger = await createUser('stranger');
});

after(stopServer);

describe('basic voting', () => {
  test('vote, duplicate vote, unvote', async () => {
    const room = await createRoom(owner, { name: 'Basique' });
    const t1 = await suggestTrack(owner, room.id);
    const t2 = await suggestTrack(stranger, room.id);
    assert.equal(t1.position, 1);
    assert.equal(t2.position, 2);

    const v = await vote(stranger, room.id, t2.id);
    assert.equal(v.status, 200);
    assert.equal(v.body.track.voteCount, 1);
    assert.equal(v.body.queue[0].id, t2.id);
    assertQueueConsistent(v.body.queue);

    const dup = await vote(stranger, room.id, t2.id);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'ALREADY_VOTED');

    const un = await api('DELETE', `/api/rooms/${room.id}/tracks/${t2.id}/vote`, {
      token: stranger.token,
    });
    assert.equal(un.status, 200);
    assert.deepEqual(un.body.queue.map((t) => t.id), [t1.id, t2.id]);
    assertQueueConsistent(un.body.queue);

    const unAgain = await api('DELETE', `/api/rooms/${room.id}/tracks/${t2.id}/vote`, {
      token: stranger.token,
    });
    assert.equal(unAgain.status, 404);
    assert.equal(unAgain.body.code, 'VOTE_NOT_FOUND');
  });

  test('hasVoted is computed per caller on GET tracks and vote/unvote responses', async () => {
    const room = await createRoom(owner, { name: 'A voté' });
    const t1 = await suggestTrack(owner, room.id);
    const t2 = await suggestTrack(owner, room.id);

    const byId = (queue) => Object.fromEntries(queue.map((t) => [t.id, t.hasVoted]));

    const v = await vote(stranger, room.id, t2.id);
    assert.equal(v.status, 200);
    assert.equal(v.body.track.hasVoted, true);
    assert.deepEqual(byId(v.body.queue), { [t1.id]: false, [t2.id]: true });

    const mine = await api('GET', `/api/rooms/${room.id}/tracks`, { token: stranger.token });
    assert.deepEqual(byId(mine.body), { [t1.id]: false, [t2.id]: true });
    const theirs = await api('GET', `/api/rooms/${room.id}/tracks`, { token: owner.token });
    assert.deepEqual(byId(theirs.body), { [t1.id]: false, [t2.id]: false });

    const un = await api('DELETE', `/api/rooms/${room.id}/tracks/${t2.id}/vote`, {
      token: stranger.token,
    });
    assert.equal(un.status, 200);
    assert.deepEqual(byId(un.body.queue), { [t1.id]: false, [t2.id]: false });
  });

  test('unknown track returns 404', async () => {
    const room = await createRoom(owner, { name: 'Inconnu' });
    const res = await vote(owner, room.id, 'nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'TRACK_NOT_FOUND');
  });

  test('suggesting the same track twice is a conflict', async () => {
    const room = await createRoom(owner, { name: 'Doublon' });
    await suggestTrack(owner, room.id, { externalId: 'same' });
    const res = await api('POST', `/api/rooms/${room.id}/tracks`, {
      token: owner.token,
      body: { externalId: 'same', title: 't', artist: 'a' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'TRACK_ALREADY_IN_QUEUE');
  });

  test('suggest validates input', async () => {
    const room = await createRoom(owner, { name: 'Validation' });
    const bodies = [
      { title: 't', artist: 'a' },
      { externalId: null, title: 't', artist: 'a' },
      { externalId: '', title: 't', artist: 'a' },
      { externalId: '   ', title: 't', artist: 'a' },
      { externalId: true, title: 't', artist: 'a' },
      { externalId: 'x', title: 't', artist: 'a', duration: 2147483648 },
    ];
    for (const body of bodies) {
      const res = await api('POST', `/api/rooms/${room.id}/tracks`, { token: owner.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    }
    assert.equal(await prisma.track.count({ where: { roomId: room.id } }), 0);

    const numeric = await api('POST', `/api/rooms/${room.id}/tracks`, {
      token: owner.token,
      body: { externalId: 3135556, title: 't', artist: 'a' },
    });
    assert.equal(numeric.status, 201);
    assert.equal(numeric.body.externalId, '3135556');
  });

  test('vote position validation', async () => {
    const room = await createRoom(owner, { name: 'Position' });
    const t = await suggestTrack(owner, room.id);
    for (const body of [{ latitude: 48.8 }, { latitude: 200, longitude: 2.3 }]) {
      const res = await vote(stranger, room.id, t.id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    }
  });

  test('private room: stranger cannot vote, invitee can', async () => {
    const room = await createRoom(owner, { name: 'Privée', visibility: 'PRIVATE' });
    await api('POST', `/api/rooms/${room.id}/invites`, {
      token: owner.token,
      body: { userId: invitee.id },
    });
    const t = await suggestTrack(invitee, room.id);

    const denied = await vote(stranger, room.id, t.id);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'ROOM_FORBIDDEN');

    assert.equal((await vote(invitee, room.id, t.id)).status, 200);
  });
});

describe('licenses', () => {
  test('INVITED_ONLY on a public room: only owner and invitees vote, anyone suggests', async () => {
    const room = await createRoom(owner, { name: 'Invités', license: 'INVITED_ONLY' });
    await api('POST', `/api/rooms/${room.id}/invites`, {
      token: owner.token,
      body: { userId: invitee.id },
    });
    const t = await suggestTrack(stranger, room.id);

    const denied = await vote(stranger, room.id, t.id);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'NOT_INVITED');
    assert.ok(denied.body.error);

    assert.equal((await vote(invitee, room.id, t.id)).status, 200);
    assert.equal((await vote(owner, room.id, t.id)).status, 200);
  });

  test('GEO zone + window: in zone votes, out of zone and missing position are refused', async () => {
    const room = await createRoom(owner, {
      name: 'Concorde',
      license: 'GEO_TIME_RESTRICTED',
      ...CENTER,
      radiusM: 1000,
      voteStartAt: new Date(Date.now() - hour).toISOString(),
      voteEndAt: new Date(Date.now() + hour).toISOString(),
    });
    const t = await suggestTrack(stranger, room.id);

    const noPos = await vote(stranger, room.id, t.id);
    assert.equal(noPos.status, 400);
    assert.equal(noPos.body.code, 'LOCATION_REQUIRED');

    const far = await vote(stranger, room.id, t.id, FAR);
    assert.equal(far.status, 403);
    assert.equal(far.body.code, 'OUT_OF_ZONE');

    const near = await vote(stranger, room.id, t.id, NEAR);
    assert.equal(near.status, 200);
    assert.equal(near.body.track.voteCount, 1);
  });

  test('GEO outside the time window is refused', async () => {
    const room = await createRoom(owner, {
      name: 'Plus tard',
      license: 'GEO_TIME_RESTRICTED',
      ...CENTER,
      radiusM: 1000,
      voteStartAt: new Date(Date.now() + hour).toISOString(),
      voteEndAt: new Date(Date.now() + 2 * hour).toISOString(),
    });
    const t = await suggestTrack(stranger, room.id);

    const res = await vote(stranger, room.id, t.id, NEAR);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'OUT_OF_TIME_WINDOW');

    const ended = await createRoom(owner, {
      name: 'Terminé',
      license: 'GEO_TIME_RESTRICTED',
      voteEndAt: new Date(Date.now() - hour).toISOString(),
    });
    const t2 = await suggestTrack(stranger, ended.id);
    const res2 = await vote(stranger, ended.id, t2.id);
    assert.equal(res2.status, 403);
    assert.equal(res2.body.code, 'OUT_OF_TIME_WINDOW');
  });

  test('GEO with only a window does not require a position', async () => {
    const room = await createRoom(owner, {
      name: 'Fenêtre seule',
      license: 'GEO_TIME_RESTRICTED',
      voteStartAt: new Date(Date.now() - hour).toISOString(),
      voteEndAt: new Date(Date.now() + hour).toISOString(),
    });
    const t = await suggestTrack(stranger, room.id);
    assert.equal((await vote(stranger, room.id, t.id)).status, 200);
  });

  test('GEO with only a zone ignores time', async () => {
    const room = await createRoom(owner, {
      name: 'Zone seule',
      license: 'GEO_TIME_RESTRICTED',
      ...CENTER,
      radiusM: 500,
    });
    const t = await suggestTrack(stranger, room.id);
    assert.equal((await vote(stranger, room.id, t.id, NEAR)).status, 200);
    assert.equal((await vote(owner, room.id, t.id, FAR)).status, 403);
  });
});

describe('concurrency', () => {
  test('50 simultaneous votes on the same track all succeed', async () => {
    const room = await createRoom(owner, { name: 'Rush' });
    const tracks = [];
    for (let i = 0; i < 5; i++) tracks.push(await suggestTrack(owner, room.id));
    const target = tracks[4];

    const voters = await Promise.all(Array.from({ length: 50 }, (_, i) => createUser(`v${i}`)));
    const results = await Promise.all(voters.map((u) => vote(u, room.id, target.id)));

    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));

    const dbTrack = await prisma.track.findUnique({ where: { id: target.id } });
    assert.equal(dbTrack.voteCount, 50);
    assert.equal(await prisma.vote.count({ where: { trackId: target.id } }), 50);

    const queue = (await api('GET', `/api/rooms/${room.id}/tracks`, { token: owner.token })).body;
    assert.equal(queue.length, 5);
    assert.equal(queue[0].id, target.id);
    assertQueueConsistent(queue);
    assert.deepEqual(queue.slice(1).map((t) => t.id), tracks.slice(0, 4).map((t) => t.id));
  });

  test('50 simultaneous votes spread over different tracks', async () => {
    const room = await createRoom(owner, { name: 'Rush multiple' });
    const tracks = [];
    for (let i = 0; i < 5; i++) tracks.push(await suggestTrack(owner, room.id));

    // Votes per track (oldest first): 2, 4, 6, 8, 30 => 50 votes, queue must end up reversed.
    const weights = [2, 4, 6, 8, 30];
    const voters = await Promise.all(Array.from({ length: 30 }, (_, i) => createUser(`m${i}`)));
    const jobs = [];
    weights.forEach((w, ti) => {
      for (let k = 0; k < w; k++) jobs.push(() => vote(voters[k], room.id, tracks[ti].id));
    });
    assert.equal(jobs.length, 50);

    const results = await Promise.all(jobs.map((j) => j()));
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));

    const queue = (await api('GET', `/api/rooms/${room.id}/tracks`, { token: owner.token })).body;
    assertQueueConsistent(queue);
    assert.deepEqual(queue.map((t) => t.voteCount), [30, 8, 6, 4, 2]);
    assert.deepEqual(queue.map((t) => t.id), [...tracks].reverse().map((t) => t.id));
  });

  test('the same user voting concurrently gets one 200 and the rest 409', async () => {
    const room = await createRoom(owner, { name: 'Doublons simultanés' });
    const t = await suggestTrack(owner, room.id);

    const results = await Promise.all(Array.from({ length: 10 }, () => vote(stranger, room.id, t.id)));
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 200).length, 1);
    assert.equal(statuses.filter((s) => s === 409).length, 9);
    for (const r of results.filter((x) => x.status === 409)) {
      assert.equal(r.body.code, 'ALREADY_VOTED');
    }

    const dbTrack = await prisma.track.findUnique({ where: { id: t.id } });
    assert.equal(dbTrack.voteCount, 1);
  });

  test('concurrent suggests of the same track: one 201, the rest 409', async () => {
    const room = await createRoom(owner, { name: 'Suggestions doublons' });
    const body = { externalId: 'dup-ext', title: 't', artist: 'a' };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api('POST', `/api/rooms/${room.id}/tracks`, { token: stranger.token, body })
      )
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(conflicts.length, 9);
    for (const r of conflicts) assert.equal(r.body.code, 'TRACK_ALREADY_IN_QUEUE');
    assert.equal(await prisma.track.count({ where: { roomId: room.id } }), 1);
  });

  test('concurrent suggests of distinct tracks keep positions unique and contiguous', async () => {
    const room = await createRoom(owner, { name: 'Suggestions simultanées' });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        api('POST', `/api/rooms/${room.id}/tracks`, {
          token: stranger.token,
          body: { externalId: `c-${i}`, title: `t${i}`, artist: 'a' },
        })
      )
    );
    for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));

    const queue = (await api('GET', `/api/rooms/${room.id}/tracks`, { token: owner.token })).body;
    assert.equal(queue.length, 20);
    assertQueueConsistent(queue);
  });

  test('concurrent votes and unvotes keep counts and positions consistent', async () => {
    const room = await createRoom(owner, { name: 'Mix' });
    const a = await suggestTrack(owner, room.id);
    const b = await suggestTrack(owner, room.id);
    const voters = await Promise.all(Array.from({ length: 20 }, (_, i) => createUser(`x${i}`)));

    // Everyone votes for A first
    await Promise.all(voters.map((u) => vote(u, room.id, a.id)));

    // Then concurrently: half remove their vote on A, everyone votes B
    await Promise.all([
      ...voters.slice(0, 10).map((u) =>
        api('DELETE', `/api/rooms/${room.id}/tracks/${a.id}/vote`, { token: u.token })
      ),
      ...voters.map((u) => vote(u, room.id, b.id)),
    ]);

    const queue = (await api('GET', `/api/rooms/${room.id}/tracks`, { token: owner.token })).body;
    assertQueueConsistent(queue);
    assert.deepEqual(queue.map((t) => [t.id, t.voteCount]), [[b.id, 20], [a.id, 10]]);
  });
});
