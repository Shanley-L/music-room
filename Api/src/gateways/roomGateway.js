import { getRoomById, isUserAllowedInRoom } from '../services/roomService.js';
import { getRoomSnapshot } from '../services/trackService.js';

export function registerRoomGateway(io) {
  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    const { platform, device, appVersion } = socket.meta ?? {};

    console.log(
      `[socket] connect user=${userId} platform=${platform ?? 'n/a'} device=${device ?? 'n/a'} appVersion=${appVersion ?? 'n/a'}`
    );

    socket.on('room:join', async (payload, callback) => {
      const roomId = payload?.roomId;

      try {
        if (typeof roomId !== 'string' || !roomId.trim()) {
          return callback?.({ error: 'roomId est requis', status: 400 });
        }

        const room = await getRoomById(roomId.trim());

        if (!room) {
          return callback?.({ error: 'Salle introuvable', status: 404 });
        }

        const allowed = await isUserAllowedInRoom(room, userId);

        if (!allowed) {
          console.log(
            `[socket] join denied user=${userId} room=${room.id} platform=${platform ?? 'n/a'} device=${device ?? 'n/a'} appVersion=${appVersion ?? 'n/a'}`
          );
          return callback?.({ error: 'Accès refusé à cette salle', status: 403 });
        }

        socket.join(`room:${room.id}`);

        const state = await getRoomSnapshot(room.id);

        if (!state) {
          return callback?.({ error: 'Salle introuvable', status: 404 });
        }

        socket.emit('room:state', state);

        console.log(
          `[socket] join user=${userId} room=${room.id} platform=${platform ?? 'n/a'} device=${device ?? 'n/a'} appVersion=${appVersion ?? 'n/a'}`
        );

        return callback?.({ ok: true, roomId: room.id });
      } catch (err) {
        console.error('[socket] room:join error:', err);
        return callback?.({ error: 'Erreur serveur', status: 500 });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket] disconnect user=${userId}`);
    });
  });
}