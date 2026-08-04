import { randomBytes } from 'crypto';
import prisma from '../lib/prisma.js';

function generateInviteCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

function sanitizeRoomForUser(room, userId) {
  if (!room) return null;

  const allowed =
    room.visibility === 'PUBLIC' ||
    room.ownerId === userId ||
    room.invites?.some((invite) => invite.userId === userId);

  if (!allowed) return null;

  const { inviteCode, invites, ...safe } = room;

  if (room.ownerId === userId) {
    return { ...safe, inviteCode, invites };
  }

  return { ...safe, invites };
}

export async function createRoom({ name, visibility, license, ownerId, geoOptions }) {
  const resolvedVisibility = visibility ?? 'PUBLIC';
  const inviteCode = resolvedVisibility === 'PRIVATE' ? generateInviteCode() : null;

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: {
        name,
        visibility: resolvedVisibility,
        license: license ?? 'EVERYONE',
        inviteCode,
        ownerId,
        ...geoOptions,
      },
    });

    await tx.roomInvite.create({
      data: { roomId: room.id, userId: ownerId },
    });

    return room;
  });
}

export async function listPublicRooms() {
  return prisma.room.findMany({
    where: { visibility: 'PUBLIC' },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { tracks: true } } },
  });
}

export async function getRoomById(id) {
  return prisma.room.findUnique({
    where: { id },
    include: {
      invites: true,
      _count: { select: { tracks: true } },
    },
  });
}

export async function getRoomForUser(id, userId) {
  const room = await getRoomById(id);
  return sanitizeRoomForUser(room, userId);
}

export async function joinRoomByCode(inviteCode, userId) {
  const room = await prisma.room.findUnique({ where: { inviteCode } });

  if (!room || room.visibility !== 'PRIVATE') {
    return { error: 'Code invalide', status: 404 };
  }

  try {
    await prisma.roomInvite.create({ data: { roomId: room.id, userId } });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
  }

  return { room };
}

export async function inviteUser(roomId, ownerId, userId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) return { error: 'Salle introuvable', status: 404 };
  if (room.ownerId !== ownerId) return { error: 'Accès refusé', status: 403 };

  const invite = await prisma.roomInvite.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: { roomId, userId },
    update: {},
  });

  return { invite };
}

export async function isUserAllowedInRoom(room, userId) {
  if (room.visibility === 'PUBLIC') return true;

  if (room.ownerId === userId) return true;

  const invite = await prisma.roomInvite.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });

  return !!invite;
}
