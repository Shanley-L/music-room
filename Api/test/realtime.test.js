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
  sleep,
  prisma,
  tokenFor,
  startExtraInstance,
  isRedisUp,
} from './helpers.js';
import { blacklistToken } from '../src/lib/redis.js';

// How long to wait before asserting that an event was NOT delivered.
const QUIET_MS = 300;

const redisUp = await isRedisUp();

let owner;
let invitee;
let stranger;

before(async () => {
  await resetDb();
  await startServer();
  owner = await createUser('owner');
  invitee = await createUser('invitee');
  stranger = await createUser('stranger');
});

after(stopServer);

function eventsFor(socket, key, id) {
  return socket.received.filter((r) => r.payload?.[key] === id);
}

async function joinRoom(socket, roomId) {
  const ack = await emitAck(socket, 'room:join', { roomId });
  assert.equal(ack.ok, true);
}

async function joinPlaylist(socket, playlistId) {
  const ack = await emitAck(socket, 'playlist:join', { playlistId });
  assert.equal(ack.ok, true);
}

async function createPlaylist(user, body = {}) {
  const res = await api('POST', '/api/playlists', {
    token: user.token,
    body: { name: 'Playlist', ...body },
  });
  assert.equal(res.status, 201);
  return res.body.playlist;
}

let playlistTrackCounter = 0;
async function addPlaylistTrack(user, playlistId) {
  playlistTrackCounter += 1;
  const res = await api('POST', `/api/playlists/${playlistId}/tracks`, {
    token: user.token,
    body: {
      externalId: `pl-ext-${playlistTrackCounter}`,
      title: `Morceau ${playlistTrackCounter}`,
      artist: 'Artiste',
    },
  });
  assert.equal(res.status, 201);
  return res.body.track;
}

describe('handshake', () => {
  test('valid JWT connects', async () => {
    const socket = await connectSocket(owner);
    assert.equal(socket.connected, true);
    socket.disconnect();
  });

  test('missing, invalid and blacklisted tokens are rejected with UNAUTHORIZED', async () => {
    await assert.rejects(connectSocket(owner, { auth: {} }), { message: 'UNAUTHORIZED' });
    await assert.rejects(connectSocket(owner, { auth: { token: 'not-a-jwt' } }), {
      message: 'UNAUTHORIZED',
    });

    const revoked = await createUser('revoked');
    await blacklistToken(revoked.token, 60);
    await assert.rejects(connectSocket(revoked), { message: 'UNAUTHORIZED' });
  });

  test('connections and joins are logged with platform, device and version', async () => {
    const socket = await connectSocket(owner, {
      auth: { token: owner.token, platform: 'ios', device: 'iPhone 15', appVersion: '2.3.4' },
    });
    const room = await createRoom(owner, { name: 'Logs' });
    await joinRoom(socket, room.id);
    socket.disconnect();

    let logs = [];
    for (let i = 0; i < 20 && logs.length < 2; i++) {
      logs = await prisma.systemLog.findMany({
        where: { userId: owner.id, method: 'WS', platform: 'ios' },
      });
      if (logs.length < 2) await sleep(50);
    }
    const connect = logs.find((l) => l.action === 'WS connect');
    const join = logs.find((l) => l.action === `WS room:join ${room.id}`);
    assert.ok(connect, 'connection logged');
    assert.ok(join, 'join logged');
    assert.equal(join.device, 'iPhone 15');
    assert.equal(join.appVersion, '2.3.4');
    assert.equal(join.statusCode, 200);
  });
});

