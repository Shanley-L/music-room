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
  connectSocket,
  emitAck,
  waitForEvent,
  sleep,
  startExtraInstance,
  isRedisUp,
} from './helpers.js';
import { blacklistToken } from '../src/lib/redis.js';

// How long to wait before asserting that an event was NOT delivered.
const QUIET_MS = 300;

const redisUp = await isRedisUp();

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

function received(socket, event, deviceId) {
  return socket.received.filter((r) => r.event === event && r.payload?.deviceId === deviceId);
}

/** Device owned by `owner` with a connected player socket. */
async function onlineDevice(name = 'Salon') {
  const device = await registerDevice(owner, { name });
  const player = await connectSocket(owner);
  assert.deepEqual(await emitAck(player, 'device:register', { deviceId: device.id }), { ok: true });
  return { device, player };
}

async function watch(socket, deviceId) {
  assert.deepEqual(await emitAck(socket, 'device:watch', { deviceId }), { ok: true });
}

describe('device:register and device:watch', () => {
  test('only the owner can register a player; unknown device is DEVICE_NOT_FOUND', async () => {
    const device = await registerDevice(owner);
    await delegateDevice(owner, device.id, friend);

    const friendSocket = await connectSocket(friend);
    assert.deepEqual(await emitAck(friendSocket, 'device:register', { deviceId: device.id }), {
      ok: false,
      code: 'DEVICE_FORBIDDEN',
    });
    assert.deepEqual(await emitAck(friendSocket, 'device:register', { deviceId: 'nope' }), {
      ok: false,
      code: 'DEVICE_NOT_FOUND',
    });
    assert.deepEqual(await emitAck(friendSocket, 'device:register', {}), {
      ok: false,
      code: 'VALIDATION_ERROR',
    });

    const ownerSocket = await connectSocket(owner);
    assert.deepEqual(await emitAck(ownerSocket, 'device:register', { deviceId: device.id }), {
      ok: true,
    });
  });

  test('owner and active delegates can watch; others get DELEGATION_FORBIDDEN', async () => {
    const device = await registerDevice(owner);
    await delegateDevice(owner, device.id, friend);

    await watch(await connectSocket(owner), device.id);
    await watch(await connectSocket(friend), device.id);
    assert.deepEqual(
      await emitAck(await connectSocket(stranger), 'device:watch', { deviceId: device.id }),
      { ok: false, code: 'DELEGATION_FORBIDDEN' }
    );
  });
});

