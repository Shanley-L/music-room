import {
  getTracksForRoom,
  suggestTrack,
  voteForTrack,
  removeVote,
  deleteTrack,
} from '../services/trackService.js';
import { getRoomById, isUserAllowedInRoom } from '../services/roomService.js';

async function checkRoomAccess(req, res) {
  const room = await getRoomById(req.params.roomId);

  if (!room) {
    res.status(404).json({ error: 'Salle introuvable' });
    return null;
  }

  const allowed = await isUserAllowedInRoom(room, req.user.id);

  if (!allowed) {
    res.status(403).json({ error: 'Accès refusé à cette salle' });
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

  const result = await suggestTrack(req.params.roomId, req.user.id, req.body);

  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.status(201).json(result.track);
}

export async function vote(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  try {
    const result = await voteForTrack(req.params.roomId, req.params.trackId, req.user.id);

    if (result.error) return res.status(result.status).json({ error: result.error });

    return res.json({ track: result.track, queue: result.queue });
  } catch (err) {
    if (err.message === 'CONFLICT') {
      return res.status(409).json({ error: 'Conflit de vote, réessayez' });
    }
    throw err;
  }
}

export async function remove(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Seul l'organisateur peut supprimer un titre" });
  }

  const result = await deleteTrack(req.params.roomId, req.params.trackId, req.user.id);

  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.json({ queue: result.queue });
}

export async function unvote(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  const result = await removeVote(req.params.roomId, req.params.trackId, req.user.id);

  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.json({ queue: result.queue });
}
