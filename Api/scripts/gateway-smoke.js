import { io as createClient } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';

function authHeaders(userId) {
  return { 'Content-Type': 'application/json', 'X-Dev-User-Id': userId };
}

async function createRoom(userId, body) {
  const response = await fetch(`${API_URL}/api/rooms`, {
    method: 'POST',
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`create room failed: ${response.status}`);
  }

  return response.json();
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);

    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function connectSocket(userId) {
  return createClient(API_URL, { auth: { userId }, transports: ['websocket'] });
}

async function expectConnectError() {
  const socket = createClient(API_URL, { auth: {}, transports: ['websocket'] });

  await new Promise((resolve, reject) => {
    socket.on('connect', () => reject(new Error('expected connect_error, got connect')));
    socket.on('connect_error', () => resolve());
  });

  socket.close();
}

async function expectRoomError(userId, payload, expectedCode) {
  const socket = connectSocket(userId);

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });

  const errorPromise = waitForEvent(socket, 'room:error');
  socket.emit('room:join', payload);
  const error = await errorPromise;

  if (error.code !== expectedCode) {
    throw new Error(`expected ${expectedCode}, got ${error.code}`);
  }

  socket.close();
}

async function expectJoinSucceeds(userId, roomId) {
  const socket = connectSocket(userId);

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });

  const joined = waitForEvent(socket, 'room:joined');
  socket.emit('room:join', { roomId });
  await joined;

  socket.close();
}

async function main() {
  await expectConnectError();
  await expectRoomError('alice', {}, 'BAD_REQUEST');
  await expectRoomError('alice', { roomId: 'does-not-exist' }, 'NOT_FOUND');
  await expectRoomError('alice', { roomId: 42 }, 'BAD_REQUEST');

  const privateRoom = await createRoom('alice', {
    name: `Gateway private ${Date.now()}`,
    visibility: 'PRIVATE',
  });

  await expectRoomError('mallory', { roomId: privateRoom.id }, 'FORBIDDEN');
  await expectJoinSucceeds('alice', privateRoom.id);

  console.log('gateway-smoke OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('gateway-smoke FAILED', err.message);
  process.exit(1);
});
