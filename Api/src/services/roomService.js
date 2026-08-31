import { randomBytes } from 'crypto';
import prisma from '../lib/prisma.js';

function generateInviteCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function createRoom({ name, visibility, license, ownerId, geoOptions }) {
  const inviteCode = visibility === 'PRIVATE' ? generateInviteCode() : null;

  return prisma.room.create({
    data: {
      name,
      visibility: visibility ?? 'PUBLIC',
      license: license ?? 'EVERYONE',
      inviteCode,
      ownerId,
      ...geoOptions,
    },
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

export async function joinRoomByCode(inviteCode, userId) {
  const room = await prisma.room.findUnique({ where: { inviteCode } });

  if (!room) {
    return { error: 'Code invalide', status: 404 };
  }

  const alreadyIn = await prisma.roomInvite.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });

  if (!alreadyIn) {
    await prisma.roomInvite.create({ data: { roomId: room.id, userId } });
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
