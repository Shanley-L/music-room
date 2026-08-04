import {
  createRoom,
  listPublicRooms,
  getRoomForUser,
  joinRoomByCode,
  inviteUser,
} from '../services/roomService.js';
import {
  validateLicenseOptions,
  VALID_LICENSES,
  VALID_VISIBILITIES,
} from '../services/licenseService.js';

export async function create(req, res) {
  const { name, visibility, license, latitude, longitude, radiusM, voteStartAt, voteEndAt } = req.body;

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return res.status(400).json({ error: 'name est requis' });

  const resolvedLicense = license ?? 'EVERYONE';
  const resolvedVisibility = visibility ?? 'PUBLIC';

  if (!VALID_LICENSES.includes(resolvedLicense)) {
    return res.status(400).json({ error: 'licence invalide' });
  }

  if (!VALID_VISIBILITIES.includes(resolvedVisibility)) {
    return res.status(400).json({ error: 'visibility invalide' });
  }

  const geoOptions = { latitude, longitude, radiusM, voteStartAt, voteEndAt };
  const licenseCheck = validateLicenseOptions(resolvedLicense, geoOptions);

  if (!licenseCheck.valid) {
    return res.status(400).json({ error: licenseCheck.error });
  }

  const roomGeo = licenseCheck.normalizedGeo
    ? { ...geoOptions, ...licenseCheck.normalizedGeo }
    : geoOptions;

  const room = await createRoom({
    name: trimmedName,
    visibility: resolvedVisibility,
    license: resolvedLicense,
    ownerId: req.user.id,
    geoOptions: roomGeo,
  });

  return res.status(201).json(room);
}

export async function listPublic(req, res) {
  const rooms = await listPublicRooms();
  return res.json(rooms);
}

export async function getOne(req, res) {
  const room = await getRoomForUser(req.params.id, req.user.id);

  if (!room) return res.status(404).json({ error: 'Salle introuvable' });

  return res.json(room);
}

export async function join(req, res) {
  const inviteCode = typeof req.body.inviteCode === 'string' ? req.body.inviteCode.trim() : '';

  if (!inviteCode) return res.status(400).json({ error: 'inviteCode est requis' });

  const result = await joinRoomByCode(inviteCode, req.user.id);

  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.json(result.room);
}

export async function invite(req, res) {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'userId est requis' });

  const result = await inviteUser(req.params.id, req.user.id, userId);

  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.status(201).json(result.invite);
}
