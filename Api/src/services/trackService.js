import prisma from '../lib/prisma.js';
import { ServiceError, isUniqueViolation, withRoomLock } from '../lib/roomLock.js';

function queueQuery(client, roomId) {
  return client.track.findMany({
    where: { roomId, status: 'QUEUED' },
    orderBy: [{ position: 'asc' }],
    include: { _count: { select: { votes: true } } },
  });
}

/**
 * Adds `hasVoted` (did `userId` vote for this track?) to each track. Per user:
 * never used for socket broadcasts, which are shared by every client of a room.
 */
async function withHasVoted(client, tracks, userId) {
  if (tracks.length === 0) return tracks;
  const votes = await client.vote.findMany({
    where: { userId, trackId: { in: tracks.map((t) => t.id) } },
    select: { trackId: true },
  });
  const voted = new Set(votes.map((v) => v.trackId));
  return tracks.map((t) => ({ ...t, hasVoted: voted.has(t.id) }));
}

/**
 * Room queue ordered by position. With `userId`, each track carries `hasVoted`
 * for that user (REST responses); without it, the shared payload of `queue:updated`.
 */
export async function getTracksForRoom(roomId, userId) {
  const queue = await queueQuery(prisma, roomId);
  return userId ? withHasVoted(prisma, queue, userId) : queue;
}

/**
 * Recomputes positions of the QUEUED tracks (votes desc, then oldest first) in a
 * single statement; the playing and played tracks get position 0.
 * Must be called inside a transaction holding the room lock.
 */
export async function reorderQueue(tx, roomId) {
  await tx.$executeRaw`
    UPDATE "Track" AS t
    SET "position" = COALESCE(r.rn, 0)
    FROM "Track" AS t2
    LEFT JOIN (
      SELECT "id",
             ROW_NUMBER() OVER (ORDER BY "voteCount" DESC, "createdAt" ASC, "id" ASC) AS rn
      FROM "Track"
      WHERE "roomId" = ${roomId} AND "status" = 'QUEUED'
    ) AS r ON r."id" = t2."id"
    WHERE t."id" = t2."id" AND t."roomId" = ${roomId}
      AND t."position" IS DISTINCT FROM COALESCE(r.rn, 0)`;

  return queueQuery(tx, roomId);
}

async function findTrackOrThrow(tx, roomId, trackId, { queuedOnly = false } = {}) {
  const track = await tx.track.findFirst({ where: { id: trackId, roomId } });
  if (!track) throw new ServiceError(404, 'TRACK_NOT_FOUND', 'Titre introuvable');
  if (queuedOnly && track.status !== 'QUEUED') {
    throw new ServiceError(409, 'TRACK_NOT_QUEUED', 'Ce titre n\'est plus dans la file d\'attente');
  }
  return track;
}

export async function suggestTrack(roomId, userId, trackData) {
  const { externalId, title, artist, album, preview, coverUrl, duration } = trackData;

  return withRoomLock(roomId, async (tx) => {
    const existing = await tx.track.findUnique({
      where: { roomId_externalId: { roomId, externalId } },
    });

    if (existing && existing.status !== 'PLAYED') {
      throw new ServiceError(
        409,
        'TRACK_ALREADY_IN_QUEUE',
        existing.status === 'PLAYING'
          ? 'Ce titre est en cours de lecture'
          : 'Ce titre est déjà dans la file'
      );
    }

    const count = await tx.track.count({ where: { roomId, status: 'QUEUED' } });

    let created;
    if (existing) {
      // A track that was already played can be suggested again: fresh votes, fresh turn.
      await tx.vote.deleteMany({ where: { trackId: existing.id } });
      created = await tx.track.update({
        where: { id: existing.id },
        data: {
          status: 'QUEUED',
          voteCount: 0,
          version: { increment: 1 },
          position: count + 1,
          suggestedBy: userId,
          createdAt: new Date(),
          title,
          artist,
          album,
          preview,
          coverUrl,
          duration,
        },
      });
    } else {
      created = await tx.track.create({
        data: {
          roomId,
          externalId,
          title,
          artist,
          album,
          preview,
          coverUrl,
          duration,
          position: count + 1,
          suggestedBy: userId,
        },
      });
    }

    await reorderQueue(tx, roomId);

    const track = await tx.track.findUnique({ where: { id: created.id } });
    return { track };
  });
}

export async function voteForTrack(roomId, trackId, userId) {
  return withRoomLock(roomId, async (tx) => {
    await findTrackOrThrow(tx, roomId, trackId, { queuedOnly: true });

    try {
      await tx.vote.create({ data: { trackId, userId } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ServiceError(409, 'ALREADY_VOTED', 'Vous avez déjà voté pour ce titre');
      }
      throw err;
    }

    await tx.track.update({
      where: { id: trackId },
      data: { voteCount: { increment: 1 } },
    });

    const queue = await withHasVoted(tx, await reorderQueue(tx, roomId), userId);
    const track = queue.find((t) => t.id === trackId);

    return { track, queue };
  });
}

export async function removeVote(roomId, trackId, userId) {
  return withRoomLock(roomId, async (tx) => {
    await findTrackOrThrow(tx, roomId, trackId, { queuedOnly: true });

    const { count } = await tx.vote.deleteMany({ where: { trackId, userId } });

    if (count === 0) {
      throw new ServiceError(404, 'VOTE_NOT_FOUND', 'Vous n\'avez pas voté pour ce titre');
    }

    await tx.track.update({
      where: { id: trackId },
      data: { voteCount: { decrement: 1 } },
    });

    const queue = await withHasVoted(tx, await reorderQueue(tx, roomId), userId);

    return { queue };
  });
}

export async function deleteTrack(roomId, trackId) {
  return withRoomLock(roomId, async (tx) => {
    const track = await findTrackOrThrow(tx, roomId, trackId);
    if (track.status === 'PLAYING') {
      throw new ServiceError(
        409,
        'TRACK_PLAYING',
        'Ce titre est en cours de lecture, passez-le avec « skip »'
      );
    }

    await tx.track.delete({ where: { id: trackId } });

    const queue = await reorderQueue(tx, roomId);

    return { queue };
  });
}
