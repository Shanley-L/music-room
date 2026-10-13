import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
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
} from './helpers.js';

// Nothing listens on port 1: the Redis adapter cannot connect, so Socket.IO must
// fall back to the in-memory adapter and keep working.
const unreachable = new Redis('redis://127.0.0.1:1', {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
unreachable.on('error', () => {});

let owner;

before(async () => {
  await resetDb();
  await startServer({ realtime: { redisClient: unreachable } });
  owner = await createUser('owner');
});

after(async () => {
  unreachable.disconnect();
  await stopServer();
});

test('sockets connect, join and receive events without Redis', async () => {
  const room = await createRoom(owner, { name: 'Sans Redis' });
  const socket = await connectSocket(owner);
  assert.equal((await emitAck(socket, 'room:join', { roomId: room.id })).ok, true);

  const track = await suggestTrack(owner, room.id);
  const vote = await api('POST', `/api/rooms/${room.id}/tracks/${track.id}/vote`, {
    token: owner.token,
  });
  assert.equal(vote.status, 200);

  const changed = await waitForEvent(socket, 'vote:changed');
  assert.deepEqual(changed, { roomId: room.id, trackId: track.id, voteCount: 1 });
  await waitForEvent(socket, 'queue:updated', (p) => p.queue[0]?.voteCount === 1);
});
