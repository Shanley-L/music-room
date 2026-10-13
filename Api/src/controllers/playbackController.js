import { z } from 'zod';
import { getRoomById, isUserAllowedInRoom } from '../services/roomService.js';
import * as playback from '../services/playbackService.js';
import { emitRoomPlayback, emitRoomQueue } from '../lib/realtime.js';

const endedSchema = z.object({
  trackId: z
    .string({ error: 'trackId est requis' })
    .trim()
    .min(1, 'trackId est requis')
    .max(64, 'trackId invalide'),
});

async function checkRoomAccess(req, res) {
  const room = await getRoomById(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'Salle introuvable', code: 'ROOM_NOT_FOUND' });
    return null;
  }
  if (!(await isUserAllowedInRoom(room, req.user.id))) {
    res.status(403).json({ error: 'Accès refusé à cette salle', code: 'ROOM_FORBIDDEN' });
    return null;
  }
  return room;
}

function reply(res, roomId, result) {
  if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
  if (result.changed) {
    // Promotions change the queue (the head leaves it) as well as the playback state.
    emitRoomPlayback(roomId);
    emitRoomQueue(roomId);
  }
  return res.json(result.state);
}

export async function getState(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;
  return res.json(await playback.getPlaybackState(req.params.roomId));
}

/** Owner-only transitions: the service checks ownership under the room lock. */
function control(action) {
  return async (req, res) => {
    const room = await checkRoomAccess(req, res);
    if (!room) return;
    const { roomId } = req.params;
    return reply(res, roomId, await playback[action](roomId, req.user.id));
  };
}

export const play = control('play');
export const pause = control('pause');
export const resume = control('resume');
export const skip = control('skip');

export async function ended(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;
  const parsed = endedSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message || 'Entrée invalide', code: 'VALIDATION_ERROR' });
  }
  const { roomId } = req.params;
  return reply(res, roomId, await playback.ended(roomId, parsed.data.trackId));
}
