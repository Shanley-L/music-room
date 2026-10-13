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
} from './helpers.js';

let owner;
let invitee;
let stranger;
let privateRoom;
let publicRoom;

before(async () => {
  await resetDb();
  await startServer();
  owner = await createUser('owner');
  invitee = await createUser('invitee');
  stranger = await createUser('stranger');

  privateRoom = await createRoom(owner, { name: 'Soirée privée', visibility: 'PRIVATE' });
  publicRoom = await createRoom(owner, { name: 'Fête publique' });

  const inv = await api('POST', `/api/rooms/${privateRoom.id}/invites`, {
    token: owner.token,
    body: { userId: invitee.id },
  });
  assert.equal(inv.status, 201);
});

after(stopServer);

describe('room creation', () => {
  test('defaults to PUBLIC / EVERYONE without invite code', () => {
    assert.equal(publicRoom.visibility, 'PUBLIC');
    assert.equal(publicRoom.license, 'EVERYONE');
    assert.equal(publicRoom.inviteCode, null);
  });

  test('private room gets an invite code for its owner', () => {
    assert.equal(privateRoom.visibility, 'PRIVATE');
    assert.match(privateRoom.inviteCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
  });

  test('rejects missing name', async () => {
    const res = await api('POST', '/api/rooms', { token: owner.token, body: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  test('rejects invalid enum values', async () => {
    const res = await api('POST', '/api/rooms', {
      token: owner.token,
      body: { name: 'x', visibility: 'SECRET' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  test('rejects partial zone', async () => {
    const res = await api('POST', '/api/rooms', {
      token: owner.token,
      body: { name: 'x', license: 'GEO_TIME_RESTRICTED', latitude: 48.85 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  test('rejects voteStartAt >= voteEndAt', async () => {
    const at = new Date(Date.now() + 3600e3).toISOString();
    for (const voteEndAt of [at, new Date(Date.now()).toISOString()]) {
      const res = await api('POST', '/api/rooms', {
        token: owner.token,
        body: { name: 'x', license: 'GEO_TIME_RESTRICTED', voteStartAt: at, voteEndAt },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    }
  });

  test('rejects null, numeric, boolean and invalid dates', async () => {
    for (const voteStartAt of [null, 0, 1700000000000, true, '', 'not-a-date']) {
      const res = await api('POST', '/api/rooms', {
        token: owner.token,
        body: { name: 'x', license: 'GEO_TIME_RESTRICTED', voteStartAt },
      });
      assert.equal(res.status, 400, `voteStartAt=${JSON.stringify(voteStartAt)}`);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    }
    const end = await api('POST', '/api/rooms', {
      token: owner.token,
      body: { name: 'x', license: 'GEO_TIME_RESTRICTED', voteEndAt: null },
    });
    assert.equal(end.status, 400);
    assert.equal(end.body.code, 'VALIDATION_ERROR');
  });

  test('rejects radiusM above the Int32 range', async () => {
    const res = await api('POST', '/api/rooms', {
      token: owner.token,
      body: { name: 'x', license: 'GEO_TIME_RESTRICTED', latitude: 0, longitude: 0, radiusM: 2147483648 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  test('GEO license without zone or window is rejected', async () => {
    const res = await api('POST', '/api/rooms', {
      token: owner.token,
      body: { name: 'Géo', license: 'GEO_TIME_RESTRICTED' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'GEO_CONFIG_REQUIRED');
    assert.ok(res.body.error);
  });

  test('GEO license with only a window is accepted', async () => {
    const res = await api('POST', '/api/rooms', {
      token: owner.token,
      body: {
        name: 'Géo fenêtre',
        license: 'GEO_TIME_RESTRICTED',
        voteStartAt: new Date(Date.now() - 3600e3).toISOString(),
        voteEndAt: new Date(Date.now() + 3600e3).toISOString(),
      },
    });
    assert.equal(res.status, 201);
  });
});

describe('room visibility', () => {
  test('non-invited user gets 403 on a private room', async () => {
    const res = await api('GET', `/api/rooms/${privateRoom.id}`, { token: stranger.token });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'ROOM_FORBIDDEN');
  });

  test('owner sees invite code and invites', async () => {
    const res = await api('GET', `/api/rooms/${privateRoom.id}`, { token: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.inviteCode, privateRoom.inviteCode);
    assert.ok(Array.isArray(res.body.invites));
    assert.equal(res.body.invites.length, 1);
  });

  test('invitee sees the room without invite code or invites', async () => {
    const res = await api('GET', `/api/rooms/${privateRoom.id}`, { token: invitee.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.inviteCode, undefined);
    assert.equal(res.body.invites, undefined);
  });

  test('public room is readable by anyone, without owner-only fields', async () => {
    const res = await api('GET', `/api/rooms/${publicRoom.id}`, { token: stranger.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.inviteCode, undefined);
    assert.equal(res.body.invites, undefined);
  });

  test('unknown room returns 404', async () => {
    const res = await api('GET', '/api/rooms/does-not-exist', { token: owner.token });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ROOM_NOT_FOUND');
  });

  test('GET /public never lists private rooms nor invite codes', async () => {
    const res = await api('GET', '/api/rooms/public', { token: stranger.token });
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 1);
    for (const room of res.body) {
      assert.equal(room.visibility, 'PUBLIC');
      assert.equal('inviteCode' in room, false);
    }
    assert.ok(!res.body.some((r) => r.id === privateRoom.id));
  });

  test('non-invited user cannot list or suggest tracks in a private room', async () => {
    const list = await api('GET', `/api/rooms/${privateRoom.id}/tracks`, { token: stranger.token });
    assert.equal(list.status, 403);
    const sug = await api('POST', `/api/rooms/${privateRoom.id}/tracks`, {
      token: stranger.token,
      body: { externalId: '1', title: 't', artist: 'a' },
    });
    assert.equal(sug.status, 403);
  });

  test('joining by code grants access but not the invite code', async () => {
    const joiner = await createUser('joiner');
    const res = await api('POST', '/api/rooms/join', {
      token: joiner.token,
      body: { inviteCode: privateRoom.inviteCode },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.inviteCode, undefined);

    const read = await api('GET', `/api/rooms/${privateRoom.id}`, { token: joiner.token });
    assert.equal(read.status, 200);
  });

  test('joining with a wrong code fails', async () => {
    const res = await api('POST', '/api/rooms/join', {
      token: stranger.token,
      body: { inviteCode: 'NOPE0000' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'INVALID_INVITE_CODE');
  });
});

describe('owner management', () => {
  test('GET /mine lists owned and invited rooms', async () => {
    const mineOwner = await api('GET', '/api/rooms/mine', { token: owner.token });
    assert.equal(mineOwner.status, 200);
    const ids = mineOwner.body.map((r) => r.id);
    assert.ok(ids.includes(privateRoom.id));
    assert.ok(ids.includes(publicRoom.id));
    assert.equal(mineOwner.body.find((r) => r.id === privateRoom.id).inviteCode, privateRoom.inviteCode);

    const mineInvitee = await api('GET', '/api/rooms/mine', { token: invitee.token });
    assert.deepEqual(mineInvitee.body.map((r) => r.id), [privateRoom.id]);
    assert.equal(mineInvitee.body[0].inviteCode, undefined);

    const mineStranger = await api('GET', '/api/rooms/mine', { token: stranger.token });
    assert.deepEqual(mineStranger.body, []);
  });

  test('only the owner can invite', async () => {
    const res = await api('POST', `/api/rooms/${privateRoom.id}/invites`, {
      token: invitee.token,
      body: { userId: stranger.id },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'NOT_ROOM_OWNER');
  });

  test('inviting an unknown user returns 404', async () => {
    const res = await api('POST', `/api/rooms/${privateRoom.id}/invites`, {
      token: owner.token,
      body: { userId: 'no-such-user' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'USER_NOT_FOUND');
  });

  test('owner can revoke an invite, which removes access', async () => {
    const guest = await createUser('guest');
    await api('POST', `/api/rooms/${privateRoom.id}/invites`, {
      token: owner.token,
      body: { userId: guest.id },
    });
    assert.equal((await api('GET', `/api/rooms/${privateRoom.id}`, { token: guest.token })).status, 200);

    const notOwner = await api('DELETE', `/api/rooms/${privateRoom.id}/invites/${guest.id}`, {
      token: invitee.token,
    });
    assert.equal(notOwner.status, 403);

    const del = await api('DELETE', `/api/rooms/${privateRoom.id}/invites/${guest.id}`, {
      token: owner.token,
    });
    assert.equal(del.status, 204);

    assert.equal((await api('GET', `/api/rooms/${privateRoom.id}`, { token: guest.token })).status, 403);

    const again = await api('DELETE', `/api/rooms/${privateRoom.id}/invites/${guest.id}`, {
      token: owner.token,
    });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'INVITE_NOT_FOUND');
  });

  test('only the owner can delete a track, and the queue is compacted', async () => {
    const room = await createRoom(owner, { name: 'Suppression titres' });
    const t1 = await suggestTrack(stranger, room.id);
    const t2 = await suggestTrack(stranger, room.id);
    const t3 = await suggestTrack(stranger, room.id);

    const forbidden = await api('DELETE', `/api/rooms/${room.id}/tracks/${t2.id}`, {
      token: stranger.token,
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'NOT_ROOM_OWNER');

    const del = await api('DELETE', `/api/rooms/${room.id}/tracks/${t2.id}`, { token: owner.token });
    assert.equal(del.status, 200);
    assert.deepEqual(
      del.body.queue.map((t) => [t.id, t.position]),
      [[t1.id, 1], [t3.id, 2]]
    );

    const missing = await api('DELETE', `/api/rooms/${room.id}/tracks/${t2.id}`, { token: owner.token });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'TRACK_NOT_FOUND');
  });

  test('only the owner can delete a room', async () => {
    const room = await createRoom(owner, { name: 'À supprimer' });
    await suggestTrack(owner, room.id);

    const forbidden = await api('DELETE', `/api/rooms/${room.id}`, { token: stranger.token });
    assert.equal(forbidden.status, 403);

    const del = await api('DELETE', `/api/rooms/${room.id}`, { token: owner.token });
    assert.equal(del.status, 204);

    const read = await api('GET', `/api/rooms/${room.id}`, { token: owner.token });
    assert.equal(read.status, 404);
  });
});

test('swagger lists the new endpoints', async () => {
  const res = await api('GET', '/api-docs.json');
  assert.equal(res.status, 200);
  const paths = res.body.paths;
  assert.ok(paths['/api/rooms/mine']?.get);
  assert.ok(paths['/api/rooms/{id}']?.delete);
  assert.ok(paths['/api/rooms/{id}/invites/{userId}']?.delete);
  assert.ok(paths['/api/rooms/{roomId}/tracks/{trackId}']?.delete);
  assert.ok(paths['/api/rooms/{roomId}/tracks/{trackId}/vote']?.post);
});
