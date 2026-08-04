import prisma from '../lib/prisma.js';

export const VALID_LICENSES = ['EVERYONE', 'INVITED_ONLY', 'GEO_TIME_RESTRICTED'];
export const VALID_VISIBILITIES = ['PUBLIC', 'PRIVATE'];

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

function isValidDate(value) {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export function validateLicenseOptions(license, geoOptions) {
  if (!VALID_LICENSES.includes(license)) {
    return { valid: false, error: 'licence invalide' };
  }

  if (license !== 'GEO_TIME_RESTRICTED') return { valid: true };

  const { latitude, longitude, radiusM, voteStartAt, voteEndAt } = geoOptions;

  if (!voteStartAt || !voteEndAt) {
    return { valid: false, error: 'voteStartAt et voteEndAt sont requis pour cette licence' };
  }

  if (!isValidDate(voteStartAt) || !isValidDate(voteEndAt)) {
    return { valid: false, error: 'voteStartAt et voteEndAt doivent être des dates valides' };
  }

  if (new Date(voteStartAt) >= new Date(voteEndAt)) {
    return { valid: false, error: 'voteStartAt doit être avant voteEndAt' };
  }

  if (latitude == null || longitude == null || radiusM == null) {
    return { valid: false, error: 'latitude, longitude et radiusM sont requis pour cette licence' };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  const radius = Number(radiusM);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: 'latitude invalide' };
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { valid: false, error: 'longitude invalide' };
  }

  if (!Number.isFinite(radius) || radius <= 0) {
    return { valid: false, error: 'radiusM doit être un nombre positif' };
  }

  return {
    valid: true,
    normalizedGeo: { latitude: lat, longitude: lng, radiusM: Math.floor(radius) },
  };
}

export async function canUserVote(room, userId, geoHeaders) {
  if (room.license === 'EVERYONE') return { allowed: true };

  if (room.license === 'INVITED_ONLY') {
    const invite = await prisma.roomInvite.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    });

    if (!invite) return { allowed: false, reason: 'Réservé aux invités' };

    return { allowed: true };
  }

  if (room.license === 'GEO_TIME_RESTRICTED') {
    if (!room.voteStartAt || !room.voteEndAt) {
      return { allowed: false, reason: 'Fenêtre de vote non configurée' };
    }

    if (room.latitude == null || room.longitude == null || room.radiusM == null) {
      return { allowed: false, reason: 'Zone de vote non configurée' };
    }

    const now = new Date();

    if (now < new Date(room.voteStartAt)) {
      return { allowed: false, reason: 'Le vote n\'a pas encore commencé' };
    }

    if (now >= new Date(room.voteEndAt)) {
      return { allowed: false, reason: 'Le vote est terminé' };
    }

    const userLat = Number.parseFloat(geoHeaders?.lat);
    const userLng = Number.parseFloat(geoHeaders?.lng);

    if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
      return { allowed: false, reason: 'Coordonnées requises pour voter (X-Dev-Lat, X-Dev-Lng)' };
    }

    const distance = haversineDistance(room.latitude, room.longitude, userLat, userLng);

    if (distance > room.radiusM) {
      return { allowed: false, reason: 'Vous n\'êtes pas dans la zone autorisée' };
    }

    return { allowed: true };
  }

  return { allowed: false, reason: 'Licence inconnue' };
}
