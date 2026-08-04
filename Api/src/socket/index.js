import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { setIo } from './emit.js';
import { registerGateway } from './gateway.js';
import { resolveCorsOrigin, toSocketIoOrigin } from '../config/cors.js';

export async function createIo(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: toSocketIoOrigin(resolveCorsOrigin()),
      methods: ['GET', 'POST'],
    },
  });

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_URL is required for Socket.IO Redis adapter');
  }

  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => console.error('Redis pub error', err.message));
  subClient.on('error', (err) => console.error('Redis sub error', err.message));

  await Promise.all([pubClient.connect(), subClient.connect()]);

  io.adapter(createAdapter(pubClient, subClient));

  setIo(io);
  registerGateway(io);

  return io;
}
