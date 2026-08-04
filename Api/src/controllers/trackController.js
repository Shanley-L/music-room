import {
  getTracksForRoom,
  suggestTrack,
  voteForTrack,
  removeVote,
} from '../services/trackService.js';
import { getRoomById, isUserAllowedInRoom } from '../services/roomService.js';
import { canUserVote } from '../services/licenseService.js';
import { emitToRoom } from '../socket/emit.js';

function getGeoHeaders(req) {
  return {
    lat: req.headers['x-dev-lat'],
    lng: req.headers['x-dev-lng'],
  };
}

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

async function checkVotePermission(req, res, room) {
  const voteCheck = await canUserVote(room, req.user.id, getGeoHeaders(req));

  if (!voteCheck.allowed) {
    res.status(403).json({ error: voteCheck.reason });
    return false;
  }

  return true;
}

function safeEmit(roomId, event, payload) {
  try {
    emitToRoom(roomId, event, payload);
  } catch (err) {
    console.error(`Broadcast ${event} failed`, err);
  }
}

async function broadcastSuggest(roomId, track) {
  safeEmit(roomId, 'track:added', { roomId, track });

  try {
    const queue = await getTracksForRoom(roomId);
    safeEmit(roomId, 'queue:updated', { roomId, queue });
  } catch (err) {
    console.error('Broadcast queue:updated failed', err);
  }
}

function broadcastVote(roomId, userId, result) {
  safeEmit(roomId, 'vote:added', {
    roomId,
    trackId: result.track.id,
    userId,
    voteCount: result.track.voteCount,
  });
  safeEmit(roomId, 'queue:updated', { roomId, queue: result.queue });
}

function broadcastUnvote(roomId, result) {
  safeEmit(roomId, 'queue:updated', { roomId, queue: result.queue });
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

  await broadcastSuggest(req.params.roomId, result.track);

  return res.status(201).json(result.track);
}

export async function vote(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  if (!(await checkVotePermission(req, res, room))) return;

  let result;

  try {
    result = await voteForTrack(req.params.roomId, req.params.trackId, req.user.id);
  } catch (err) {
    if (err.message === 'CONFLICT') {
      return res.status(409).json({ error: 'Conflit de vote, réessayez' });
    }
    throw err;
  }

  if (result.error) return res.status(result.status).json({ error: result.error });

  broadcastVote(req.params.roomId, req.user.id, result);

  return res.json({ track: result.track, queue: result.queue });
}

export async function unvote(req, res) {
  const room = await checkRoomAccess(req, res);
  if (!room) return;

  if (!(await checkVotePermission(req, res, room))) return;

  let result;

  try {
    result = await removeVote(req.params.roomId, req.params.trackId, req.user.id);
  } catch (err) {
    if (err.message === 'CONFLICT') {
      return res.status(409).json({ error: 'Conflit de vote, réessayez' });
    }
    throw err;
  }

  if (result.error) return res.status(result.status).json({ error: result.error });

  broadcastUnvote(req.params.roomId, result);

  return res.json({ queue: result.queue });
}
