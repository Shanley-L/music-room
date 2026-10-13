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
  prisma,
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

async function createPlaylist(body = {}, user = owner) {
  const res = await api('POST', '/api/playlists', {
    token: user.token,
    body: { name: 'Playlist', ...body },
  });
  assert.equal(res.status, 201);
  return res.body.playlist;
}

let counter = 0;
function addTrack(playlistId, overrides = {}, user = owner) {
  counter += 1;
  return api('POST', `/api/playlists/${playlistId}/tracks`, {
    token: user.token,
    body: { externalId: `ext-${counter}`, title: `Titre ${counter}`, artist: 'Artiste', ...overrides },
  });
}

function invite(playlistId, userId, canEdit, user = owner) {
  return api('POST', `/api/playlists/${playlistId}/invites`, {
    token: user.token,
    body: canEdit === undefined ? { userId } : { userId, canEdit },
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

    const upd = await api('PUT', `/api/playlists/${playlist.id}`, {
      token: owner.token,
      body: { name: 'Nouveau nom' },
    });
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
    const res = await api('DELETE', `/api/playlists/${b.id}/tracks/${track.id}`, {
      token: owner.token,
    });
    assert.equal(res.status, 404);
  });

  test('20 concurrent adds get unique contiguous positions', async () => {
    const playlist = await createPlaylist();
    const results = await Promise.all(Array.from({ length: 20 }, () => addTrack(playlist.id)));
    results.forEach((r) => assert.equal(r.status, 201));

    const res = await api('GET', `/api/playlists/${playlist.id}`, { token: owner.token });
    const positions = res.body.playlist.tracks.map((t) => t.position);
    assert.deepEqual(positions, Array.from({ length: 20 }, (_, i) => i));
  });
});

describe('reorder', () => {
  test('stale expectedVersion is a 409; the right one returns version + 1', async () => {
    const playlist = await createPlaylist();
    const t1 = (await addTrack(playlist.id)).body.track;
    const t2 = (await addTrack(playlist.id)).body.track;

    const current = (await api('GET', `/api/playlists/${playlist.id}`, { token: owner.token })).body
      .playlist.version;

    const stale = await api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
      token: owner.token,
      body: { trackIds: [t2.id, t1.id], expectedVersion: current - 1 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.currentVersion, current);
    assert.deepEqual(stale.body.currentTracks.map((t) => t.id), [t1.id, t2.id]);

    const ok = await api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
      token: owner.token,
      body: { trackIds: [t2.id, t1.id], expectedVersion: current },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.version, current + 1);
    assert.deepEqual(ok.body.tracks.map((t) => t.id), [t2.id, t1.id]);
  });
});

