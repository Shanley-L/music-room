import { randomBytes } from 'crypto';
import prisma from '../lib/prisma.js';

function generateInviteCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters between two lat/lng points (haversine). */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** True when the room defines a complete vote zone (center + radius). */
export function hasZone(room) {
  return room.latitude != null && room.longitude != null && room.radiusM != null;
}

/** True when the room defines at least one bound of a vote time window. */
export function hasWindow(room) {
  return room.voteStartAt != null || room.voteEndAt != null;
}

/**
 * Removes owner-only fields (inviteCode, invites) unless the viewer owns the room.
 */
export function sanitizeRoomForUser(room, userId) {
  if (!room) return room;
  if (room.ownerId === userId) return room;
  const { inviteCode, invites, ...rest } = room;
  return rest;
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
    omit: { inviteCode: true },
    include: { _count: { select: { tracks: true } } },
  });
}

/** Rooms the user owns or has been invited to (owner-only fields stripped for the rest). */
export async function listRoomsForUser(userId) {
  const rooms = await prisma.room.findMany({
    where: {
      OR: [{ ownerId: userId }, { invites: { some: { userId } } }],
    },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { tracks: true } } },
  });

  return rooms.map((room) => sanitizeRoomForUser(room, userId));
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
    return { error: 'Code invalide', code: 'INVALID_INVITE_CODE', status: 404 };
  }

  await prisma.roomInvite.upsert({
    where: { roomId_userId: { roomId: room.id, userId } },
    create: { roomId: room.id, userId },
    update: {},
  });

  return { room: sanitizeRoomForUser(room, userId) };
}

export async function inviteUser(roomId, ownerId, userId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) return { error: 'Salle introuvable', code: 'ROOM_NOT_FOUND', status: 404 };
  if (room.ownerId !== ownerId) {
    return { error: 'Accès refusé', code: 'NOT_ROOM_OWNER', status: 403 };
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { error: 'Utilisateur introuvable', code: 'USER_NOT_FOUND', status: 404 };

  const invite = await prisma.roomInvite.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: { roomId, userId },
    update: {},
  });

  return { invite };
}

export async function removeInvite(roomId, ownerId, userId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) return { error: 'Salle introuvable', code: 'ROOM_NOT_FOUND', status: 404 };
  if (room.ownerId !== ownerId) {
    return { error: 'Accès refusé', code: 'NOT_ROOM_OWNER', status: 403 };
  }

  const { count } = await prisma.roomInvite.deleteMany({ where: { roomId, userId } });

  if (count === 0) {
    return { error: 'Invitation introuvable', code: 'INVITE_NOT_FOUND', status: 404 };
  }

  return { ok: true };
}

export async function deleteRoom(roomId, ownerId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) return { error: 'Salle introuvable', code: 'ROOM_NOT_FOUND', status: 404 };
  if (room.ownerId !== ownerId) {
    return { error: 'Accès refusé', code: 'NOT_ROOM_OWNER', status: 403 };
  }

  await prisma.room.delete({ where: { id: roomId } });

  return { ok: true };
}

async function isInvited(room, userId) {
  if (Array.isArray(room.invites)) {
    return room.invites.some((invite) => invite.userId === userId);
  }

  const invite = await prisma.roomInvite.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });

  return !!invite;
}

/** Visibility check: public rooms are open to everyone, private ones to owner and invitees. */
export async function isUserAllowedInRoom(room, userId) {
  if (room.visibility === 'PUBLIC') return true;

  if (room.ownerId === userId) return true;

  return isInvited(room, userId);
}

/**
 * License check for voting. Assumes room access was already granted.
 * `position` is `{ latitude, longitude }` or null/undefined.
 * Returns `{ ok: true }` or `{ error, code, status }`.
 */
export async function canVote(room, userId, position, now = new Date()) {
  if (room.license === 'INVITED_ONLY') {
    if (room.ownerId === userId) return { ok: true };
    if (await isInvited(room, userId)) return { ok: true };
    return {
      error: 'Seuls les invités peuvent voter dans cette salle',
      code: 'NOT_INVITED',
      status: 403,
    };
  }

  if (room.license === 'GEO_TIME_RESTRICTED') {
    if (hasWindow(room)) {
      const t = now.getTime();
      const beforeStart = room.voteStartAt != null && t < new Date(room.voteStartAt).getTime();
      const afterEnd = room.voteEndAt != null && t > new Date(room.voteEndAt).getTime();
      if (beforeStart || afterEnd) {
        return {
          error: 'Le vote n\'est pas ouvert à cette heure',
          code: 'OUT_OF_TIME_WINDOW',
          status: 403,
        };
      }
    }

    if (hasZone(room)) {
      const lat = position?.latitude;
      const lng = position?.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return {
          error: 'Votre position (latitude, longitude) est requise pour voter',
          code: 'LOCATION_REQUIRED',
          status: 400,
        };
      }

      const distance = haversineMeters(room.latitude, room.longitude, lat, lng);
      if (distance > room.radiusM) {
        return {
          error: 'Vous êtes hors de la zone de vote',
          code: 'OUT_OF_ZONE',
          status: 403,
        };
      }
    }
  }

  return { ok: true };
}
