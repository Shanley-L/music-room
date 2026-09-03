import { randomBytes } from 'crypto';
import prisma from '../lib/prisma.js';

function generateInviteCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function createRoom({ name, visibility, license, ownerId, geoOptions }) {
  const { latitude, longitude, radiusM } = geoOptions ?? {};

  if (license === 'GEO_RESTRICTED') {
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return {
        error: 'Zone requise pour la licence GEO_RESTRICTED (latitude dans [-90, 90] et longitude dans [-180, 180] numériques)',
        status: 400,
      };
    }

    if (radiusM != null && (!Number.isInteger(radiusM) || radiusM <= 0)) {
      return {
        error: 'radiusM doit être un entier strictement positif pour la licence GEO_RESTRICTED',
        status: 400,
      };
    }
  }

  const inviteCode = visibility === 'PRIVATE' ? generateInviteCode() : null;
  const data = {
    name,
    visibility: visibility ?? 'PUBLIC',
    license: license ?? 'EVERYONE',
    inviteCode,
    ownerId,
    nowPlayingBy: ownerId,
    ...geoOptions,
  };

  if (data.license === 'GEO_RESTRICTED' && data.radiusM == null) {
    data.radiusM = 100;
  }

  return prisma.room.create({ data });
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

export async function joinRoomById(roomId, userId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) {
    return { error: 'Salle introuvable', status: 404 };
  }

  if (room.visibility === 'PRIVATE') {
    return { error: "Salle privée : rejoignez avec le code d'invitation", status: 403 };
  }

  await prisma.roomInvite.upsert({
    where: { roomId_userId: { roomId: room.id, userId } },
    create: { roomId: room.id, userId },
    update: {},
  });

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
