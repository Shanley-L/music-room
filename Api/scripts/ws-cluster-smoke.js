import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { io as createClient } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const WORKER_PORT = process.env.WORKER_PORT || 3999;
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;

function authHeaders(userId) {
  return { 'Content-Type': 'application/json', 'X-Dev-User-Id': userId };
}

async function createRoom() {
  const response = await fetch(`${API_URL}/api/rooms`, {
    method: 'POST',
    headers: authHeaders('alice'),
    body: JSON.stringify({ name: `Cluster test ${Date.now()}`, visibility: 'PUBLIC' }),
  });

  if (!response.ok) throw new Error(`create room failed: ${response.status}`);
  return response.json();
}

async function suggestTrack(roomId) {
  const response = await fetch(`${API_URL}/api/rooms/${roomId}/tracks`, {
    method: 'POST',
    headers: authHeaders('alice'),
    body: JSON.stringify({
      externalId: `cluster-${Date.now()}`,
      title: 'Cluster Track',
      artist: 'Tester',
    }),
  });

  if (!response.ok) throw new Error(`suggest failed: ${response.status}`);
  return response.json();
}

async function voteTrack(roomId, trackId) {
  const response = await fetch(`${API_URL}/api/rooms/${roomId}/tracks/${trackId}/vote`, {
    method: 'POST',
    headers: authHeaders('bob'),
  });

  if (!response.ok) throw new Error(`vote failed: ${response.status}`);
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

function startWorker() {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(__dirname, 'ws-cluster-worker.js'), {
      env: { ...process.env, WORKER_PORT },
    });

    const timer = setTimeout(() => {
      reject(new Error('worker did not become ready in time'));
    }, 10000);

    worker.on('message', (msg) => {
      if (msg?.type === 'ready') {
        clearTimeout(timer);
        resolve(worker);
      }
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code && code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

async function main() {
  const room = await createRoom();
  const track = await suggestTrack(room.id);

  const worker = await startWorker();

  try {
    const socket = createClient(WORKER_URL, { auth: { userId: 'bob' }, transports: ['websocket'] });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });

    const joined = waitForEvent(socket, 'room:joined');
    socket.emit('room:join', { roomId: room.id });
    await joined;

    const queueUpdated = waitForEvent(socket, 'queue:updated');
    await voteTrack(room.id, track.id);
    const payload = await queueUpdated;

    if (payload.roomId !== room.id || !Array.isArray(payload.queue)) {
      throw new Error('cross-instance queue:updated payload invalid');
    }

    console.log('ws-cluster-smoke OK — event delivered across instances via Redis adapter', {
      roomId: room.id,
      queueLength: payload.queue.length,
    });

    socket.close();
  } finally {
    worker.kill();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('ws-cluster-smoke FAILED', err.message);
  process.exit(1);
});
