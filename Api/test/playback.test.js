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
  connectSocket,
  emitAck,
  waitForEvent,
  prisma,
} from './helpers.js';

let owner;
let member;
let invitee;

const pb = (user, roomId, action, body) =>
  api('POST', `/api/rooms/${roomId}/playback/${action}`, { token: user.token, body });
const getState = (user, roomId) => api('GET', `/api/rooms/${roomId}/playback`, { token: user.token });
const vote = (user, roomId, trackId) =>
  api('POST', `/api/rooms/${roomId}/tracks/${trackId}/vote`, { token: user.token, body: {} });
const queueOf = async (user, roomId) =>
  (await api('GET', `/api/rooms/${roomId}/tracks`, { token: user.token })).body;

/** Pretends the current track started `ms` ago. */
async function rewind(roomId, ms) {
  await prisma.room.update({
    where: { id: roomId },
    data: { playbackStartedAt: new Date(Date.now() - ms) },
  });
}

before(async () => {
  await resetDb();
  await startServer();
  owner = await createUser('owner');
  member = await createUser('member');
  invitee = await createUser('invitee');
});

after(stopServer);

describe('owner-only control', () => {
  test('non-owners get 403 NOT_ROOM_OWNER on every control, owner and others can read', async () => {
    const room = await createRoom(owner, { name: 'Contrôle' });
    await suggestTrack(owner, room.id);
    for (const action of ['play', 'pause', 'resume', 'skip']) {
      const res = await pb(member, room.id, action);
      assert.equal(res.status, 403, action);
      assert.equal(res.body.code, 'NOT_ROOM_OWNER');
    }
    const state = await getState(member, room.id);
    assert.equal(state.status, 200);
    // Live chain: the first suggestion starts the room by itself.
    assert.equal(state.body.status, 'PLAYING');
    assert.ok(state.body.serverTime);
  });

  test('private room: outsiders cannot read or report playback', async () => {
    const room = await createRoom(owner, { name: 'Privée', visibility: 'PRIVATE' });
    assert.equal((await getState(member, room.id)).status, 403);
    assert.equal((await pb(member, room.id, 'ended', { trackId: 'x' })).status, 403);
  });

  test('play with an empty queue is refused', async () => {
    const room = await createRoom(owner, { name: 'Vide' });
    const res = await pb(owner, room.id, 'play');
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NOTHING_TO_PLAY');
  });
});

describe('play, votes and queue', () => {
  test('first suggestion autostarts; votes only reorder queued tracks; skip promotes the top', async () => {
    const room = await createRoom(owner, { name: 'Votes' });
    const a = await suggestTrack(owner, room.id);
    const b = await suggestTrack(member, room.id);
    const c = await suggestTrack(member, room.id);

    const first = await getState(member, room.id);
    assert.equal(first.body.status, 'PLAYING');
    assert.equal(first.body.currentTrack.id, a.id);
    assert.equal(first.body.currentTrack.durationMs, 30000);
    assert.ok(first.body.startedAt);

    await vote(member, room.id, c.id);
    await vote(invitee, room.id, c.id);
    await vote(member, room.id, b.id);

    // Playing track is out of the queue and cannot be voted.
    let queue = await queueOf(member, room.id);
    assert.deepEqual(queue.map((t) => t.id), [c.id, b.id]);
    queue.forEach((t, i) => assert.equal(t.position, i + 1));
    const onPlaying = await vote(owner, room.id, a.id);
    assert.equal(onPlaying.status, 409);
    assert.equal(onPlaying.body.code, 'TRACK_NOT_QUEUED');

    // Votes during playback reorder the queued tracks only.
    await vote(owner, room.id, b.id);
    await vote(invitee, room.id, b.id);
    queue = await queueOf(member, room.id);
    assert.deepEqual(queue.map((t) => t.id), [b.id, c.id]);
    assert.equal((await getState(member, room.id)).body.currentTrack.id, a.id);

    // The playing track cannot be deleted, skip moves on.
    const del = await api('DELETE', `/api/rooms/${room.id}/tracks/${a.id}`, { token: owner.token });
    assert.equal(del.status, 409);
    const skipped = await pb(owner, room.id, 'skip');
    assert.equal(skipped.body.currentTrack.id, b.id);
    assert.deepEqual((await queueOf(member, room.id)).map((t) => t.id), [c.id]);
  });

  test('skip on an empty queue goes IDLE; a played track can be suggested again', async () => {
    const room = await createRoom(owner, { name: 'Fin' });
    const a = await suggestTrack(owner, room.id, { externalId: 'same-1' });
    await pb(owner, room.id, 'play');
    const skipped = await pb(owner, room.id, 'skip');
    assert.equal(skipped.status, 200);
    assert.equal(skipped.body.status, 'IDLE');
    assert.equal(skipped.body.currentTrack, null);
    assert.equal(skipped.body.positionMs, 0);
    // Idempotent when already idle.
    assert.equal((await pb(owner, room.id, 'skip')).body.status, 'IDLE');

    const again = await suggestTrack(member, room.id, { externalId: 'same-1' });
    assert.equal(again.id, a.id);
    assert.equal(again.status, 'QUEUED');
    assert.equal((await pb(owner, room.id, 'play')).body.currentTrack.id, a.id);
  });
});