describe('authentication', () => {
  test('every playlist route returns 401 without a token', async () => {
    const playlist = await createPlaylist();
    const routes = [
      ['GET', '/api/playlists'],
      ['POST', '/api/playlists', { name: 'x' }],
      ['POST', '/api/playlists/join', { inviteCode: playlist.inviteCode }],
      ['GET', `/api/playlists/${playlist.id}`],
      ['PUT', `/api/playlists/${playlist.id}`, { name: 'x' }],
      ['DELETE', `/api/playlists/${playlist.id}`],
      ['POST', `/api/playlists/${playlist.id}/invites`, { userId: stranger.id }],
      ['DELETE', `/api/playlists/${playlist.id}/invites/${stranger.id}`],
      ['POST', `/api/playlists/${playlist.id}/tracks`, { externalId: '1', title: 't', artist: 'a' }],
      ['DELETE', `/api/playlists/${playlist.id}/tracks/whatever`],
      ['PUT', `/api/playlists/${playlist.id}/tracks/reorder`, { trackIds: [] }],
    ];
    for (const [method, path, body] of routes) {
      const res = await api(method, path, { body });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  test('the x-dev-user-id header no longer authenticates', async () => {
    const res = await fetch(`${(await startServer())}/api/playlists`, {
      headers: { 'x-dev-user-id': owner.id },
    });
    assert.equal(res.status, 401);
  });
});

describe('ownership and visibility', () => {
  test('create: owner is the caller, body ownerId is ignored', async () => {
    const playlist = await createPlaylist({ ownerId: stranger.id });
    assert.equal(playlist.ownerId, owner.id);
  });

  test('addedBy is the caller, body addedBy is ignored', async () => {
    const playlist = await createPlaylist();
    const res = await addTrack(playlist.id, { addedBy: stranger.id }, invitee);
    assert.equal(res.status, 201);
    assert.equal(res.body.track.addedBy, invitee.id);
  });

  test('private playlist: non-invited GET is 403 PLAYLIST_FORBIDDEN, invitee and owner can read', async () => {
    const playlist = await createPlaylist({ visibility: 'PRIVATE' });

    const denied = await api('GET', `/api/playlists/${playlist.id}`, { token: stranger.token });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'PLAYLIST_FORBIDDEN');

    // A spoofed userId query param is ignored.
    const spoofed = await api('GET', `/api/playlists/${playlist.id}?userId=${owner.id}`, {
      token: stranger.token,
    });
    assert.equal(spoofed.status, 403);

    assert.equal((await invite(playlist.id, invitee.id)).status, 201);
    const asInvitee = await api('GET', `/api/playlists/${playlist.id}`, { token: invitee.token });
    assert.equal(asInvitee.status, 200);
    assert.equal(asInvitee.body.playlist.inviteCode, null, 'invite code hidden from non-owners');

    const asOwner = await api('GET', `/api/playlists/${playlist.id}`, { token: owner.token });
    assert.equal(asOwner.status, 200);
    assert.equal(asOwner.body.playlist.inviteCode, playlist.inviteCode);
  });

  test('private playlist: track writes by a stranger are 403 PLAYLIST_FORBIDDEN', async () => {
    const playlist = await createPlaylist({ visibility: 'PRIVATE' });
    const res = await addTrack(playlist.id, {}, stranger);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'PLAYLIST_FORBIDDEN');
  });

  test('missing playlist is 404 PLAYLIST_NOT_FOUND', async () => {
    const res = await api('GET', '/api/playlists/missing', { token: owner.token });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'PLAYLIST_NOT_FOUND');
  });

  test('list: public + own + invited, never private playlists of others', async () => {
    const mine = await createPlaylist({ visibility: 'PRIVATE', name: 'mine-private' }, stranger);
    const publicOther = await createPlaylist({ name: 'public-other' }, owner);
    const privateOther = await createPlaylist({ visibility: 'PRIVATE', name: 'private-other' }, owner);
    const invited = await createPlaylist({ visibility: 'PRIVATE', name: 'invited' }, owner);
    assert.equal((await invite(invited.id, stranger.id)).status, 201);

    const res = await api('GET', `/api/playlists?userId=${owner.id}`, { token: stranger.token });
    assert.equal(res.status, 200);
    const ids = res.body.playlists.map((p) => p.id);
    assert.ok(ids.includes(mine.id));
    assert.ok(ids.includes(publicOther.id));
    assert.ok(ids.includes(invited.id));
    assert.ok(!ids.includes(privateOther.id));
    for (const p of res.body.playlists) {
      if (p.ownerId !== stranger.id) assert.equal(p.inviteCode, null);
      else assert.ok(p.inviteCode);
    }

    const priv = await api('GET', '/api/playlists?visibility=PRIVATE', { token: stranger.token });
    const privIds = priv.body.playlists.map((p) => p.id).sort();
    assert.deepEqual(privIds, [mine.id, invited.id].sort());
  });
});

describe('edit license', () => {
  test('EVERYONE: any user with access edits tracks', async () => {
    const playlist = await createPlaylist();
    const added = await addTrack(playlist.id, {}, stranger);
    assert.equal(added.status, 201);

    const t2 = (await addTrack(playlist.id)).body.track;
    const reorder = await api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
      token: stranger.token,
      body: { trackIds: [t2.id, added.body.track.id] },
    });
    assert.equal(reorder.status, 200);

    const rm = await api('DELETE', `/api/playlists/${playlist.id}/tracks/${t2.id}`, {
      token: stranger.token,
    });
    assert.equal(rm.status, 200);

    const detail = await api('GET', `/api/playlists/${playlist.id}`, { token: stranger.token });
    assert.equal(detail.body.canEdit, true);
  });

  test('INVITED_ONLY on a public playlist: non-invited users get 403 PLAYLIST_EDIT_FORBIDDEN', async () => {
    const playlist = await createPlaylist({ license: 'INVITED_ONLY' });
    const t1 = (await addTrack(playlist.id)).body.track;

    const add = await addTrack(playlist.id, {}, stranger);
    assert.equal(add.status, 403);
    assert.equal(add.body.code, 'PLAYLIST_EDIT_FORBIDDEN');

    const rm = await api('DELETE', `/api/playlists/${playlist.id}/tracks/${t1.id}`, {
      token: stranger.token,
    });
    assert.equal(rm.status, 403);
    assert.equal(rm.body.code, 'PLAYLIST_EDIT_FORBIDDEN');

    const reorder = await api('PUT', `/api/playlists/${playlist.id}/tracks/reorder`, {
      token: stranger.token,
      body: { trackIds: [t1.id] },
    });
    assert.equal(reorder.status, 403);
    assert.equal(reorder.body.code, 'PLAYLIST_EDIT_FORBIDDEN');

    const detail = await api('GET', `/api/playlists/${playlist.id}`, { token: stranger.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.canEdit, false);
  });

  test('INVITED_ONLY: invitee with canEdit edits, invitee without canEdit cannot', async () => {
    const playlist = await createPlaylist({ license: 'INVITED_ONLY' });

    assert.equal((await invite(playlist.id, invitee.id, false)).status, 201);
    const denied = await addTrack(playlist.id, {}, invitee);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'PLAYLIST_EDIT_FORBIDDEN');

    const upd = await invite(playlist.id, invitee.id, true);
    assert.equal(upd.status, 201);
    assert.equal(upd.body.invite.canEdit, true);
    assert.equal((await addTrack(playlist.id, {}, invitee)).status, 201);
  });
});

