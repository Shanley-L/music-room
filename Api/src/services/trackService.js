import prisma from '../lib/prisma.js';

export async function getTracksForRoom(roomId) {
  return prisma.track.findMany({
    where: { roomId },
    orderBy: [{ position: 'asc' }],
    include: { _count: { select: { votes: true } } },
  });
}

export async function suggestTrack(roomId, userId, trackData) {
  const { externalId, title, artist, album, preview, duration } = trackData;

  if (!externalId || !title || !artist) {
    return { error: 'externalId, title et artist sont requis', status: 400 };
  }

  try {
    const track = await prisma.$transaction(async (tx) => {
      const existing = await tx.track.findUnique({
        where: { roomId_externalId: { roomId, externalId: String(externalId) } },
      });

      if (existing) {
        const err = new Error('DUPLICATE_TRACK');
        throw err;
      }

      const count = await tx.track.count({ where: { roomId } });

      return tx.track.create({
        data: {
          roomId,
          externalId: String(externalId),
          title,
          artist,
          album,
          preview,
          duration,
          position: count + 1,
          suggestedBy: userId,
        },
      });
    });

    return { track };
  } catch (err) {
    if (err.message === 'DUPLICATE_TRACK' || err.code === 'P2002') {
      return { error: 'Ce titre est déjà dans la file', status: 409 };
    }
    throw err;
  }
}

async function reorderQueue(tx, roomId) {
  const tracks = await tx.track.findMany({
    where: { roomId },
    orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }],
  });

  for (let index = 0; index < tracks.length; index += 1) {
    await tx.track.update({
      where: { id: tracks[index].id },
      data: { position: index + 1 },
    });
  }

  return tx.track.findMany({
    where: { roomId },
    orderBy: { position: 'asc' },
    include: { _count: { select: { votes: true } } },
  });
}

export async function voteForTrack(roomId, trackId, userId) {
  const track = await prisma.track.findFirst({
    where: { id: trackId, roomId },
  });

  if (!track) return { error: 'Titre introuvable', status: 404 };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const alreadyVoted = await tx.vote.findUnique({
        where: { trackId_userId: { trackId, userId } },
      });

      if (alreadyVoted) {
        throw new Error('ALREADY_VOTED');
      }

      const current = await tx.track.findUnique({ where: { id: trackId } });

      if (!current) {
        throw new Error('NOT_FOUND');
      }

      const updatedRows = await tx.track.updateMany({
        where: { id: trackId, version: current.version },
        data: { voteCount: { increment: 1 }, version: { increment: 1 } },
      });

      if (updatedRows.count === 0) {
        throw new Error('CONFLICT');
      }

      await tx.vote.create({ data: { trackId, userId } });

      const updated = await tx.track.findUnique({ where: { id: trackId } });
      const queue = await reorderQueue(tx, roomId);

      return { track: updated, queue };
    });

    return result;
  } catch (err) {
    if (err.message === 'ALREADY_VOTED') {
      return { error: 'Vous avez déjà voté pour ce titre', status: 409 };
    }
    if (err.message === 'NOT_FOUND') {
      return { error: 'Titre introuvable', status: 404 };
    }
    if (err.message === 'CONFLICT' || err.code === 'P2002') {
      throw new Error('CONFLICT');
    }
    throw err;
  }
}

export async function removeVote(roomId, trackId, userId) {
  const track = await prisma.track.findFirst({ where: { id: trackId, roomId } });

  if (!track) return { error: 'Titre introuvable', status: 404 };

  try {
    const queue = await prisma.$transaction(async (tx) => {
      const vote = await tx.vote.findUnique({
        where: { trackId_userId: { trackId, userId } },
      });

      if (!vote) {
        throw new Error('NO_VOTE');
      }

      const current = await tx.track.findUnique({ where: { id: trackId } });

      if (!current) {
        throw new Error('NOT_FOUND');
      }

      await tx.vote.delete({ where: { trackId_userId: { trackId, userId } } });

      const updatedRows = await tx.track.updateMany({
        where: { id: trackId, version: current.version },
        data: { voteCount: { decrement: 1 }, version: { increment: 1 } },
      });

      if (updatedRows.count === 0) {
        throw new Error('CONFLICT');
      }

      return reorderQueue(tx, roomId);
    });

    return { queue };
  } catch (err) {
    if (err.message === 'NO_VOTE') {
      return { error: 'Vous n\'avez pas voté pour ce titre', status: 404 };
    }
    if (err.message === 'NOT_FOUND') {
      return { error: 'Titre introuvable', status: 404 };
    }
    if (err.message === 'CONFLICT') {
      throw new Error('CONFLICT');
    }
    throw err;
  }
}