describe('ended', () => {
  test('is a no-op before the tolerance, advances after, and is idempotent', async () => {
    const room = await createRoom(owner, { name: 'Ended' });
    const a = await suggestTrack(owner, room.id, { duration: 10 });
    const b = await suggestTrack(owner, room.id, { duration: 10 });
    await pb(owner, room.id, 'play');
    const first = (await getState(owner, room.id)).body.currentTrack.id;
    assert.equal(first, a.id);
    assert.equal(a.duration, 10);

    // Too early: 10 s track, only ~1 s elapsed.
    const early = await pb(member, room.id, 'ended', { trackId: a.id });
    assert.equal(early.status, 200);
    assert.equal(early.body.currentTrack.id, a.id);

    // Wrong track: no-op.
    const wrong = await pb(member, room.id, 'ended', { trackId: b.id });
    assert.equal(wrong.body.currentTrack.id, a.id);

    await rewind(room.id, 8500); // 10 s - 2 s tolerance = 8 s: accepted
    const done = await pb(member, room.id, 'ended', { trackId: a.id });
    assert.equal(done.body.currentTrack.id, b.id);

    // Same report again: stale track, nothing changes.
    const dup = await pb(invitee, room.id, 'ended', { trackId: a.id });
    assert.equal(dup.body.currentTrack.id, b.id);

    assert.equal((await pb(member, room.id, 'ended', {})).status, 400);

    await rewind(room.id, 11000);
    const last = await pb(member, room.id, 'ended', { trackId: b.id });
    assert.equal(last.body.status, 'IDLE');
  });

  test('ended is ignored while paused', async () => {
    const room = await createRoom(owner, { name: 'EndedPause' });
    const a = await suggestTrack(owner, room.id, { duration: 5 });
    await pb(owner, room.id, 'play');
    await rewind(room.id, 4000);
    await pb(owner, room.id, 'pause');
    const res = await pb(member, room.id, 'ended', { trackId: a.id });
    assert.equal(res.body.status, 'PAUSED');
    assert.equal(res.body.currentTrack.id, a.id);
  });

  test('20 concurrent ended reports advance the room exactly once', async () => {
    const room = await createRoom(owner, { name: 'Concurrent' });
    const a = await suggestTrack(owner, room.id, { duration: 3 });
    const b = await suggestTrack(owner, room.id, { duration: 30 });
    const c = await suggestTrack(owner, room.id, { duration: 30 });
    await pb(owner, room.id, 'play');
    await rewind(room.id, 5000);

    const clients = await Promise.all(Array.from({ length: 20 }, (_, i) => createUser(`c${i}`)));
    const results = await Promise.all(clients.map((u) => pb(u, room.id, 'ended', { trackId: a.id })));
    assert.ok(results.every((r) => r.status === 200));

    const state = (await getState(owner, room.id)).body;
    assert.equal(state.currentTrack.id, b.id, 'advanced exactly one track');
    assert.deepEqual((await queueOf(owner, room.id)).map((t) => t.id), [c.id]);
    const played = await prisma.track.count({ where: { roomId: room.id, status: 'PLAYED' } });
    assert.equal(played, 1);
  });
});

