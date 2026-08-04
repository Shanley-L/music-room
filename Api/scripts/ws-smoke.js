import { io as createClient } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const USER_ID = process.env.WS_USER_ID || 'alice';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Dev-User-Id': USER_ID,
  };
}

async function createRoom() {
  const response = await fetch(`${API_URL}/api/rooms`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: `WS test ${Date.now()}`, visibility: 'PUBLIC' }),
  });

  if (!response.ok) {
    throw new Error(`create room failed: ${response.status}`);
  }

  return response.json();
}

async function suggestTrack(roomId) {
  const response = await fetch(`${API_URL}/api/rooms/${roomId}/tracks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      externalId: `ws-${Date.now()}`,
      title: 'WS Track',
      artist: 'Tester',
    }),
  });

  if (!response.ok) {
    throw new Error(`suggest failed: ${response.status}`);
  }

  return response.json();
}

async function voteTrack(roomId, trackId) {
  const response = await fetch(`${API_URL}/api/rooms/${roomId}/tracks/${trackId}/vote`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'X-Dev-User-Id': 'bob',
    },
  });

  if (!response.ok) {
    throw new Error(`vote failed: ${response.status}`);
  }

  return response.json();
}

function waitForEvent(socket, event, timeoutMs = 8000) {
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

async function main() {
  const room = await createRoom();
  const roomId = room.id;

  const socket = createClient(API_URL, {
    auth: { userId: 'bob' },
    transports: ['websocket'],
  });

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });

  const joined = waitForEvent(socket, 'room:joined');
  socket.emit('room:join', { roomId });
  await joined;

  const trackAdded = waitForEvent(socket, 'track:added');
  const queueAfterSuggest = waitForEvent(socket, 'queue:updated');
  const track = await suggestTrack(roomId);
  const addedPayload = await trackAdded;
  await queueAfterSuggest;

  if (addedPayload.track?.id !== track.id) {
    throw new Error('track:added payload mismatch');
  }

  const queueUpdated = waitForEvent(socket, 'queue:updated');
  await voteTrack(roomId, track.id);
  const queuePayload = await queueUpdated;

  if (!Array.isArray(queuePayload.queue) || queuePayload.roomId !== roomId) {
    throw new Error('queue:updated payload invalid');
  }

  console.log('api-test-ws OK', {
    roomId,
    trackId: track.id,
    queueLength: queuePayload.queue.length,
  });

  socket.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('api-test-ws FAILED', err.message);
  process.exit(1);
});