describe('owner-only actions', () => {
  test('update and delete by an invitee or a stranger are 403 NOT_PLAYLIST_OWNER', async () => {
    const playlist = await createPlaylist();
    assert.equal((await invite(playlist.id, invitee.id)).status, 201);

    for (const user of [invitee, stranger]) {
      const upd = await api('PUT', `/api/playlists/${playlist.id}`, {
        token: user.token,
        body: { name: 'pwned' },
      });
      assert.equal(upd.status, 403);
      assert.equal(upd.body.code, 'NOT_PLAYLIST_OWNER');

      const del = await api('DELETE', `/api/playlists/${playlist.id}`, { token: user.token });
      assert.equal(del.status, 403);
      assert.equal(del.body.code, 'NOT_PLAYLIST_OWNER');
    }

    const still = await api('GET', `/api/playlists/${playlist.id}`, { token: owner.token });
    assert.equal(still.body.playlist.name, 'Playlist');

    const del = await api('DELETE', `/api/playlists/${playlist.id}`, { token: owner.token });
    assert.equal(del.status, 200);
  });

  test('invite and revoke: owner only, unknown user is 404 USER_NOT_FOUND', async () => {
    const playlist = await createPlaylist({ visibility: 'PRIVATE' });

    const unknown = await invite(playlist.id, 'no-such-user');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'USER_NOT_FOUND');

    const notOwner = await invite(playlist.id, stranger.id, true, invitee);
    assert.equal(notOwner.status, 403);
    assert.equal(notOwner.body.code, 'NOT_PLAYLIST_OWNER');

    const created = await invite(playlist.id, invitee.id);
    assert.equal(created.status, 201);
    assert.equal(created.body.invite.userId, invitee.id);
    assert.equal(created.body.invite.canEdit, true);
    assert.equal(
      (await api('GET', `/api/playlists/${playlist.id}`, { token: invitee.token })).status,
      200
    );

    const revokeByInvitee = await api(
      'DELETE',
      `/api/playlists/${playlist.id}/invites/${invitee.id}`,
      { token: invitee.token }
    );
    assert.equal(revokeByInvitee.status, 403);
    assert.equal(revokeByInvitee.body.code, 'NOT_PLAYLIST_OWNER');

    const revoked = await api('DELETE', `/api/playlists/${playlist.id}/invites/${invitee.id}`, {
      token: owner.token,
    });
    assert.equal(revoked.status, 204);
    assert.equal(
      (await api('GET', `/api/playlists/${playlist.id}`, { token: invitee.token })).status,
      403
    );

    const again = await api('DELETE', `/api/playlists/${playlist.id}/invites/${invitee.id}`, {
      token: owner.token,
    });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'INVITE_NOT_FOUND');
  });
});

describe('join by code', () => {
  test('creates an invite for the token caller, ignoring body userId', async () => {
    const playlist = await createPlaylist({ visibility: 'PRIVATE' });

    const res = await api('POST', '/api/playlists/join', {
      token: invitee.token,
      body: { inviteCode: playlist.inviteCode.toLowerCase(), userId: stranger.id },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.playlist.id, playlist.id);

    const invites = await prisma.playlistInvite.findMany({ where: { playlistId: playlist.id } });
    assert.deepEqual(invites.map((i) => i.userId), [invitee.id]);

    assert.equal(
      (await api('GET', `/api/playlists/${playlist.id}`, { token: stranger.token })).status,
      403
    );
  });

  test('invalid code is 404', async () => {
    const res = await api('POST', '/api/playlists/join', {
      token: invitee.token,
      body: { inviteCode: 'ZZZZZZZZ' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'INVALID_INVITE_CODE');
  });
});