describe('pause and resume', () => {
  test('position is frozen while paused and continues after resume', async () => {
    const room = await createRoom(owner, { name: 'Pause' });
    await suggestTrack(owner, room.id);
    await pb(owner, room.id, 'play');
    await rewind(room.id, 5000);

    const paused = await pb(owner, room.id, 'pause');
    assert.equal(paused.body.status, 'PAUSED');
    assert.equal(paused.body.startedAt, null);
    assert.ok(paused.body.positionMs >= 5000 && paused.body.positionMs < 6000);
    const frozen = paused.body.positionMs;

    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await getState(member, room.id)).body.positionMs, frozen);
    // pause again: idempotent
    assert.equal((await pb(owner, room.id, 'pause')).body.positionMs, frozen);

    const resumed = await pb(owner, room.id, 'resume');
    assert.equal(resumed.body.status, 'PLAYING');
    const startedAt = new Date(resumed.body.startedAt).getTime();
    const serverTime = new Date(resumed.body.serverTime).getTime();
    assert.ok(Math.abs(serverTime - startedAt - frozen) < 500, 'startedAt = now - pausedPosition');
    assert.ok(resumed.body.positionMs >= frozen);
    // resume again: no-op
    assert.equal((await pb(owner, room.id, 'resume')).body.startedAt, resumed.body.startedAt);
  });

  test('pause and resume on an idle room are refused', async () => {
    const room = await createRoom(owner, { name: 'IdlePause' });
    assert.equal((await pb(owner, room.id, 'pause')).body.code, 'NOTHING_PLAYING');
    assert.equal((await pb(owner, room.id, 'resume')).body.code, 'NOTHING_PLAYING');
  });
});

describe('realtime', () => {
  test('playback:updated reaches a non-owner client and is in the join snapshot', async () => {
    const room = await createRoom(owner, { name: 'Live' });
    const socket = await connectSocket(member);
    const ack = await emitAck(socket, 'room:join', { roomId: room.id });
    assert.equal(ack.ok, true);
    assert.equal(ack.playback.status, 'IDLE');
    assert.ok(ack.playback.serverTime);

    const update = waitForEvent(socket, 'playback:updated', (p) => p.status === 'PLAYING');
    const a = await suggestTrack(owner, room.id);
    const payload = await update;
    assert.equal(payload.roomId, room.id);
    assert.equal(payload.currentTrack.id, a.id);
    assert.ok(payload.startedAt && payload.serverTime && typeof payload.positionMs === 'number');

    const late = await connectSocket(invitee);
    const lateAck = await emitAck(late, 'room:join', { roomId: room.id });
    assert.equal(lateAck.playback.status, 'PLAYING');
    assert.equal(lateAck.playback.currentTrack.id, a.id);
  });
});

