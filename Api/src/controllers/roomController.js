import { z } from 'zod';
import {
  createRoom,
  listPublicRooms,
  listRoomsForUser,
  getRoomById,
  joinRoomByCode,
  inviteUser,
  removeInvite as removeInviteService,
  deleteRoom,
  regenerateInviteCode,
  describeAccess,
  updateRoom,
  publicRoomFields,
  isUserAllowedInRoom,
  sanitizeRoomForUser,
  hasZone,
  hasWindow,
} from '../services/roomService.js';
import { emitToRoom, evictFromRoom, revokeRoomAccess, revokeRoomSubscribers } from '../lib/realtime.js';

// Only date strings (e.g. ISO 8601) are accepted: null, numbers and booleans are rejected
// instead of being coerced to 1970.
function dateString(field) {
  const message = `${field} doit être une date valide (ISO 8601)`;
  return z
    .string({ error: message })
    .refine((s) => s.trim() !== '' && !Number.isNaN(Date.parse(s)), { message })
    .transform((s) => new Date(s));
}

const createRoomSchema = z
  .object({
    name: z.string().trim().min(1, 'name est requis').max(100, 'name est trop long (100 max)'),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    license: z.enum(['EVERYONE', 'INVITED_ONLY', 'GEO_TIME_RESTRICTED']).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radiusM: z.number().int().positive().max(2147483647).optional(),
    voteStartAt: dateString('voteStartAt').optional(),
    voteEndAt: dateString('voteEndAt').optional(),
  })
  .superRefine((data, ctx) => {
    const zoneFields = [data.latitude, data.longitude, data.radiusM].filter((v) => v !== undefined);
    if (zoneFields.length > 0 && zoneFields.length < 3) {
      ctx.addIssue({
        code: 'custom',
        message: 'latitude, longitude et radiusM doivent être fournis ensemble',
        path: ['radiusM'],
      });
    }
    if (data.voteStartAt && data.voteEndAt && data.voteStartAt >= data.voteEndAt) {
      ctx.addIssue({
        code: 'custom',
        message: 'voteStartAt doit précéder voteEndAt',
        path: ['voteEndAt'],
      });
    }
  });

// PATCH: every field optional; null clears the zone / time window fields. The merged
// room is validated again by the service (zone complete, window ordered, geo license).
const updateRoomSchema = z
  .object({
    name: createRoomSchema.shape.name.optional(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    license: z.enum(['EVERYONE', 'INVITED_ONLY', 'GEO_TIME_RESTRICTED']).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    radiusM: z.number().int().positive().max(2147483647).nullable().optional(),
    voteStartAt: dateString('voteStartAt').nullable().optional(),
    voteEndAt: dateString('voteEndAt').nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Aucun champ à modifier',
  });

const inviteSchema = z.object({
  userId: z.string().trim().min(1, 'userId est requis'),
});

const joinSchema = z.object({
  inviteCode: z.string().trim().min(1, 'inviteCode est requis').max(64, 'inviteCode invalide'),
});

function validationError(res, zodError) {
  const message = zodError.issues[0]?.message || 'Entrée invalide';
  return res.status(400).json({ error: message, code: 'VALIDATION_ERROR' });
}

function sendServiceError(res, result) {
  return res.status(result.status).json({ error: result.error, code: result.code });
}

export async function create(req, res) {
  const parsed = createRoomSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const { name, visibility, license, latitude, longitude, radiusM, voteStartAt, voteEndAt } =
    parsed.data;
  const geoOptions = { latitude, longitude, radiusM, voteStartAt, voteEndAt };

  if (license === 'GEO_TIME_RESTRICTED' && !hasZone(geoOptions) && !hasWindow(geoOptions)) {
    return res.status(400).json({
      error: 'Une zone (latitude, longitude, radiusM) ou une plage horaire (voteStartAt, voteEndAt) est requise pour la licence GEO_TIME_RESTRICTED',
      code: 'GEO_CONFIG_REQUIRED',
    });
  }

  const room = await createRoom({ name, visibility, license, ownerId: req.user.id, geoOptions });

  return res.status(201).json(room);
}

export async function listPublic(req, res) {
  const rooms = await listPublicRooms();
  return res.json(rooms);
}

export async function mine(req, res) {
  const rooms = await listRoomsForUser(req.user.id);
  return res.json(rooms);
}

export async function getOne(req, res) {
  const room = await getRoomById(req.params.id);

  if (!room) return res.status(404).json({ error: 'Salle introuvable', code: 'ROOM_NOT_FOUND' });

  const allowed = await isUserAllowedInRoom(room, req.user.id);
  if (!allowed) {
    return res.status(403).json({ error: 'Accès refusé à cette salle', code: 'ROOM_FORBIDDEN' });
  }

  const access = await describeAccess(room, req.user.id);
  return res.json({ ...sanitizeRoomForUser(room, req.user.id), ...access });
}

export async function update(req, res) {
  const parsed = updateRoomSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await updateRoom(req.params.id, req.user.id, parsed.data);
  if (result.error) return sendServiceError(res, result);

  const { room } = result;
  emitToRoom(room.id, 'room:updated', { roomId: room.id, room: publicRoomFields(room) });

  // Became private: subscribers who are neither the owner nor invited lose access.
  if (room.visibility === 'PRIVATE') {
    const full = await getRoomById(room.id);
    const invited = new Set(full?.invites.map((i) => i.userId) ?? []);
    await revokeRoomSubscribers(room.id, (userId) => userId === room.ownerId || invited.has(userId));
  }

  return res.json({ ...room, ...(await describeAccess(room, req.user.id)) });
}

export async function join(req, res) {
  const parsed = joinSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await joinRoomByCode(parsed.data.inviteCode, req.user.id);

  if (result.error) return sendServiceError(res, result);

  return res.json(result.room);
}

export async function regenerateCode(req, res) {
  const result = await regenerateInviteCode(req.params.id, req.user.id);

  if (result.error) return sendServiceError(res, result);

  return res.json({ inviteCode: result.inviteCode });
}

export async function invite(req, res) {
  const parsed = inviteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await inviteUser(req.params.id, req.user.id, parsed.data.userId);

  if (result.error) return sendServiceError(res, result);

  return res.status(201).json(result.invite);
}

export async function removeInvite(req, res) {
  const result = await removeInviteService(req.params.id, req.user.id, req.params.userId);

  if (result.error) return sendServiceError(res, result);

  // Realtime: a revoked user who no longer has access gets `room:revoked` and
  // stops receiving room events.
  const room = await getRoomById(req.params.id);
  if (room && !(await isUserAllowedInRoom(room, req.params.userId))) {
    await revokeRoomAccess(req.params.id, req.params.userId);
  }

  return res.status(204).end();
}

export async function remove(req, res) {
  const result = await deleteRoom(req.params.id, req.user.id);

  if (result.error) return sendServiceError(res, result);

  emitToRoom(req.params.id, 'room:deleted', { roomId: req.params.id });
  await evictFromRoom(req.params.id);

  return res.status(204).end();
}
