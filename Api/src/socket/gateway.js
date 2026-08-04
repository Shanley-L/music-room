import { getRoomById, isUserAllowedInRoom } from '../services/roomService.js';
import { roomChannel } from './emit.js';

function resolveUserId(socket) {
  const fromAuth = socket.handshake.auth?.userId;
  if (fromAuth) return String(fromAuth);

  const fromHeader = socket.handshake.headers['x-dev-user-id'];
  if (fromHeader) return String(fromHeader);

  return null;
}

function extractRoomId(payload) {
  const roomId = payload?.roomId;
  return typeof roomId === 'string' && roomId.length > 0 ? roomId : null;
}

export function registerGateway(io) {
  io.use((socket, next) => {
    const userId = resolveUserId(socket);

    if (!userId) {
      return next(new Error('Non authentifié'));
    }

    socket.data.userId = userId;
    return next();
  });

  io.on('connection', (socket) => {
    socket.on('room:join', async (payload) => {
      const roomId = extractRoomId(payload);

      if (!roomId) {
        socket.emit('room:error', { code: 'BAD_REQUEST', message: 'roomId est requis' });
        return;
      }

      try {
        const room = await getRoomById(roomId);

        if (!room) {
          socket.emit('room:error', { code: 'NOT_FOUND', message: 'Salle introuvable' });
          return;
        }

        const allowed = await isUserAllowedInRoom(room, socket.data.userId);

        if (!allowed) {
          socket.emit('room:error', { code: 'FORBIDDEN', message: 'Accès refusé à cette salle' });
          return;
        }

        await socket.join(roomChannel(roomId));
        socket.emit('room:joined', { roomId });
      } catch (err) {
        console.error('room:join failed', err);
        socket.emit('room:error', { code: 'INTERNAL', message: 'Erreur serveur' });
      }
    });

    socket.on('room:leave', async (payload) => {
      const roomId = extractRoomId(payload);
      if (!roomId) return;

      try {
        await socket.leave(roomChannel(roomId));
      } catch (err) {
        console.error('room:leave failed', err);
      }
    });
  });
}