describe('rooms', () => {
  test('member joins a public room; private room is forbidden to non-invited users', async () => {
    const publicRoom = await createRoom(owner, { name: 'Publique' });
    const privateRoom = await createRoom(owner, { name: 'Privée', visibility: 'PRIVATE' });

    const s = await connectSocket(stranger);
    await joinRoom(s, publicRoom.id);

    const ack = await emitAck(s, 'room:join', { roomId: privateRoom.id });
    assert.deepEqual(ack, { ok: false, code: 'ROOM_FORBIDDEN' });

    const missing = await emitAck(s, 'room:join', { roomId: 'does-not-exist' });
    assert.deepEqual(missing, { ok: false, code: 'ROOM_NOT_FOUND' });

    const invalid = await emitAck(s, 'room:join', {});
    assert.deepEqual(invalid, { ok: false, code: 'VALIDATION_ERROR' });

    // The forbidden socket never receives events of the private room.
    const o = await connectSocket(owner);
    await joinRoom(o, privateRoom.id);
    const track = await suggestTrack(owner, privateRoom.id);
    const vote = await api('POST', `/api/rooms/${privateRoom.id}/tracks/${track.id}/vote`, {
      token: owner.token,
    });
    assert.equal(vote.status, 200);
    await waitForEvent(o, 'vote:changed', (p) => p.roomId === privateRoom.id);
    await sleep(QUIET_MS);
    assert.deepEqual(eventsFor(s, 'roomId', privateRoom.id), []);
  });

  test('votes broadcast queue:updated and vote:changed to every joined socket', async () => {
    const room = await createRoom(owner, { name: 'Votes' });
    const t1 = await suggestTrack(owner, room.id);
    const t2 = await suggestTrack(owner, room.id);

    const a = await connectSocket(owner);
    const b = await connectSocket(stranger);
    await joinRoom(a, room.id);
    await joinRoom(b, room.id);

    const res = await api('POST', `/api/rooms/${room.id}/tracks/${t2.id}/vote`, {
      token: stranger.token,
    });
    assert.equal(res.status, 200);

    for (const socket of [a, b]) {
      const changed = await waitForEvent(socket, 'vote:changed', (p) => p.trackId === t2.id);
      assert.deepEqual(changed, { roomId: room.id, trackId: t2.id, voteCount: 1 });

      const updated = await waitForEvent(
        socket,
        'queue:updated',
        (p) => p.roomId === room.id && p.queue[0]?.id === t2.id
      );
      assert.deepEqual(updated.queue.map((t) => t.id), [t2.id, t1.id]);
      assert.deepEqual(updated.queue.map((t) => t.position), [1, 2]);
      // hasVoted is per user: never part of the shared broadcast.
      assert.ok(updated.queue.every((t) => !('hasVoted' in t)));
    }

    const un = await api('DELETE', `/api/rooms/${room.id}/tracks/${t2.id}/vote`, {
      token: stranger.token,
    });
    assert.equal(un.status, 200);
    const changed = await waitForEvent(
      b,
      'vote:changed',
      (p) => p.trackId === t2.id && p.voteCount === 0
    );
    assert.equal(changed.voteCount, 0);
    await waitForEvent(b, 'queue:updated', (p) => p.queue[0]?.id === t1.id);
  });

  test('concurrent votes: the last queue:updated matches the server state', async () => {
    const room = await createRoom(owner, { name: 'Rafale' });
    const track = await suggestTrack(owner, room.id);
    const s = await connectSocket(owner);
    await joinRoom(s, room.id);

    const voters = await Promise.all(Array.from({ length: 10 }, (_, i) => createUser(`v${i}`)));
    const results = await Promise.all(
      voters.map((v) =>
        api('POST', `/api/rooms/${room.id}/tracks/${track.id}/vote`, { token: v.token })
      )
    );
    results.forEach((r) => assert.equal(r.status, 200));

    await waitForEvent(s, 'queue:updated', (p) => p.queue[0]?.voteCount === 10);
    await sleep(QUIET_MS);
    const updates = s.received.filter((r) => r.event === 'queue:updated');
    assert.equal(updates.at(-1).payload.queue[0].voteCount, 10);
  });

  test('suggest and delete broadcast track:suggested / track:removed plus queue:updated', async () => {
    const room = await createRoom(owner, { name: 'Suggestions' });
    const s = await connectSocket(stranger);
    await joinRoom(s, room.id);

    const track = await suggestTrack(stranger, room.id);
    const suggested = await waitForEvent(s, 'track:suggested');
    assert.equal(suggested.roomId, room.id);
    assert.equal(suggested.track.id, track.id);
    await waitForEvent(s, 'queue:updated', (p) => p.queue.some((t) => t.id === track.id));

    const del = await api('DELETE', `/api/rooms/${room.id}/tracks/${track.id}`, {
      token: owner.token,
    });
    assert.equal(del.status, 200);
    const removed = await waitForEvent(s, 'track:removed');
    assert.deepEqual(removed, { roomId: room.id, trackId: track.id });
    await waitForEvent(s, 'queue:updated', (p) => p.roomId === room.id && p.queue.length === 0);
  });

  test('revoked invitee stops receiving events and cannot rejoin', async () => {
    const room = await createRoom(owner, { name: 'Révocation', visibility: 'PRIVATE' });
    const inv = await api('POST', `/api/rooms/${room.id}/invites`, {
      token: owner.token,
      body: { userId: invitee.id },
    });
    assert.equal(inv.status, 201);

    const o = await connectSocket(owner);
    const i = await connectSocket(invitee);
    await joinRoom(o, room.id);
    await joinRoom(i, room.id);

    const revoke = await api('DELETE', `/api/rooms/${room.id}/invites/${invitee.id}`, {
      token: owner.token,
    });
    assert.equal(revoke.status, 204);
    const revoked = await waitForEvent(i, 'room:revoked', (p) => p.roomId === room.id);
    assert.deepEqual(revoked, { roomId: room.id });

    await suggestTrack(owner, room.id);
    await waitForEvent(o, 'track:suggested', (p) => p.roomId === room.id);
    await sleep(QUIET_MS);
    assert.deepEqual(
      eventsFor(i, 'roomId', room.id).map((r) => r.event),
      ['room:revoked']
    );
    assert.equal(o.received.filter((r) => r.event === 'room:revoked').length, 0);

    const rejoin = await emitAck(i, 'room:join', { roomId: room.id });
    assert.deepEqual(rejoin, { ok: false, code: 'ROOM_FORBIDDEN' });
  });

  test('revoking an invite on a public room keeps the user subscribed', async () => {
    const room = await createRoom(owner, { name: 'Publique invitée' });
    await api('POST', `/api/rooms/${room.id}/invites`, {
      token: owner.token,
      body: { userId: invitee.id },
    });
    const i = await connectSocket(invitee);
    await joinRoom(i, room.id);

    const revoke = await api('DELETE', `/api/rooms/${room.id}/invites/${invitee.id}`, {
      token: owner.token,
    });
    assert.equal(revoke.status, 204);

    await suggestTrack(owner, room.id);
    await waitForEvent(i, 'track:suggested', (p) => p.roomId === room.id);
    assert.equal(i.received.filter((r) => r.event === 'room:revoked').length, 0);
  });

  test('room deletion sends room:deleted and empties the channel', async () => {
    const room = await createRoom(owner, { name: 'Supprimée' });
    const s = await connectSocket(stranger);
    await joinRoom(s, room.id);

    const del = await api('DELETE', `/api/rooms/${room.id}`, { token: owner.token });
    assert.equal(del.status, 204);

    const deleted = await waitForEvent(s, 'room:deleted');
    assert.deepEqual(deleted, { roomId: room.id });

    const { getIo } = await import('../src/lib/realtime.js');
    const remaining = await getIo().in(`room:${room.id}`).fetchSockets();
    assert.equal(remaining.length, 0);
  });

  test('room:leave stops delivery', async () => {
    const room = await createRoom(owner, { name: 'Départ' });
    const s = await connectSocket(stranger);
    await joinRoom(s, room.id);
    assert.deepEqual(await emitAck(s, 'room:leave', { roomId: room.id }), { ok: true });

    const o = await connectSocket(owner);
    await joinRoom(o, room.id);
    await suggestTrack(owner, room.id);
    await waitForEvent(o, 'track:suggested', (p) => p.roomId === room.id);
    await sleep(QUIET_MS);
    assert.deepEqual(eventsFor(s, 'roomId', room.id), []);
  });
});