describe('device:command', () => {
  test('allowed command is relayed to the player with `from`, ack ok', async () => {
    const { device, player } = await onlineDevice();
    await delegateDevice(owner, device.id, friend);
    const remote = await connectSocket(friend);

    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'pause' }),
      { ok: true }
    );
    const cmd = await waitForEvent(player, 'device:command', (p) => p.deviceId === device.id);
    assert.deepEqual(cmd, {
      deviceId: device.id,
      command: 'pause',
      value: null,
      from: { id: friend.id, name: friend.name },
    });

    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'setVolume', value: 40 }),
      { ok: true }
    );
    const vol = await waitForEvent(
      player,
      'device:command',
      (p) => p.deviceId === device.id && p.command === 'setVolume'
    );
    assert.equal(vol.value, 40);

    // The delegate itself does not receive the command.
    assert.equal(received(remote, 'device:command', device.id).length, 0);
  });

  test('the owner may always control their own device', async () => {
    const { device, player } = await onlineDevice();
    const ownerRemote = await connectSocket(owner);
    assert.deepEqual(
      await emitAck(ownerRemote, 'device:command', { deviceId: device.id, command: 'next' }),
      { ok: true }
    );
    await waitForEvent(player, 'device:command', (p) => p.command === 'next');
  });

  test('command without the right is DELEGATION_FORBIDDEN and not relayed', async () => {
    const { device, player } = await onlineDevice();
    await delegateDevice(owner, device.id, friend, { canVolume: false, canSkip: false });
    const remote = await connectSocket(friend);

    for (const payload of [
      { deviceId: device.id, command: 'setVolume', value: 10 },
      { deviceId: device.id, command: 'next' },
      { deviceId: device.id, command: 'previous' },
    ]) {
      assert.deepEqual(await emitAck(remote, 'device:command', payload), {
        ok: false,
        code: 'DELEGATION_FORBIDDEN',
      });
    }
    // play/pause is still allowed.
    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: true }
    );
    await sleep(QUIET_MS);
    assert.deepEqual(
      received(player, 'device:command', device.id).map((r) => r.payload.command),
      ['play']
    );
  });

  test('rights changed by PATCH apply to the next command', async () => {
    const { device } = await onlineDevice();
    await delegateDevice(owner, device.id, friend);
    const remote = await connectSocket(friend);
    const cmd = { deviceId: device.id, command: 'pause' };

    assert.deepEqual(await emitAck(remote, 'device:command', cmd), { ok: true });
    const patch = await api('PATCH', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
      body: { canPlayPause: false },
    });
    assert.equal(patch.status, 200);
    assert.deepEqual(await emitAck(remote, 'device:command', cmd), {
      ok: false,
      code: 'DELEGATION_FORBIDDEN',
    });
  });

  test('revoked mid-session: device:revoked, next command rejected, no further state', async () => {
    const { device, player } = await onlineDevice();
    await delegateDevice(owner, device.id, friend);
    const remote = await connectSocket(friend);
    await watch(remote, device.id);

    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: true }
    );
    assert.deepEqual(
      await emitAck(player, 'device:state', { deviceId: device.id, state: { playing: true } }),
      { ok: true }
    );
    await waitForEvent(remote, 'device:state', (p) => p.deviceId === device.id);

    const res = await api('DELETE', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
    });
    assert.equal(res.status, 204);

    const revoked = await waitForEvent(remote, 'device:revoked', (p) => p.deviceId === device.id);
    assert.deepEqual(revoked, { deviceId: device.id, reason: 'REVOKED' });

    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'pause' }),
      { ok: false, code: 'DELEGATION_FORBIDDEN' }
    );

    const statesBefore = received(remote, 'device:state', device.id).length;
    await emitAck(player, 'device:state', { deviceId: device.id, state: { playing: false } });
    await sleep(QUIET_MS);
    assert.equal(received(remote, 'device:state', device.id).length, statesBefore);
    assert.deepEqual(
      received(player, 'device:command', device.id).map((r) => r.payload.command),
      ['play']
    );

    // Watching again is refused too.
    assert.deepEqual(await emitAck(remote, 'device:watch', { deviceId: device.id }), {
      ok: false,
      code: 'DELEGATION_FORBIDDEN',
    });
  });

  test('blacklisted token (logout): UNAUTHORIZED and the player receives nothing', async () => {
    const { device, player } = await onlineDevice();
    const user = await createUser('loggedout');
    await befriend(owner, user);
    await delegateDevice(owner, device.id, user);
    const remote = await connectSocket(user);
    await blacklistToken(user.token, 60);

    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: false, code: 'UNAUTHORIZED' }
    );
    await sleep(QUIET_MS);
    assert.equal(received(player, 'device:command', device.id).length, 0);
  });

  test('unfriending mid-session (the delegate removes the device owner) revokes with reason UNFRIENDED', async () => {
    const pal = await createUser('pal');
    await befriend(pal, owner);
    const { device, player } = await onlineDevice();
    await delegateDevice(owner, device.id, pal);
    const remote = await connectSocket(pal);
    await watch(remote, device.id);

    const res = await api('DELETE', `/api/friends/${owner.id}`, { token: pal.token });
    assert.equal(res.status, 204);
    assert.deepEqual(
      await waitForEvent(remote, 'device:revoked', (p) => p.deviceId === device.id),
      { deviceId: device.id, reason: 'UNFRIENDED' }
    );
    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: false, code: 'DELEGATION_FORBIDDEN' }
    );
    await emitAck(player, 'device:state', { deviceId: device.id, state: { playing: true } });
    await sleep(QUIET_MS);
    assert.equal(received(remote, 'device:state', device.id).length, 0);
  });

  test('deleting a device does not notify delegates whose delegation was already revoked', async () => {
    const device = await registerDevice(owner);
    await delegateDevice(owner, device.id, friend);
    await api('DELETE', `/api/devices/${device.id}/delegations/${friend.id}`, { token: owner.token });
    const remote = await connectSocket(friend);

    const res = await api('DELETE', `/api/devices/${device.id}`, { token: owner.token });
    assert.equal(res.status, 204);
    await sleep(QUIET_MS);
    assert.equal(received(remote, 'device:revoked', device.id).length, 0);
  });

  test('deleting the device revokes with reason DEVICE_DELETED and evicts its player', async () => {
    const { device, player } = await onlineDevice();
    await delegateDevice(owner, device.id, friend);
    const remote = await connectSocket(friend);
    await watch(remote, device.id);

    const res = await api('DELETE', `/api/devices/${device.id}`, { token: owner.token });
    assert.equal(res.status, 204);
    assert.deepEqual(
      await waitForEvent(remote, 'device:revoked', (p) => p.deviceId === device.id),
      { deviceId: device.id, reason: 'DEVICE_DELETED' }
    );
    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: false, code: 'DEVICE_NOT_FOUND' }
    );
    await sleep(QUIET_MS);
    assert.equal(received(player, 'device:command', device.id).length, 0);
  });

  test('a delegation on device A does not allow commanding device B', async () => {
    const { device: a } = await onlineDevice('A');
    const { device: b, player: playerB } = await onlineDevice('B');
    await delegateDevice(owner, a.id, friend);
    const remote = await connectSocket(friend);

    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: b.id, command: 'play' }),
      { ok: false, code: 'DELEGATION_FORBIDDEN' }
    );
    assert.deepEqual(await emitAck(remote, 'device:watch', { deviceId: b.id }), {
      ok: false,
      code: 'DELEGATION_FORBIDDEN',
    });
    await sleep(QUIET_MS);
    assert.equal(received(playerB, 'device:command', b.id).length, 0);
  });

  test('no player socket registered: DEVICE_OFFLINE', async () => {
    const device = await registerDevice(owner);
    await delegateDevice(owner, device.id, friend);
    const remote = await connectSocket(friend);
    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: false, code: 'DEVICE_OFFLINE' }
    );

    // A player that unregisters puts the device back offline.
    const player = await connectSocket(owner);
    await emitAck(player, 'device:register', { deviceId: device.id });
    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: true }
    );
    assert.deepEqual(await emitAck(player, 'device:unregister', { deviceId: device.id }), {
      ok: true,
    });
    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: false, code: 'DEVICE_OFFLINE' }
    );
  });

  test('invalid commands are VALIDATION_ERROR', async () => {
    const { device } = await onlineDevice();
    const remote = await connectSocket(owner);
    for (const payload of [
      {},
      { deviceId: device.id },
      { deviceId: device.id, command: 'eject' },
      { deviceId: device.id, command: 'toString' },
      { deviceId: device.id, command: 'setVolume' },
      { deviceId: device.id, command: 'setVolume', value: 101 },
      { deviceId: device.id, command: 'setVolume', value: '50' },
    ]) {
      assert.deepEqual(
        await emitAck(remote, 'device:command', payload),
        { ok: false, code: 'VALIDATION_ERROR' },
        JSON.stringify(payload)
      );
    }
  });

  test('more than 10 commands per second on a socket: RATE_LIMITED', async () => {
    const { device, player } = await onlineDevice();
    const remote = await connectSocket(owner);
    const acks = await Promise.all(
      Array.from({ length: 12 }, () =>
        emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' })
      )
    );
    assert.equal(acks.filter((a) => a.ok).length, 10);
    assert.deepEqual(
      acks.filter((a) => !a.ok),
      [
        { ok: false, code: 'RATE_LIMITED' },
        { ok: false, code: 'RATE_LIMITED' },
      ]
    );
    await sleep(QUIET_MS);
    assert.equal(received(player, 'device:command', device.id).length, 10);

    // Another socket has its own budget; the window frees up after a second.
    const other = await connectSocket(owner);
    assert.deepEqual(
      await emitAck(other, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: true }
    );
    await sleep(1000);
    assert.deepEqual(
      await emitAck(remote, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: true }
    );
  });

  test('commands for one device are relayed in arrival order', async () => {
    const { device, player } = await onlineDevice();
    await delegateDevice(owner, device.id, friend);
    const remote = await connectSocket(friend);
    const volumes = [10, 20, 30, 40, 50, 60, 70, 80];
    await Promise.all(
      volumes.map((value) =>
        emitAck(remote, 'device:command', { deviceId: device.id, command: 'setVolume', value })
      )
    );
    await sleep(QUIET_MS);
    assert.deepEqual(
      received(player, 'device:command', device.id).map((r) => r.payload.value),
      volumes
    );
  });
});

