import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

const REDIS_CONNECT_TIMEOUT = 3000;

let io = null;

async function pingRedis(client) {
  return Promise.race([
    client.ping(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Redis timeout')), REDIS_CONNECT_TIMEOUT)
    ),
  ]);
}

export async function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*' },
  });

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  let pubClient = null;
  let subClient = null;

  try {
    pubClient = new Redis(redisUrl, {
      connectTimeout: REDIS_CONNECT_TIMEOUT,
      maxRetriesPerRequest: 1,
    });
    subClient = pubClient.duplicate();

    pubClient.on('error', (err) => {
      console.warn('[socket] Redis pub client error:', err.message);
    });
    subClient.on('error', (err) => {
      console.warn('[socket] Redis sub client error:', err.message);
    });

    await pingRedis(subClient);
    await pingRedis(pubClient);

    io.adapter(createAdapter(pubClient, subClient));
    console.log('[socket] Adapter Redis Pub/Sub attaché');
  } catch (err) {
    if (pubClient) pubClient.disconnect();
    if (subClient) subClient.disconnect();
    console.warn(
      `[socket] Redis indisponible (${err.message}) — repli broadcast in-memory par instance (AD-10)`
    );
  }

  return io;
}

export function getIO() {
  if (!io) throw new Error('Socket.IO non initialisé');
  return io;
}