describe('roles, permissions and PATCH', () => {
  test('myRole and permissions for owner, invited and member', async () => {
    const room = await createRoom(owner, { name: 'Rôles', visibility: 'PRIVATE', license: 'INVITED_ONLY' });
    await api('POST', `/api/rooms/${room.id}/invites`, { token: owner.token, body: { userId: invitee.id } });

    const o = (await api('GET', `/api/rooms/${room.id}`, { token: owner.token })).body;
    assert.equal(o.myRole, 'OWNER');
    assert.deepEqual(
      [o.permissions.canVote, o.permissions.canControlPlayback, o.permissions.canManageRoom,
        o.permissions.canInvite, o.permissions.canRemoveTrack, o.permissions.canSuggest],
      [true, true, true, true, true, true]
    );

    const i = (await api('GET', `/api/rooms/${room.id}`, { token: invitee.token })).body;
    assert.equal(i.myRole, 'INVITED');
    assert.equal(i.permissions.canVote, true);
    assert.equal(i.permissions.canControlPlayback, false);
    assert.equal(i.permissions.canManageRoom, false);
    assert.equal(i.inviteCode, undefined);

    const pub = await createRoom(owner, { name: 'Publique', license: 'INVITED_ONLY' });
    const m = (await api('GET', `/api/rooms/${pub.id}`, { token: member.token })).body;
    assert.equal(m.myRole, 'MEMBER');
    assert.equal(m.permissions.canVote, false);
    assert.match(m.permissions.voteBlockedReason, /invités/);
    assert.equal(m.permissions.canSuggest, true);
    assert.equal(m.permissions.canRemoveTrack, false);

    const geo = await createRoom(owner, {
      name: 'Géo', license: 'GEO_TIME_RESTRICTED', latitude: 48.86, longitude: 2.32, radiusM: 500,
    });
    const g = (await api('GET', `/api/rooms/${geo.id}`, { token: member.token })).body;
    assert.equal(g.permissions.canVote, true);
    assert.equal(g.permissions.voteRequiresLocation, true);
    assert.ok(g.permissions.voteBlockedReason);
  });

  test('PATCH: owner only, validated, broadcasts room:updated', async () => {
    const room = await createRoom(owner, { name: 'Avant' });
    const socket = await connectSocket(member);
    await emitAck(socket, 'room:join', { roomId: room.id });

    const forbidden = await api('PATCH', `/api/rooms/${room.id}`, { token: member.token, body: { name: 'X' } });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'NOT_ROOM_OWNER');

    const bad = await api('PATCH', `/api/rooms/${room.id}`, { token: owner.token, body: { name: '' } });
    assert.equal(bad.status, 400);
    const empty = await api('PATCH', `/api/rooms/${room.id}`, { token: owner.token, body: {} });
    assert.equal(empty.status, 400);
    const geoMissing = await api('PATCH', `/api/rooms/${room.id}`, {
      token: owner.token, body: { license: 'GEO_TIME_RESTRICTED' },
    });
    assert.equal(geoMissing.status, 400);
    assert.equal(geoMissing.body.code, 'GEO_CONFIG_REQUIRED');
    const partialZone = await api('PATCH', `/api/rooms/${room.id}`, {
      token: owner.token, body: { latitude: 10 },
    });
    assert.equal(partialZone.status, 400);

    const updated = waitForEvent(socket, 'room:updated', (p) => p.room.name === 'Après');
    const ok = await api('PATCH', `/api/rooms/${room.id}`, {
      token: owner.token,
      body: { name: 'Après', license: 'GEO_TIME_RESTRICTED', latitude: 1, longitude: 2, radiusM: 100 },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.license, 'GEO_TIME_RESTRICTED');
    assert.equal(ok.body.myRole, 'OWNER');
    const evt = await updated;
    assert.equal(evt.room.license, 'GEO_TIME_RESTRICTED');
    assert.equal(evt.room.inviteCode, undefined);

    // Going private creates a code, a non-invited subscriber is evicted; public again drops it.
    const revoked = waitForEvent(socket, 'room:revoked');
    const priv = await api('PATCH', `/api/rooms/${room.id}`, {
      token: owner.token, body: { visibility: 'PRIVATE', license: 'EVERYONE', latitude: null, longitude: null, radiusM: null },
    });
    assert.equal(priv.status, 200);
    assert.ok(priv.body.inviteCode);
    await revoked;
    const pubAgain = await api('PATCH', `/api/rooms/${room.id}`, { token: owner.token, body: { visibility: 'PUBLIC' } });
    assert.equal(pubAgain.body.inviteCode, null);
  });
});