describe('playlists', () => {
  test('add, reorder, remove, update and delete broadcast the server state', async () => {
    const playlist = await createPlaylist(owner);
    const a = await connectSocket(owner);
    const b = await connectSocket(stranger);
    await joinPlaylist(a, playlist.id);
    await joinPlaylist(b, playlist.id);

    const t1 = await addPlaylistTrack(owner, playlist.id);
    const t2 = await addPlaylistTrack(stranger, playlist.id);
    const t3 = await addPlaylistTrack(owner, playlist.id);

    const afterAdd = await waitForEvent(b, 'playlist:tracks-updated', (p) => p.tracks.length === 3);
    assert.equal(afterAdd.playlistId, playlist.id);
    assert.deepEqual(afterAdd.tracks.map((t) => t.id), [t1.id, t2.id, t3.id]);

    const reorder = await api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
      token: stranger.token,
      body: { trackIds: [t3.id, t1.id, t2.id] },
    });
    assert.equal(reorder.status, 200);
    for (const socket of [a, b]) {
      const ev = await waitForEvent(socket, 'playlist:tracks-updated', (p) => p.tracks[0]?.id === t3.id);
      assert.deepEqual(ev.tracks.map((t) => t.id), [t3.id, t1.id, t2.id]);
      assert.deepEqual(ev.tracks.map((t) => t.position), [0, 1, 2]);
    }

    const rm = await api('DELETE', `/api/playlists/${playlist.id}/tracks/${t1.id}`, {
      token: owner.token,
    });
    assert.equal(rm.status, 200);
    const afterRm = await waitForEvent(
      b,
      'playlist:tracks-updated',
      (p) => p.tracks.length === 2 && !p.tracks.some((t) => t.id === t1.id)
    );
    assert.deepEqual(afterRm.tracks.map((t) => t.id), [t3.id, t2.id]);
    assert.deepEqual(afterRm.tracks.map((t) => t.position), [0, 1]);

    const upd = await api('PUT', `/api/playlists/${playlist.id}`, {
      token: owner.token,
      body: { license: 'INVITED_ONLY', name: 'Renommée' },
    });
    assert.equal(upd.status, 200);
    const updated = await waitForEvent(b, 'playlist:updated', (p) => p.playlist.name === 'Renommée');
    assert.equal(updated.playlistId, playlist.id);
    assert.equal(updated.playlist.license, 'INVITED_ONLY');

    const del = await api('DELETE', `/api/playlists/${playlist.id}`, { token: owner.token });
    assert.equal(del.status, 200);
    for (const socket of [a, b]) {
      assert.deepEqual(await waitForEvent(socket, 'playlist:deleted'), { playlistId: playlist.id });
    }
  });

  test('private playlist: non-invited join is forbidden, invited join works', async () => {
    const playlist = await createPlaylist(owner, { visibility: 'PRIVATE' });
    const s = await connectSocket(stranger);

    const ack = await emitAck(s, 'playlist:join', { playlistId: playlist.id });
    assert.deepEqual(ack, { ok: false, code: 'PLAYLIST_FORBIDDEN' });

    const missing = await emitAck(s, 'playlist:join', { playlistId: 'nope' });
    assert.deepEqual(missing, { ok: false, code: 'PLAYLIST_NOT_FOUND' });

    const o = await connectSocket(owner);
    await joinPlaylist(o, playlist.id);
    await addPlaylistTrack(owner, playlist.id);
    await waitForEvent(o, 'playlist:tracks-updated', (p) => p.playlistId === playlist.id);
    await sleep(QUIET_MS);
    assert.deepEqual(eventsFor(s, 'playlistId', playlist.id), []);

    const join = await api('POST', '/api/playlists/join', {
      token: invitee.token,
      body: { inviteCode: playlist.inviteCode },
    });
    assert.equal(join.status, 200);
    const i = await connectSocket(invitee);
    await joinPlaylist(i, playlist.id);
  });

  test('making a playlist private evicts sockets of users without access', async () => {
    const playlist = await createPlaylist(owner);
    const s = await connectSocket(stranger);
    const o = await connectSocket(owner);
    await joinPlaylist(s, playlist.id);
    await joinPlaylist(o, playlist.id);

    const upd = await api('PUT', `/api/playlists/${playlist.id}`, {
      token: owner.token,
      body: { visibility: 'PRIVATE' },
    });
    assert.equal(upd.status, 200);
    // The owner gets the update; the stranger is told and evicted before it is broadcast.
    await waitForEvent(o, 'playlist:updated', (p) => p.playlist.visibility === 'PRIVATE');
    const revoked = await waitForEvent(s, 'playlist:revoked', (p) => p.playlistId === playlist.id);
    assert.deepEqual(revoked, { playlistId: playlist.id });
    assert.equal(o.received.filter((r) => r.event === 'playlist:revoked').length, 0);

    await addPlaylistTrack(owner, playlist.id);
    await waitForEvent(o, 'playlist:tracks-updated', (p) => p.playlistId === playlist.id);
    await sleep(QUIET_MS);
    assert.deepEqual(
      eventsFor(s, 'playlistId', playlist.id).map((r) => r.event),
      ['playlist:revoked']
    );
  });

  test('revoking an invite on a private playlist evicts the revoked user sockets', async () => {
    const playlist = await createPlaylist(owner, { visibility: 'PRIVATE' });
    const inv = await api('POST', `/api/playlists/${playlist.id}/invites`, {
      token: owner.token,
      body: { userId: invitee.id },
    });
    assert.equal(inv.status, 201);

    const i = await connectSocket(invitee);
    const o = await connectSocket(owner);
    await joinPlaylist(i, playlist.id);
    await joinPlaylist(o, playlist.id);

    const rev = await api('DELETE', `/api/playlists/${playlist.id}/invites/${invitee.id}`, {
      token: owner.token,
    });
    assert.equal(rev.status, 204);
    const revoked = await waitForEvent(i, 'playlist:revoked', (p) => p.playlistId === playlist.id);
    assert.deepEqual(revoked, { playlistId: playlist.id });

    await addPlaylistTrack(owner, playlist.id);
    await waitForEvent(o, 'playlist:tracks-updated', (p) => p.playlistId === playlist.id);
    await sleep(QUIET_MS);
    assert.deepEqual(
      eventsFor(i, 'playlistId', playlist.id).map((r) => r.event),
      ['playlist:revoked']
    );

    const rejoin = await emitAck(i, 'playlist:join', { playlistId: playlist.id });
    assert.deepEqual(rejoin, { ok: false, code: 'PLAYLIST_FORBIDDEN' });
  });

  test('making a playlist private keeps invited subscribers (no playlist:revoked)', async () => {
    const playlist = await createPlaylist(owner);
    const inv = await api('POST', `/api/playlists/${playlist.id}/invites`, {
      token: owner.token,
      body: { userId: invitee.id },
    });
    assert.equal(inv.status, 201);
    const i = await connectSocket(invitee);
    await joinPlaylist(i, playlist.id);

    const upd = await api('PUT', `/api/playlists/${playlist.id}`, {
      token: owner.token,
      body: { visibility: 'PRIVATE' },
    });
    assert.equal(upd.status, 200);
    await waitForEvent(i, 'playlist:updated', (p) => p.playlist.visibility === 'PRIVATE');

    await addPlaylistTrack(owner, playlist.id);
    await waitForEvent(i, 'playlist:tracks-updated', (p) => p.playlistId === playlist.id);
    assert.equal(i.received.filter((r) => r.event === 'playlist:revoked').length, 0);
  });

  test('revoking an invite on a public playlist keeps the user subscribed (no playlist:revoked)', async () => {
    const playlist = await createPlaylist(owner);
    await api('POST', `/api/playlists/${playlist.id}/invites`, {
      token: owner.token,
      body: { userId: invitee.id },
    });
    const i = await connectSocket(invitee);
    await joinPlaylist(i, playlist.id);

    const rev = await api('DELETE', `/api/playlists/${playlist.id}/invites/${invitee.id}`, {
      token: owner.token,
    });
    assert.equal(rev.status, 204);

    await addPlaylistTrack(owner, playlist.id);
    await waitForEvent(i, 'playlist:tracks-updated', (p) => p.playlistId === playlist.id);
    assert.equal(i.received.filter((r) => r.event === 'playlist:revoked').length, 0);
  });

  test('two concurrent reorders: both clients end on the final server order', async () => {
    const playlist = await createPlaylist(owner);
    const tracks = [];
    for (let k = 0; k < 4; k++) tracks.push(await addPlaylistTrack(owner, playlist.id));
    const ids = tracks.map((t) => t.id);

    const a = await connectSocket(owner);
    const b = await connectSocket(stranger);
    await joinPlaylist(a, playlist.id);
    await joinPlaylist(b, playlist.id);

    const orderA = [ids[3], ids[2], ids[1], ids[0]];
    const orderB = [ids[1], ids[3], ids[0], ids[2]];
    const [ra, rb] = await Promise.all([
      api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
        token: owner.token,
        body: { trackIds: orderA },
      }),
      api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
        token: stranger.token,
        body: { trackIds: orderB },
      }),
    ]);
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);

    const final = await prisma.playlistTrack.findMany({
      where: { playlistId: playlist.id },
      orderBy: { position: 'asc' },
    });
    const finalIds = final.map((t) => t.id);
    assert.ok(
      [orderA, orderB].some((o) => JSON.stringify(o) === JSON.stringify(finalIds)),
      'final order is one of the submitted orders, not a mix'
    );
    assert.deepEqual(final.map((t) => t.position), [0, 1, 2, 3]);

    for (const socket of [a, b]) {
      await waitForEvent(socket, 'playlist:tracks-updated', () => true);
    }
    await sleep(QUIET_MS);
    for (const socket of [a, b]) {
      const updates = socket.received.filter((r) => r.event === 'playlist:tracks-updated');
      assert.deepEqual(updates.at(-1).payload.tracks.map((t) => t.id), finalIds);
    }
  });
});

