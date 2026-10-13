import prisma from '../lib/prisma.js';

// Interactive transactions queue behind a per-room advisory lock, so allow
// enough time for a burst of concurrent votes on the same room to drain.
const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

class ServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isUniqueViolation(err) {
  return (
    err?.code === 'P2002' ||
    err?.cause?.code === '23505' ||
    /Unique constraint failed/i.test(err?.message || '')
  );
}

/**
 * Runs `fn` in a transaction serialized per room with a Postgres advisory lock.
 * ServiceErrors thrown inside roll the transaction back and are returned as
 * `{ error, code, status }`.
 */
async function withRoomLock(roomId, fn) {
  try {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}))`;
        return fn(tx);
      }, TX_OPTIONS);
    } catch (err) {
      // P2028: transaction could not start in time or exceeded its timeout
      if (err?.code === 'P2028') {
        throw new ServiceError(503, 'ROOM_BUSY', 'Salle occupée, réessayez');
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof ServiceError) {
      return { error: err.message, code: err.code, status: err.status };
    }
    throw err;
  }
}

function queueQuery(client, roomId) {
  return client.track.findMany({
    where: { roomId },
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
 * Recomputes positions (votes desc, then oldest first) in a single statement.
 * Must be called inside a transaction holding the room lock.
 */
async function reorderQueue(tx, roomId) {
  await tx.$executeRaw`
    UPDATE "Track" AS t
    SET "position" = r.rn
    FROM (
      SELECT "id",
             ROW_NUMBER() OVER (ORDER BY "voteCount" DESC, "createdAt" ASC, "id" ASC) AS rn
      FROM "Track"
      WHERE "roomId" = ${roomId}
    ) AS r
    WHERE t."id" = r."id" AND t."position" IS DISTINCT FROM r.rn`;

  return queueQuery(tx, roomId);
}

async function findTrackOrThrow(tx, roomId, trackId) {
  const track = await tx.track.findFirst({ where: { id: trackId, roomId } });
  if (!track) throw new ServiceError(404, 'TRACK_NOT_FOUND', 'Titre introuvable');
  return track;
}

export async function suggestTrack(roomId, userId, trackData) {
  const { externalId, title, artist, album, preview, duration } = trackData;

  return withRoomLock(roomId, async (tx) => {
    const existing = await tx.track.findUnique({
      where: { roomId_externalId: { roomId, externalId } },
    });

    if (existing) {
      throw new ServiceError(409, 'TRACK_ALREADY_IN_QUEUE', 'Ce titre est déjà dans la file');
    }

    const count = await tx.track.count({ where: { roomId } });

    const created = await tx.track.create({
      data: {
        roomId,
        externalId,
        title,
        artist,
        album,
        preview,
        duration,
        position: count + 1,
        suggestedBy: userId,
      },
    });

    await reorderQueue(tx, roomId);

    const track = await tx.track.findUnique({ where: { id: created.id } });
    return { track };
  });
}

export async function voteForTrack(roomId, trackId, userId) {
  return withRoomLock(roomId, async (tx) => {
    await findTrackOrThrow(tx, roomId, trackId);

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
    await findTrackOrThrow(tx, roomId, trackId);

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
    await findTrackOrThrow(tx, roomId, trackId);

    await tx.track.delete({ where: { id: trackId } });

    const queue = await reorderQueue(tx, roomId);

    return { queue };
  });
}
