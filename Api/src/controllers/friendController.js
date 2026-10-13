import { z } from 'zod';
import {
  sendRequest,
  listRequests,
  acceptRequest,
  deleteRequest,
  listFriends,
  removeFriend,
} from '../services/friendService.js';
import { revokeDeviceAccess } from '../lib/realtime.js';

const requestSchema = z.object({
  userId: z.string().trim().min(1, 'userId est requis'),
});

function validationError(res, zodError) {
  const message = zodError.issues[0]?.message || 'Entrée invalide';
  return res.status(400).json({ error: message, code: 'VALIDATION_ERROR' });
}

function sendServiceError(res, result) {
  return res.status(result.status).json({ error: result.error, code: result.code });
}

export async function createRequest(req, res) {
  const parsed = requestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await sendRequest(req.user.id, parsed.data.userId);
  if (result.error) return sendServiceError(res, result);
  // 200 when this accepted the other user's pending request, 201 for a new request.
  return res.status(result.accepted ? 200 : 201).json(result.request);
}

export async function requests(req, res) {
  return res.json(await listRequests(req.user.id));
}

export async function accept(req, res) {
  const result = await acceptRequest(req.params.id, req.user.id);
  if (result.error) return sendServiceError(res, result);
  return res.json(result.request);
}

export async function removeRequest(req, res) {
  const result = await deleteRequest(req.params.id, req.user.id);
  if (result.error) return sendServiceError(res, result);
  return res.status(204).end();
}

export async function list(req, res) {
  return res.json(await listFriends(req.user.id));
}

export async function remove(req, res) {
  const result = await removeFriend(req.user.id, req.params.userId);
  if (result.error) return sendServiceError(res, result);

  // Every delegation between the two users is gone: evict and notify the delegates.
  await Promise.all(
    result.revoked.map(({ deviceId, delegateId }) =>
      revokeDeviceAccess(deviceId, delegateId, 'UNFRIENDED')
    )
  );
  return res.status(204).end();
}
