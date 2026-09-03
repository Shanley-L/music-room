import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';

const ROOM_A = 'room-a-id';
const ROOM_B = 'room-b-id';

const rooms = {
  [ROOM_A]: { id: ROOM_A, visibility: 'PRIVATE', ownerId: 'owner-a' },
  [ROOM_B]: { id: ROOM_B, visibility: 'PRIVATE', ownerId: 'owner-b' },
};

const roomMemberships = {
  [ROOM_A]: ['user-a', 'owner-a'],
  [ROOM_B]: ['user-b', 'owner-b'],
};

mock.module('../src/services/roomService.js', {
  namedExports: {
    getRoomById: async (roomId) => rooms[roomId] ?? null,
    isUserAllowedInRoom: async (room, userId) =>
      roomMemberships[room.id]?.includes(userId) ?? false,
  },
});

mock.module('../src/services/trackService.js', {
  namedExports: {
    getRoomSnapshot: async (roomId) => ({
      queue: [],
      topTrack: null,
      nowPlayingBy: rooms[roomId]?.ownerId ?? null,
      isClosed: false,
    }),
  },
});

const { registerRoomGateway } = await import('../src/gateways/roomGateway.js');
const { socketAuthMiddleware } = await import('../src/middleware/auth.js');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test('isolation inter-salles : un client de B ne rejoint pas room:<A> et ne reçoit rien de A (AC #5)', async (t) => {
  const httpServer = createServer();
  const io = new Server(httpServer);
  io.use(socketAuthMiddleware);
  registerRoomGateway(io);

  const url = await listen(httpServer);

  const clientA = ioc(url, { auth: { 'x-dev-user-id': 'user-a' } });
  const clientB = ioc(url, { auth: { 'x-dev-user-id': 'user-b' } });

  t.after(() => {
    clientA.disconnect();
    clientB.disconnect();
    io.close();
    httpServer.close();
  });

  await waitForConnect(clientA);
  await waitForConnect(clientB);

  // clientA rejoint sa salle A
  const ackA = await emitAck(clientA, 'room:join', { roomId: ROOM_A });
  assert.deepEqual(ackA, { ok: true, roomId: ROOM_A });

  // clientB (de la salle B) tente de rejoindre A → refus (403), pas de join
  const receivedByB = [];
  clientB.on('room:state', (state) => receivedByB.push(state));

  const ackBA = await emitAck(clientB, 'room:join', { roomId: ROOM_A });
  assert.deepEqual(ackBA, { error: 'Accès refusé à cette salle', status: 403 });

  // clientB rejoint sa propre salle B → ok
  const ackB = await emitAck(clientB, 'room:join', { roomId: ROOM_B });
  assert.deepEqual(ackB, { ok: true, roomId: ROOM_B });

  // le join de B émet un room:state légitime pour SA salle — on purge avant le broadcast de A
  receivedByB.length = 0;

  // Émission sur le canal de A (broadcast via la gateway, comme après une mutation)
  io.to(`room:${ROOM_A}`).emit('room:state', { from: ROOM_A });

  // petite latence pour laisser les événements transiter
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(receivedByB.length, 0, 'client B ne doit recevoir aucun événement de A');
});