describe('session limits', () => {
  test('the socket is disconnected when its JWT expires', async () => {
    const shortLived = { ...owner, token: tokenFor(owner, '1s') };
    const socket = await connectSocket(shortLived);
    const reason = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('not disconnected')), 4000);
      socket.once('disconnect', (r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
    assert.equal(reason, 'io server disconnect');
  });

  test('a token blacklisted after the handshake can no longer join', async () => {
    const user = await createUser('logout');
    const socket = await connectSocket(user);
    const room = await createRoom(owner, { name: 'Après logout' });
    await blacklistToken(user.token, 60);
    const ack = await emitAck(socket, 'room:join', { roomId: room.id });
    assert.deepEqual(ack, { ok: false, code: 'UNAUTHORIZED' });
  });

  test('a socket cannot join more than 50 channels', async () => {
    const rooms = [];
    for (let k = 0; k < 51; k++) rooms.push(await createRoom(owner, { name: `Cap ${k}` }));
    const socket = await connectSocket(stranger);
    for (const room of rooms.slice(0, 50)) await joinRoom(socket, room.id);

    const ack = await emitAck(socket, 'room:join', { roomId: rooms[50].id });
    assert.deepEqual(ack, { ok: false, code: 'TOO_MANY_CHANNELS' });

    // Re-joining an already joined channel is still fine, and leaving frees a slot.
    await joinRoom(socket, rooms[0].id);
    assert.deepEqual(await emitAck(socket, 'room:leave', { roomId: rooms[0].id }), { ok: true });
    await joinRoom(socket, rooms[50].id);
  });
});

