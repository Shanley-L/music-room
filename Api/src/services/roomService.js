import prisma from '../lib/prisma.js';
import { normalizeInviteCode, withFreshInviteCode } from '../lib/inviteCode.js';

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
  const data = {
    name,
    visibility: visibility ?? 'PUBLIC',
    license: license ?? 'EVERYONE',
    inviteCode: null,
    ownerId,
    ...geoOptions,
  };

  if (data.visibility !== 'PRIVATE') return prisma.room.create({ data });
  return withFreshInviteCode((inviteCode) => prisma.room.create({ data: { ...data, inviteCode } }));
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
  const code = normalizeInviteCode(inviteCode);
  const room = code ? await prisma.room.findUnique({ where: { inviteCode: code } }) : null;

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

/**
 * Owner only: replaces the invite code of a private room. The previous code stops
 * working immediately; users who already joined keep their invitation.
 */
export async function regenerateInviteCode(roomId, ownerId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) return { error: 'Salle introuvable', code: 'ROOM_NOT_FOUND', status: 404 };
  if (room.ownerId !== ownerId) {
    return { error: 'Accès refusé', code: 'NOT_ROOM_OWNER', status: 403 };
  }
  if (room.visibility !== 'PRIVATE') {
    return {
      error: 'Seules les salles privées ont un code d\'invitation',
      code: 'ROOM_NOT_PRIVATE',
      status: 409,
    };
  }

  try {
    const updated = await withFreshInviteCode((inviteCode) =>
      prisma.room.update({ where: { id: roomId }, data: { inviteCode }, select: { inviteCode: true } })
    );
    return { inviteCode: updated.inviteCode };
  } catch (err) {
    // Deleted between the ownership check and the update.
    if (err?.code === 'P2025') return { error: 'Salle introuvable', code: 'ROOM_NOT_FOUND', status: 404 };
    throw err;
  }
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

/** OWNER, INVITED (has an invitation) or MEMBER (public room, not invited). */
export async function getRoomRole(room, userId) {
  if (room.ownerId === userId) return 'OWNER';
  return (await isInvited(room, userId)) ? 'INVITED' : 'MEMBER';
}

/**
 * Role and permissions of `userId` in a room they can access. Computed without a
 * position: when the license needs one (geo zone), `canVote` stays true and
 * `voteRequiresLocation` tells the client to send its position with the vote.
 * `voteBlockedReason` is a French message when voting is (or may be) blocked.
 */
export async function describeAccess(room, userId) {
  const myRole = await getRoomRole(room, userId);
  const owner = myRole === 'OWNER';
  const vote = await canVote(room, userId, null);

  const needsLocation = !vote.ok && vote.code === 'LOCATION_REQUIRED';
  return {
    myRole,
    permissions: {
      canVote: vote.ok || needsLocation,
      voteRequiresLocation: needsLocation,
      voteBlockedReason: vote.ok ? null : vote.error,
      voteBlockedCode: vote.ok ? null : vote.code,
      canSuggest: true,
      canControlPlayback: owner,
      canManageRoom: owner,
      canInvite: owner,
      canRemoveTrack: owner,
    },
  };
}

/**
 * Owner only: updates name, visibility, license and geo/time settings. `changes`
 * holds the already validated fields; the result is checked against the merged room.
 * Going private creates an invite code, going public drops it.
 */
export async function updateRoom(roomId, ownerId, changes) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) return { error: 'Salle introuvable', code: 'ROOM_NOT_FOUND', status: 404 };
  if (room.ownerId !== ownerId) {
    return { error: 'Accès refusé', code: 'NOT_ROOM_OWNER', status: 403 };
  }

  const merged = { ...room, ...changes };

  if (!!(merged.latitude != null) !== !!(merged.longitude != null) ||
      !!(merged.latitude != null) !== !!(merged.radiusM != null)) {
    return {
      error: 'latitude, longitude et radiusM doivent être fournis ensemble',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  if (merged.voteStartAt && merged.voteEndAt && merged.voteStartAt >= merged.voteEndAt) {
    return { error: 'voteStartAt doit précéder voteEndAt', code: 'VALIDATION_ERROR', status: 400 };
  }
  if (merged.license === 'GEO_TIME_RESTRICTED' && !hasZone(merged) && !hasWindow(merged)) {
    return {
      error: 'Une zone (latitude, longitude, radiusM) ou une plage horaire (voteStartAt, voteEndAt) est requise pour la licence GEO_TIME_RESTRICTED',
      code: 'GEO_CONFIG_REQUIRED',
      status: 400,
    };
  }

  const data = { ...changes };
  try {
    if (merged.visibility === 'PUBLIC') {
      data.inviteCode = null;
      return { room: await prisma.room.update({ where: { id: roomId }, data }) };
    }
    if (room.inviteCode) {
      return { room: await prisma.room.update({ where: { id: roomId }, data }) };
    }
    return {
      room: await withFreshInviteCode((inviteCode) =>
        prisma.room.update({ where: { id: roomId }, data: { ...data, inviteCode } })
      ),
    };
  } catch (err) {
    if (err?.code === 'P2025') return { error: 'Salle introuvable', code: 'ROOM_NOT_FOUND', status: 404 };
    throw err;
  }
}

/** Fields safe to broadcast to every room subscriber (no invite code, no invitees). */
export function publicRoomFields(room) {
  const { inviteCode, invites, ...rest } = room;
  return rest;
}