describe('device:state', () => {
  test('player state reaches every watcher (owner and delegates)', async () => {
    const { device, player } = await onlineDevice();
    await delegateDevice(owner, device.id, friend);
    const ownerWatcher = await connectSocket(owner);
    const friendWatcher = await connectSocket(friend);
    const notWatching = await connectSocket(friend);
    await watch(ownerWatcher, device.id);
    await watch(friendWatcher, device.id);

    const state = { playing: true, trackId: 't1', volume: 50 };
    assert.deepEqual(await emitAck(player, 'device:state', { deviceId: device.id, state }), {
      ok: true,
    });

    for (const socket of [ownerWatcher, friendWatcher]) {
      const event = await waitForEvent(socket, 'device:state', (p) => p.deviceId === device.id);
      assert.deepEqual(event.state, state);
      assert.ok(event.at);
    }
    await sleep(QUIET_MS);
    assert.equal(received(notWatching, 'device:state', device.id).length, 0);

    // Unwatching stops the stream.
    assert.deepEqual(await emitAck(friendWatcher, 'device:unwatch', { deviceId: device.id }), {
      ok: true,
    });
    await emitAck(player, 'device:state', { deviceId: device.id, state: { playing: false } });
    await waitForEvent(ownerWatcher, 'device:state', (p) => p.state.playing === false);
    await sleep(QUIET_MS);
    assert.equal(received(friendWatcher, 'device:state', device.id).length, 1);
  });

  test('an owner socket that is not the registered player is DEVICE_FORBIDDEN', async () => {
    const { device } = await onlineDevice();
    const watcher = await connectSocket(owner);
    await watch(watcher, device.id);
    const notPlayer = await connectSocket(owner);

    assert.deepEqual(
      await emitAck(notPlayer, 'device:state', { deviceId: device.id, state: { playing: true } }),
      { ok: false, code: 'DEVICE_FORBIDDEN' }
    );
    // A player of another device cannot publish for this one either.
    const { player: otherPlayer } = await onlineDevice('Autre');
    assert.deepEqual(
      await emitAck(otherPlayer, 'device:state', { deviceId: device.id, state: { playing: true } }),
      { ok: false, code: 'DEVICE_FORBIDDEN' }
    );
    await sleep(QUIET_MS);
    assert.equal(received(watcher, 'device:state', device.id).length, 0);
  });

  test('player with a blacklisted token is UNAUTHORIZED', async () => {
    const solo = await createUser('solo');
    const device = await registerDevice(solo);
    const player = await connectSocket(solo);
    assert.deepEqual(await emitAck(player, 'device:register', { deviceId: device.id }), { ok: true });
    const watcher = await connectSocket(solo);
    await watch(watcher, device.id);
    await blacklistToken(solo.token, 60);

    assert.deepEqual(
      await emitAck(player, 'device:state', { deviceId: device.id, state: { playing: true } }),
      { ok: false, code: 'UNAUTHORIZED' }
    );
    await sleep(QUIET_MS);
    assert.equal(received(watcher, 'device:state', device.id).length, 0);
  });

  test('more than 10 states per second on a socket: RATE_LIMITED', async () => {
    const { device, player } = await onlineDevice();
    const acks = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        emitAck(player, 'device:state', { deviceId: device.id, state: { i } })
      )
    );
    assert.equal(acks.filter((a) => a.ok).length, 10);
    assert.equal(acks.filter((a) => a.code === 'RATE_LIMITED').length, 2);
    // Commands keep their own budget.
    assert.deepEqual(
      await emitAck(player, 'device:command', { deviceId: device.id, command: 'play' }),
      { ok: true }
    );
  });

  test('non-owner emitter is rejected and nothing is broadcast', async () => {
    const { device } = await onlineDevice();
    await delegateDevice(owner, device.id, friend);
    const watcher = await connectSocket(owner);
    await watch(watcher, device.id);
    const friendSocket = await connectSocket(friend);

    assert.deepEqual(
      await emitAck(friendSocket, 'device:state', { deviceId: device.id, state: { playing: true } }),
      { ok: false, code: 'DEVICE_FORBIDDEN' }
    );
    assert.deepEqual(
      await emitAck(friendSocket, 'device:state', { deviceId: device.id, state: 'nope' }),
      { ok: false, code: 'VALIDATION_ERROR' }
    );
    assert.deepEqual(
      await emitAck(watcher, 'device:state', {
        deviceId: device.id,
        state: { blob: 'x'.repeat(9000) },
      }),
      { ok: false, code: 'VALIDATION_ERROR' }
    );
    await sleep(QUIET_MS);
    assert.equal(received(watcher, 'device:state', device.id).length, 0);
  });
});