describe('two instances sharing Redis', { skip: redisUp ? false : 'Redis unreachable' }, () => {
  test('REST write on A reaches a client on B; eviction on A removes the socket on B', async () => {
    const b = await startExtraInstance();
    try {
      const room = await createRoom(owner, { name: 'Multi-instance', visibility: 'PRIVATE' });
      await api('POST', `/api/rooms/${room.id}/invites`, {
        token: owner.token,
        body: { userId: invitee.id },
      });

      const onB = await connectSocket(invitee, { url: b.url });
      await joinRoom(onB, room.id);

      const track = await suggestTrack(owner, room.id);
      const suggested = await waitForEvent(onB, 'track:suggested', (p) => p.roomId === room.id);
      assert.equal(suggested.track.id, track.id);

      const revoke = await api('DELETE', `/api/rooms/${room.id}/invites/${invitee.id}`, {
        token: owner.token,
      });
      assert.equal(revoke.status, 204);
      await waitForEvent(onB, 'room:revoked', (p) => p.roomId === room.id);
      assert.equal((await b.io.in(`room:${room.id}`).fetchSockets()).length, 0);

      const before = eventsFor(onB, 'roomId', room.id).length;
      await suggestTrack(owner, room.id);
      await sleep(QUIET_MS);
      assert.equal(eventsFor(onB, 'roomId', room.id).length, before);
      onB.disconnect();
    } finally {
      await b.close();
    }
  });
});
