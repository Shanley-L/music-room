import { z } from 'zod';
import {
  registerDevice,
  listDevices,
  renameDevice,
  deleteDevice,
} from '../services/deviceService.js';
import {
  listDeviceDelegations,
  delegate,
  updateRights,
  revoke,
} from '../services/delegationService.js';
import { closeDevice, revokeDeviceAccess, notifyDelegationUpdated } from '../lib/realtime.js';

function validationError(res, zodError) {
  const message = zodError.issues[0]?.message || 'Entrée invalide';
  return res.status(400).json({ error: message, code: 'VALIDATION_ERROR' });
}

function sendServiceError(res, result) {
  return res.status(result.status).json({ error: result.error, code: result.code });
}

const name = z.string().trim().min(1, 'name est requis').max(100, 'name est trop long (100 max)');

const registerSchema = z.object({
  name,
  platform: z.string().trim().min(1, 'platform est requis').max(50, 'platform est trop long (50 max)'),
  installationId: z
    .string()
    .trim()
    .min(1, 'installationId est requis')
    .max(191, 'installationId est trop long (191 max)'),
});

const renameSchema = z.object({ name });

const rightsShape = {
  canPlayPause: z.boolean().optional(),
  canSkip: z.boolean().optional(),
  canVolume: z.boolean().optional(),
};

const delegateSchema = z.object({
  userId: z.string().trim().min(1, 'userId est requis'),
  ...rightsShape,
});

const rightsSchema = z
  .object(rightsShape)
  .refine((r) => Object.values(r).some((v) => v !== undefined), {
    message: 'Au moins un droit (canPlayPause, canSkip, canVolume) est requis',
  });

export async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const { device, created } = await registerDevice(req.user.id, parsed.data);
  return res.status(created ? 201 : 200).json(device);
}

export async function list(req, res) {
  return res.json(await listDevices(req.user.id));
}

export async function rename(req, res) {
  const parsed = renameSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await renameDevice(req.params.id, req.user.id, parsed.data.name);
  if (result.error) return sendServiceError(res, result);
  return res.json(result.device);
}

export async function remove(req, res) {
  const result = await deleteDevice(req.params.id, req.user.id);
  if (result.error) return sendServiceError(res, result);

  await closeDevice(req.params.id, result.delegateIds);
  return res.status(204).end();
}

export async function listDelegations(req, res) {
  const result = await listDeviceDelegations(req.params.id, req.user.id);
  if (result.error) return sendServiceError(res, result);
  return res.json(result.delegations);
}

export async function createDelegation(req, res) {
  const parsed = delegateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const { userId, ...rights } = parsed.data;
  const result = await delegate(req.params.id, req.user.id, userId, rights);
  if (result.error) return sendServiceError(res, result);
  notifyDelegationUpdated(result.delegation);
  return res.status(result.created ? 201 : 200).json(result.delegation);
}

export async function updateDelegation(req, res) {
  const parsed = rightsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await updateRights(req.params.id, req.user.id, req.params.userId, parsed.data);
  if (result.error) return sendServiceError(res, result);
  notifyDelegationUpdated(result.delegation);
  return res.json(result.delegation);
}

export async function removeDelegation(req, res) {
  const result = await revoke(req.params.id, req.user.id, req.params.userId);
  if (result.error) return sendServiceError(res, result);

  await revokeDeviceAccess(req.params.id, req.params.userId, 'REVOKED');
  return res.status(204).end();
}
