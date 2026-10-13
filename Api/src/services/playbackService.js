import prisma from '../lib/prisma.js';
import { ServiceError, withRoomLock } from '../lib/roomLock.js';
import { reorderQueue } from './trackService.js';

/** Preview clips last about 30 s; also the default when a track has no duration. */
export const DEFAULT_DURATION_MS = 30000;
/** `ended` is accepted this long before the nominal end (client clock / buffering). */
export const END_TOLERANCE_MS = 2000;

/** Playable length of a track: its duration (seconds), capped at the 30 s preview. */
export function trackDurationMs(track) {
  if (!track || !Number.isFinite(track.duration) || track.duration <= 0) return DEFAULT_DURATION_MS;
  return Math.min(track.duration * 1000, DEFAULT_DURATION_MS);
}

function currentPositionMs(room, track, now) {
  if (room.playbackStatus === 'PAUSED') return room.pausedPositionMs;
  if (room.playbackStatus !== 'PLAYING' || !room.playbackStartedAt) return 0;
  const elapsed = now.getTime() - new Date(room.playbackStartedAt).getTime();
  return Math.min(Math.max(elapsed, 0), trackDurationMs(track));
}

/**
 * Public playback payload (same for everybody, safe to broadcast). `serverTime` lets
 * clients correct their clock skew: expected position = now + skew - startedAt.
 */
export function buildPlaybackState(room, track, now = new Date()) {
  const playing = room.playbackStatus !== 'IDLE' && track;
  return {
    roomId: room.id,
    status: room.playbackStatus,
    currentTrack: playing ? { ...track, durationMs: trackDurationMs(track) } : null,
    startedAt:
      room.playbackStatus === 'PLAYING' && room.playbackStartedAt
        ? new Date(room.playbackStartedAt).toISOString()
        : null,
    positionMs: playing ? currentPositionMs(room, track, now) : 0,
    serverTime: now.toISOString(),
  };
}

async function loadState(client, roomId) {
  const room = await client.room.findUnique({ where: { id: roomId } });
  if (!room) return null;
  const track = room.currentTrackId
    ? await client.track.findUnique({ where: { id: room.currentTrackId } })
    : null;
  return buildPlaybackState(room, track);
}

/** Current playback state of a room, or null when the room does not exist. */
export function getPlaybackState(roomId) {
  return loadState(prisma, roomId);
}

/** Promotes the top QUEUED track (votes desc, oldest first) or goes IDLE. */
async function startHead(tx, roomId, now) {
  const head = await tx.track.findFirst({
    where: { roomId, status: 'QUEUED' },
    orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  if (!head) {
    await tx.room.update({
      where: { id: roomId },
      data: {
        playbackStatus: 'IDLE',
        currentTrackId: null,
        playbackStartedAt: null,
        pausedPositionMs: 0,
      },
    });
    return false;
  }

  await tx.track.update({ where: { id: head.id }, data: { status: 'PLAYING', position: 0 } });
  await tx.room.update({
    where: { id: roomId },
    data: {
      playbackStatus: 'PLAYING',
      currentTrackId: head.id,
      playbackStartedAt: now,
      pausedPositionMs: 0,
    },
  });
  await reorderQueue(tx, roomId);
  return true;
}

async function finishCurrent(tx, room) {
  if (!room.currentTrackId) return;
  await tx.track.updateMany({
    where: { id: room.currentTrackId, status: 'PLAYING' },
    data: { status: 'PLAYED', position: 0 },
  });
}

/**
 * Runs `transition(tx, room, now)` under the room lock on a fresh read of the room
 * and returns `{ state, changed }`. Transitions return true when they changed something.
 */
async function transact(roomId, transition) {
  return withRoomLock(roomId, async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room) throw new ServiceError(404, 'ROOM_NOT_FOUND', 'Salle introuvable');
    const now = new Date();
    const changed = await transition(tx, room, now);
    return { state: await loadState(tx, roomId), changed: !!changed };
  });
}

function requireOwner(room, userId) {
  if (room.ownerId !== userId) {
    throw new ServiceError(403, 'NOT_ROOM_OWNER', 'Seul le propriétaire peut contrôler la lecture');
  }
}

export function play(roomId, userId) {
  return transact(roomId, async (tx, room, now) => {
    requireOwner(room, userId);
    if (room.playbackStatus === 'PLAYING') return false;
    if (room.playbackStatus === 'PAUSED') return resumeRoom(tx, room, now);
    const started = await startHead(tx, roomId, now);
    if (!started) {
      throw new ServiceError(409, 'NOTHING_TO_PLAY', 'Aucun titre dans la file d\'attente');
    }
    return true;
  });
}

async function resumeRoom(tx, room, now) {
  await tx.room.update({
    where: { id: room.id },
    data: {
      playbackStatus: 'PLAYING',
      playbackStartedAt: new Date(now.getTime() - room.pausedPositionMs),
      pausedPositionMs: 0,
    },
  });
  return true;
}

export function pause(roomId, userId) {
  return transact(roomId, async (tx, room, now) => {
    requireOwner(room, userId);
    if (room.playbackStatus === 'PAUSED') return false;
    if (room.playbackStatus === 'IDLE') {
      throw new ServiceError(409, 'NOTHING_PLAYING', 'Aucun titre en cours de lecture');
    }
    const track = await tx.track.findUnique({ where: { id: room.currentTrackId } });
    await tx.room.update({
      where: { id: roomId },
      data: {
        playbackStatus: 'PAUSED',
        pausedPositionMs: currentPositionMs(room, track, now),
        playbackStartedAt: null,
      },
    });
    return true;
  });
}

export function resume(roomId, userId) {
  return transact(roomId, async (tx, room, now) => {
    requireOwner(room, userId);
    if (room.playbackStatus === 'PLAYING') return false;
    if (room.playbackStatus === 'IDLE') {
      throw new ServiceError(409, 'NOTHING_PLAYING', 'Aucun titre en cours de lecture');
    }
    return resumeRoom(tx, room, now);
  });
}

export function skip(roomId, userId) {
  return transact(roomId, async (tx, room, now) => {
    requireOwner(room, userId);
    if (room.playbackStatus === 'IDLE') return false;
    await finishCurrent(tx, room);
    await startHead(tx, roomId, now);
    return true;
  });
}

/**
 * A client reports that `trackId` finished. Accepted only for the current track once
 * (almost) its whole duration elapsed; anything else is a no-op that returns the state.
 */
export function ended(roomId, trackId) {
  return transact(roomId, async (tx, room, now) => {
    if (room.playbackStatus !== 'PLAYING' || room.currentTrackId !== trackId) return false;
    const track = await tx.track.findUnique({ where: { id: trackId } });
    const elapsed = now.getTime() - new Date(room.playbackStartedAt).getTime();
    if (elapsed < trackDurationMs(track) - END_TOLERANCE_MS) return false;
    await finishCurrent(tx, room);
    await startHead(tx, roomId, now);
    return true;
  });
}

/**
 * Live chain: when the room is idle and a track is suggested, it starts right away
 * so the room never sits silent. No-op when something is already playing or paused.
 */
export function autoStartIfIdle(roomId) {
  return transact(roomId, async (tx, room, now) => {
    if (room.playbackStatus !== 'IDLE') return false;
    return startHead(tx, roomId, now);
  });
}
