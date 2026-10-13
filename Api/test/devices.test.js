import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  stopServer,
  resetDb,
  api,
  createUser,
  befriend,
  registerDevice,
  delegateDevice,
  prisma,
} from './helpers.js';

let owner;
let friend;
let stranger;

before(async () => {
  await resetDb();
  await startServer();
  owner = await createUser('owner');
  friend = await createUser('friend');
  stranger = await createUser('stranger');
  await befriend(owner, friend);
});

after(stopServer);

describe('devices', () => {
  test('register returns 201, same installationId returns the existing device (200)', async () => {
    const body = { name: 'Salon', platform: 'ios', installationId: 'install-1' };
    const first = await api('POST', '/api/devices', { token: owner.token, body });
    assert.equal(first.status, 201);
    assert.equal(first.body.name, 'Salon');
    assert.equal(first.body.platform, 'ios');

    const again = await api('POST', '/api/devices', { token: owner.token, body });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, first.body.id);

    // Same installationId for another user is a different device.
    const other = await api('POST', '/api/devices', { token: stranger.token, body });
    assert.equal(other.status, 201);
    assert.notEqual(other.body.id, first.body.id);
  });

  test('re-registering an installation with a new name/platform updates it (200)', async () => {
    const body = { name: 'Vieux nom', platform: 'android', installationId: 'install-rename' };
    const first = await api('POST', '/api/devices', { token: owner.token, body });
    assert.equal(first.status, 201);
    const again = await api('POST', '/api/devices', {
      token: owner.token,
      body: { ...body, name: 'Nouveau nom', platform: 'ios' },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, first.body.id);
    assert.equal(again.body.name, 'Nouveau nom');
    assert.equal(again.body.platform, 'ios');
    const list = await api('GET', '/api/devices', { token: owner.token });
    assert.equal(list.body.filter((d) => d.id === first.body.id)[0].name, 'Nouveau nom');
  });

  test('unexpected errors answer 500 with code INTERNAL_ERROR', async () => {
    const original = prisma.device.findMany;
    prisma.device.findMany = () => Promise.reject(new Error('boom'));
    try {
      const res = await api('GET', '/api/devices', { token: owner.token });
      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
      assert.ok(res.body.error);
    } finally {
      prisma.device.findMany = original;
    }
  });

  test('register validates its input (400)', async () => {
    for (const body of [
      {},
      { name: '', platform: 'ios', installationId: 'x' },
      { name: 'A', installationId: 'x' },
      { name: 'A', platform: 'ios' },
      { name: 'x'.repeat(101), platform: 'ios', installationId: 'x' },
    ]) {
      const res = await api('POST', '/api/devices', { token: owner.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error);
    }
  });

  test('list, rename and delete are restricted to the owner', async () => {
    const device = await registerDevice(owner, { name: 'Cuisine' });

    const mine = await api('GET', '/api/devices', { token: owner.token });
    assert.ok(mine.body.some((d) => d.id === device.id));
    const theirs = await api('GET', '/api/devices', { token: stranger.token });
    assert.ok(!theirs.body.some((d) => d.id === device.id));

    const forbidden = await api('PATCH', `/api/devices/${device.id}`, {
      token: stranger.token,
      body: { name: 'Pirate' },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'NOT_DEVICE_OWNER');

    const renamed = await api('PATCH', `/api/devices/${device.id}`, {
      token: owner.token,
      body: { name: 'Cuisine 2' },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'Cuisine 2');

    const delForbidden = await api('DELETE', `/api/devices/${device.id}`, { token: stranger.token });
    assert.equal(delForbidden.status, 403);

    const del = await api('DELETE', `/api/devices/${device.id}`, { token: owner.token });
    assert.equal(del.status, 204);

    const missing = await api('PATCH', `/api/devices/${device.id}`, {
      token: owner.token,
      body: { name: 'X' },
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'DEVICE_NOT_FOUND');
  });

  test('device routes require a JWT', async () => {
    assert.equal((await api('GET', '/api/devices')).status, 401);
    assert.equal((await api('GET', '/api/delegations/received')).status, 401);
  });
});

describe('delegations', () => {
  test('delegating to a non-friend is 403 NOT_FRIENDS', async () => {
    const device = await registerDevice(owner);
    const res = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: owner.token,
      body: { userId: stranger.id },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'NOT_FRIENDS');

    // A pending request is not enough either.
    const req = await api('POST', '/api/friends/requests', {
      token: owner.token,
      body: { userId: stranger.id },
    });
    assert.equal(req.status, 201);
    const pending = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: owner.token,
      body: { userId: stranger.id },
    });
    assert.equal(pending.status, 403);
    assert.equal(pending.body.code, 'NOT_FRIENDS');
    await api('DELETE', `/api/friends/requests/${req.body.id}`, { token: owner.token });
  });

  test('only the device owner can delegate (403)', async () => {
    const device = await registerDevice(owner);
    // friend is friends with owner, but does not own the device.
    const res = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: friend.token,
      body: { userId: owner.id },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'NOT_DEVICE_OWNER');

    const list = await api('GET', `/api/devices/${device.id}/delegations`, { token: friend.token });
    assert.equal(list.status, 403);
  });

  test('delegating to self is 400, unknown device is 404', async () => {
    const device = await registerDevice(owner);
    const self = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: owner.token,
      body: { userId: owner.id },
    });
    assert.equal(self.status, 400);
    assert.equal(self.body.code, 'CANNOT_DELEGATE_SELF');

    const missing = await api('POST', '/api/devices/nope/delegations', {
      token: owner.token,
      body: { userId: friend.id },
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'DEVICE_NOT_FOUND');

    const invalid = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: owner.token,
      body: { userId: friend.id, canSkip: 'yes' },
    });
    assert.equal(invalid.status, 400);
  });

  test('delegate to friend is 201 with rights; duplicate updates rights (200)', async () => {
    const device = await registerDevice(owner);
    const created = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: owner.token,
      body: { userId: friend.id, canVolume: false },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.deviceId, device.id);
    assert.deepEqual(created.body.delegate, { id: friend.id, name: friend.name });
    assert.equal(created.body.canPlayPause, true);
    assert.equal(created.body.canSkip, true);
    assert.equal(created.body.canVolume, false);
    assert.equal(created.body.active, true);

    const dup = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: owner.token,
      body: { userId: friend.id, canSkip: false },
    });
    assert.equal(dup.status, 200);
    assert.equal(dup.body.id, created.body.id);
    assert.equal(dup.body.canSkip, false);
    assert.equal(dup.body.canVolume, false, 'unspecified rights are kept on update');

    const patched = await api('PATCH', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
      body: { canVolume: true },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.canVolume, true);

    const emptyPatch = await api('PATCH', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
      body: {},
    });
    assert.equal(emptyPatch.status, 400);

    const list = await api('GET', `/api/devices/${device.id}/delegations`, { token: owner.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].delegate.id, friend.id);
  });

  test('received list shows devices delegated to the caller with owner name and rights', async () => {
    const device = await registerDevice(owner, { name: 'Enceinte' });
    await delegateDevice(owner, device.id, friend, { canSkip: false });

    const res = await api('GET', '/api/delegations/received', { token: friend.token });
    assert.equal(res.status, 200);
    const entry = res.body.find((d) => d.deviceId === device.id);
    assert.ok(entry);
    assert.deepEqual(entry.owner, { id: owner.id, name: owner.name });
    assert.equal(entry.device.name, 'Enceinte');
    assert.equal(entry.canPlayPause, true);
    assert.equal(entry.canSkip, false);
    assert.equal(entry.canVolume, true);
    assert.equal(entry.owner.email, undefined);

    const none = await api('GET', '/api/delegations/received', { token: stranger.token });
    assert.deepEqual(none.body, []);
  });

  test('revoke makes the delegation inactive; delegating again reactivates it (201)', async () => {
    const device = await registerDevice(owner);
    await delegateDevice(owner, device.id, friend);

    const forbidden = await api('DELETE', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: friend.token,
    });
    assert.equal(forbidden.status, 403);

    const res = await api('DELETE', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
    });
    assert.equal(res.status, 204);

    const row = await prisma.controlDelegation.findUnique({
      where: { deviceId_delegateId: { deviceId: device.id, delegateId: friend.id } },
    });
    assert.equal(row.active, false);

    const received = await api('GET', '/api/delegations/received', { token: friend.token });
    assert.ok(!received.body.some((d) => d.deviceId === device.id));

    const again = await api('DELETE', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
    });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'DELEGATION_NOT_FOUND');

    const patch = await api('PATCH', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
      body: { canSkip: false },
    });
    assert.equal(patch.status, 404);

    const reactivated = await api('POST', `/api/devices/${device.id}/delegations`, {
      token: owner.token,
      body: { userId: friend.id },
    });
    assert.equal(reactivated.status, 201);
    assert.equal(reactivated.body.active, true);
  });

  test('unfriend removes the delegations in both directions', async () => {
    const other = await createUser('other');
    await befriend(owner, other);
    const ownerDevice = await registerDevice(owner);
    const otherDevice = await registerDevice(other);
    await delegateDevice(owner, ownerDevice.id, other);
    await delegateDevice(other, otherDevice.id, owner);

    const res = await api('DELETE', `/api/friends/${other.id}`, { token: owner.token });
    assert.equal(res.status, 204);

    assert.equal(
      await prisma.controlDelegation.count({
        where: { deviceId: { in: [ownerDevice.id, otherDevice.id] } },
      }),
      0
    );
    const received = await api('GET', '/api/delegations/received', { token: other.token });
    assert.ok(!received.body.some((d) => d.deviceId === ownerDevice.id));
  });

  test('deleting a device removes its delegations', async () => {
    const device = await registerDevice(owner);
    await delegateDevice(owner, device.id, friend);
    const res = await api('DELETE', `/api/devices/${device.id}`, { token: owner.token });
    assert.equal(res.status, 204);
    assert.equal(await prisma.controlDelegation.count({ where: { deviceId: device.id } }), 0);
  });

  test('the license is per device: delegating A grants nothing on B', async () => {
    const a = await registerDevice(owner, { name: 'A' });
    const b = await registerDevice(owner, { name: 'B' });
    await delegateDevice(owner, a.id, friend);

    const received = await api('GET', '/api/delegations/received', { token: friend.token });
    assert.ok(received.body.some((d) => d.deviceId === a.id));
    assert.ok(!received.body.some((d) => d.deviceId === b.id));
    const onB = await api('GET', `/api/devices/${b.id}/delegations`, { token: owner.token });
    assert.deepEqual(onB.body, []);
  });
});
