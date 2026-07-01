import {
  createRoom,
  listPublicRooms,
  getRoomById,
  joinRoomByCode,
  inviteUser,
} from '../services/roomService.js';
import { validateLicenseOptions } from '../services/licenseService.js';

export async function create(req, res) {
  const { name, visibility, license, latitude, longitude, radiusM, voteStartAt, voteEndAt } = req.body;

  if (!name) return res.status(400).json({ error: 'name est requis' });

  const geoOptions = { latitude, longitude, radiusM, voteStartAt, voteEndAt };
  const licenseCheck = validateLicenseOptions(license ?? 'EVERYONE', geoOptions);

  if (!licenseCheck.valid) {
    return res.status(400).json({ error: licenseCheck.error });
  }

  const room = await createRoom({ name, visibility, license, ownerId: req.user.id, geoOptions });

  return res.status(201).json(room);
}

export async function listPublic(req, res) {
  const rooms = await listPublicRooms();
  return res.json(rooms);
}

export async function getOne(req, res) {
  const room = await getRoomById(req.params.id);

  if (!room) return res.status(404).json({ error: 'Salle introuvable' });

  return res.json(room);
}

export async function join(req, res) {
  const { inviteCode } = req.body;

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
