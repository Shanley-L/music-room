import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  stopServer,
  resetDb,
  api,
  createUser,
  connectSocket,
  emitAck,
  waitForEvent,
} from './helpers.js';

const PUBLIC_PLAYLIST_KEYS = [
  'coverUrl',
  'createdAt',
  'description',
  'id',
  'license',
  'name',
  'ownerId',
  'updatedAt',
  'version',
  'visibility',
];

let owner;

before(async () => {
  await resetDb();
  await startServer();
  owner = await createUser('owner');
});

after(stopServer);

async function createPlaylist(body = {}) {
  const res = await api('POST', '/api/playlists', {
    body: { name: 'Playlist', ownerId: owner.id, ...body },
  });
  assert.equal(res.status, 201);
  return res.body.playlist;
}

let counter = 0;
function addTrack(playlistId, overrides = {}) {
  counter += 1;
  return api('POST', `/api/playlists/${playlistId}/tracks`, {
    body: { externalId: `ext-${counter}`, title: `Titre ${counter}`, artist: 'Artiste', ...overrides },
  });
}

async function joinedSocket(playlistId) {
  const socket = await connectSocket(owner);
  assert.deepEqual(await emitAck(socket, 'playlist:join', { playlistId }), { ok: true });
  return socket;
}

describe('playlist:updated payload', () => {
  test('first track with a cover triggers playlist:updated without private fields', async () => {
    const playlist = await createPlaylist({ visibility: 'PRIVATE' });
    const socket = await joinedSocket(playlist.id);

    const res = await addTrack(playlist.id, { coverUrl: 'https://img.test/cover.jpg' });
    assert.equal(res.status, 201);

    const ev = await waitForEvent(socket, 'playlist:updated');
    assert.equal(ev.playlistId, playlist.id);
    assert.equal(ev.playlist.coverUrl, 'https://img.test/cover.jpg');
    assert.deepEqual(Object.keys(ev.playlist).sort(), PUBLIC_PLAYLIST_KEYS);
    assert.equal('inviteCode' in ev.playlist, false);
    assert.equal('invites' in ev.playlist, false);
  });

  test('update and addTrack-with-cover broadcast the same shape', async () => {
    const playlist = await createPlaylist({ visibility: 'PRIVATE' });
    const socket = await joinedSocket(playlist.id);

    await addTrack(playlist.id, { coverUrl: 'https://img.test/a.jpg' });
    const fromAdd = await waitForEvent(socket, 'playlist:updated');

    const upd = await api('PUT', `/api/playlists/${playlist.id}`, { body: { name: 'Nouveau nom' } });
    assert.equal(upd.status, 200);
    const fromUpdate = await waitForEvent(
      socket,
      'playlist:updated',
      (p) => p.playlist.name === 'Nouveau nom'
    );

    assert.deepEqual(Object.keys(fromUpdate).sort(), Object.keys(fromAdd).sort());
    assert.deepEqual(Object.keys(fromUpdate.playlist).sort(), PUBLIC_PLAYLIST_KEYS);
    assert.deepEqual(Object.keys(fromAdd.playlist).sort(), PUBLIC_PLAYLIST_KEYS);
  });
});

describe('tracks', () => {
  test('duplicate externalId is a 409 with isDuplicate', async () => {
    const playlist = await createPlaylist();
    assert.equal((await addTrack(playlist.id, { externalId: 'same' })).status, 201);
    const dup = await addTrack(playlist.id, { externalId: 'same' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.isDuplicate, true);
  });

  test('adding to a missing playlist is a 404', async () => {
    const res = await addTrack('missing-playlist');
    assert.equal(res.status, 404);
  });

  test('removing a track through another playlist id is a 404', async () => {
    const a = await createPlaylist();
    const b = await createPlaylist();
    const track = (await addTrack(a.id)).body.track;
    const res = await api('DELETE', `/api/playlists/${b.id}/tracks/${track.id}`);
    assert.equal(res.status, 404);
  });

  test('20 concurrent adds get unique contiguous positions', async () => {
    const playlist = await createPlaylist();
    const results = await Promise.all(Array.from({ length: 20 }, () => addTrack(playlist.id)));
    results.forEach((r) => assert.equal(r.status, 201));

    const res = await api('GET', `/api/playlists/${playlist.id}`);
    const positions = res.body.playlist.tracks.map((t) => t.position);
    assert.deepEqual(positions, Array.from({ length: 20 }, (_, i) => i));
  });
});

describe('reorder', () => {
  test('stale expectedVersion is a 409; the right one returns version + 1', async () => {
    const playlist = await createPlaylist();
    const t1 = (await addTrack(playlist.id)).body.track;
    const t2 = (await addTrack(playlist.id)).body.track;

    const current = (await api('GET', `/api/playlists/${playlist.id}`)).body.playlist.version;

    const stale = await api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
      body: { trackIds: [t2.id, t1.id], expectedVersion: current - 1 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.currentVersion, current);
    assert.deepEqual(stale.body.currentTracks.map((t) => t.id), [t1.id, t2.id]);

    const ok = await api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
      body: { trackIds: [t2.id, t1.id], expectedVersion: current },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.version, current + 1);
    assert.deepEqual(ok.body.tracks.map((t) => t.id), [t2.id, t1.id]);
  });
});
