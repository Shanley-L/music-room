import { z } from 'zod';
import {
  getTracksForRoom,
  suggestTrack,
  voteForTrack,
  removeVote,
  deleteTrack,
} from '../services/trackService.js';
import { getRoomById, isUserAllowedInRoom, canVote } from '../services/roomService.js';
import { emitToRoom, emitRoomQueue } from '../lib/realtime.js';

const suggestSchema = z.object({
  externalId: z
    .union([z.string(), z.number()], { error: 'externalId, title et artist sont requis' })
    .transform((v) => String(v).trim())
    .pipe(z.string().min(1, 'externalId, title et artist sont requis')),
  title: z.string().trim().min(1, 'externalId, title et artist sont requis'),
  artist: z.string().trim().min(1, 'externalId, title et artist sont requis'),
  album: z.string().optional().nullable(),
  preview: z.string().optional().nullable(),
  duration: z.number().int().nonnegative().max(2147483647).optional().nullable(),
});

const positionSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (p) => (p.latitude === undefined) === (p.longitude === undefined),
    { message: 'latitude et longitude doivent être fournies ensemble' }
  );

function sendServiceError(res, result) {
  return res.status(result.status).json({ error: result.error, code: result.code });
}

/** Realtime: `vote:changed` with the count committed by this write, then the fresh queue. */
function broadcastVote(roomId, trackId, queue) {
  const track = queue.find((t) => t.id === trackId);
  if (track) emitToRoom(roomId, 'vote:changed', { roomId, trackId, voteCount: track.voteCount });
  emitRoomQueue(roomId);
}

async function checkRoomAccess(req, res) {
  const room = await getRoomById(req.params.roomId);

  if (!room) {
    res.status(404).json({ error: 'Salle introuvable', code: 'ROOM_NOT_FOUND' });
    return null;
  }

  const allowed = await isUserAllowedInRoom(room, req.user.id);

  if (!allowed) {
    res.status(403).json({ error: 'Accès refusé à cette salle', code: 'ROOM_FORBIDDEN' });
    return null;
  }

  return room;
}

export async function listTracks(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  const tracks = await getTracksForRoom(req.params.roomId);
  return res.json(tracks);
}

export async function suggest(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  const parsed = suggestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message || 'Entrée invalide', code: 'VALIDATION_ERROR' });
  }

  const result = await suggestTrack(req.params.roomId, req.user.id, parsed.data);

  if (result.error) return sendServiceError(res, result);

  const { roomId } = req.params;
  emitToRoom(roomId, 'track:suggested', { roomId, track: result.track });
  emitRoomQueue(roomId);

  return res.status(201).json(result.track);
}

export async function vote(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  const parsed = positionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message || 'Entrée invalide', code: 'VALIDATION_ERROR' });
  }

  const allowed = await canVote(room, req.user.id, parsed.data);
  if (!allowed.ok) return sendServiceError(res, allowed);

  const result = await voteForTrack(req.params.roomId, req.params.trackId, req.user.id);

  if (result.error) return sendServiceError(res, result);

  broadcastVote(req.params.roomId, req.params.trackId, result.queue);

  return res.json({ track: result.track, queue: result.queue });
}

export async function unvote(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  const result = await removeVote(req.params.roomId, req.params.trackId, req.user.id);

  if (result.error) return sendServiceError(res, result);

  broadcastVote(req.params.roomId, req.params.trackId, result.queue);

  return res.json({ queue: result.queue });
}

export async function remove(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res
      .status(403)
      .json({ error: 'Seul le propriétaire peut supprimer un titre', code: 'NOT_ROOM_OWNER' });
  }

  const result = await deleteTrack(req.params.roomId, req.params.trackId);

  if (result.error) return sendServiceError(res, result);

  const { roomId, trackId } = req.params;
  emitToRoom(roomId, 'track:removed', { roomId, trackId });
  emitRoomQueue(roomId);

  return res.json({ queue: result.queue });
}
