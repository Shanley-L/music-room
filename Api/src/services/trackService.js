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

  const existing = await prisma.track.findUnique({
    where: { roomId_externalId: { roomId, externalId } },
  });

  if (existing) {
    return { error: 'Ce titre est déjà dans la file', status: 409 };
  }

  const count = await prisma.track.count({ where: { roomId } });

  const track = await prisma.track.create({
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

  return { track };
}

async function reorderQueue(roomId) {
  const tracks = await prisma.track.findMany({
    where: { roomId },
    orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  await prisma.$transaction(
    tracks.map((track, index) =>
      prisma.track.update({
        where: { id: track.id },
        data: { position: index + 1 },
      })
    )
  );

  return prisma.track.findMany({
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

  const alreadyVoted = await prisma.vote.findUnique({
    where: { trackId_userId: { trackId, userId } },
  });

  if (alreadyVoted) {
    const queue = await reorderQueue(roomId);
    return { track, queue, alreadyVoted: true };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.track.findUnique({ where: { id: trackId } });

    const result = await tx.track.updateMany({
      where: { id: trackId, version: current.version },
      data: { voteCount: { increment: 1 }, version: { increment: 1 } },
    });

    if (result.count === 0) {
      throw new Error('CONFLICT');
    }

    await tx.vote.create({ data: { trackId, userId } });

    return tx.track.findUnique({ where: { id: trackId } });
  });

  const queue = await reorderQueue(roomId);

  return { track: updated, queue };
}

export async function deleteTrack(roomId, trackId, userId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) return { error: 'Salle introuvable', status: 404 };
  if (room.ownerId !== userId) return { error: "Seul l'organisateur peut supprimer un titre", status: 403 };

  const track = await prisma.track.findFirst({ where: { id: trackId, roomId } });

  if (!track) return { error: 'Titre introuvable', status: 404 };

  await prisma.track.delete({ where: { id: trackId } });

  const queue = await reorderQueue(roomId);

  return { queue };
}

export async function removeVote(roomId, trackId, userId) {
  const track = await prisma.track.findFirst({ where: { id: trackId, roomId } });

  if (!track) return { error: 'Titre introuvable', status: 404 };

  const vote = await prisma.vote.findUnique({
    where: { trackId_userId: { trackId, userId } },
  });

  if (!vote) return { error: 'Vous n\'avez pas voté pour ce titre', status: 404 };

  await prisma.$transaction(async (tx) => {
    await tx.vote.delete({ where: { trackId_userId: { trackId, userId } } });
    await tx.track.update({
      where: { id: trackId },
      data: { voteCount: { decrement: 1 }, version: { increment: 1 } },
    });
  });

  const queue = await reorderQueue(roomId);

  return { queue };
}
