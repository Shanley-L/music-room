import prisma from '../lib/prisma.js';

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateLicenseOptions(license, geoOptions) {
  if (license !== 'GEO_TIME_RESTRICTED') return { valid: true };

  const { latitude, longitude, radiusM, voteStartAt, voteEndAt } = geoOptions;

  if (!voteStartAt || !voteEndAt) {
    return { valid: false, error: 'voteStartAt et voteEndAt sont requis pour cette licence' };
  }

  if (new Date(voteStartAt) >= new Date(voteEndAt)) {
    return { valid: false, error: 'voteStartAt doit être avant voteEndAt' };
  }

  const hasGeo = latitude != null || longitude != null || radiusM != null;

  if (hasGeo) {
    if (latitude == null || longitude == null || radiusM == null) {
      return { valid: false, error: 'latitude, longitude et radiusM sont requis ensemble' };
    }
    if (radiusM <= 0) {
      return { valid: false, error: 'radiusM doit être positif' };
    }
  }

  return { valid: true };
}

export async function canUserVote(room, userId, geoHeaders) {
  if (room.license === 'EVERYONE') return { allowed: true };

  if (room.license === 'INVITED_ONLY') {
    if (room.ownerId === userId) return { allowed: true };

    const invite = await prisma.roomInvite.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    });

    if (!invite) return { allowed: false, reason: 'Réservé aux invités' };

    return { allowed: true };
  }

  if (room.license === 'GEO_TIME_RESTRICTED') {
    const now = new Date();

    if (room.voteStartAt && now < new Date(room.voteStartAt)) {
      return { allowed: false, reason: 'Le vote n\'a pas encore commencé' };
    }

    if (room.voteEndAt && now > new Date(room.voteEndAt)) {
      return { allowed: false, reason: 'Le vote est terminé' };
    }

    if (room.latitude != null && room.longitude != null && room.radiusM != null) {
      const userLat = parseFloat(geoHeaders?.lat);
      const userLng = parseFloat(geoHeaders?.lng);

      if (Number.isNaN(userLat) || Number.isNaN(userLng)) {
        return { allowed: false, reason: 'Coordonnées requises pour voter (X-Dev-Lat, X-Dev-Lng)' };
      }

      const distance = haversineDistance(room.latitude, room.longitude, userLat, userLng);

      if (distance > room.radiusM) {
        return { allowed: false, reason: 'Vous n\'êtes pas dans la zone autorisée' };
      }
    }

    return { allowed: true };
  }

  return { allowed: false, reason: 'Licence inconnue' };
}