describe('delegation:updated', () => {
  test('the delegate is told about a grant and about rights changes', async () => {
    const device = await registerDevice(owner);
    const delegateSocket = await connectSocket(friend);
    const strangerSocket = await connectSocket(stranger);

    await delegateDevice(owner, device.id, friend, { canVolume: false });
    assert.deepEqual(
      await waitForEvent(delegateSocket, 'delegation:updated', (p) => p.deviceId === device.id),
      {
        deviceId: device.id,
        rights: { canPlayPause: true, canSkip: true, canVolume: false },
        active: true,
      }
    );

    const patch = await api('PATCH', `/api/devices/${device.id}/delegations/${friend.id}`, {
      token: owner.token,
      body: { canSkip: false },
    });
    assert.equal(patch.status, 200);
    assert.deepEqual(
      await waitForEvent(
        delegateSocket,
        'delegation:updated',
        (p) => p.deviceId === device.id && p.rights.canSkip === false
      ),
      {
        deviceId: device.id,
        rights: { canPlayPause: true, canSkip: false, canVolume: false },
        active: true,
      }
    );

    // Revocation sends device:revoked, not delegation:updated.
    await api('DELETE', `/api/devices/${device.id}/delegations/${friend.id}`, { token: owner.token });
    await waitForEvent(delegateSocket, 'device:revoked', (p) => p.deviceId === device.id);
    await sleep(QUIET_MS);
    assert.equal(received(delegateSocket, 'delegation:updated', device.id).length, 2);
    assert.equal(received(strangerSocket, 'delegation:updated', device.id).length, 0);
  });
});

describe('two instances sharing Redis', { skip: redisUp ? false : 'Redis unreachable' }, () => {
  test('command from instance B reaches a player on A; revocation on A evicts a watcher on B', async () => {
    const b = await startExtraInstance();
    try {
      const { device, player } = await onlineDevice();
      await delegateDevice(owner, device.id, friend);
      const remote = await connectSocket(friend, { url: b.url });
      await watch(remote, device.id);

      assert.deepEqual(
        await emitAck(remote, 'device:command', { deviceId: device.id, command: 'pause' }),
        { ok: true }
      );
      await waitForEvent(player, 'device:command', (p) => p.deviceId === device.id);

      await emitAck(player, 'device:state', { deviceId: device.id, state: { playing: false } });
      await waitForEvent(remote, 'device:state', (p) => p.deviceId === device.id);

      await api('DELETE', `/api/devices/${device.id}/delegations/${friend.id}`, {
        token: owner.token,
      });
      await waitForEvent(remote, 'device:revoked', (p) => p.deviceId === device.id);
      await emitAck(player, 'device:state', { deviceId: device.id, state: { playing: true } });
      await sleep(QUIET_MS);
      assert.equal(received(remote, 'device:state', device.id).length, 1);
    } finally {
      await b.close();
    }
  });
});
