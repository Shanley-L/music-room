import prisma from '../lib/prisma.js';
import { getOwnedDevice } from './deviceService.js';
import { areFriends } from './friendService.js';

/** Playback commands a player understands, and the right each one requires. */
export const COMMAND_RIGHTS = {
  play: 'canPlayPause',
  pause: 'canPlayPause',
  next: 'canSkip',
  previous: 'canSkip',
  setVolume: 'canVolume',
};

export const RIGHTS = ['canPlayPause', 'canSkip', 'canVolume'];

function serializeDelegation(delegation) {
  return {
    id: delegation.id,
    deviceId: delegation.deviceId,
    delegate: delegation.delegate
      ? { id: delegation.delegate.id, name: delegation.delegate.name }
      : { id: delegation.delegateId },
    canPlayPause: delegation.canPlayPause,
    canSkip: delegation.canSkip,
    canVolume: delegation.canVolume,
    active: delegation.active,
    createdAt: delegation.createdAt,
    updatedAt: delegation.updatedAt,
  };
}

const DELEGATE_INCLUDE = { delegate: { select: { id: true, name: true } } };

function pickRights(rights) {
  const data = {};
  for (const key of RIGHTS) if (rights[key] !== undefined) data[key] = rights[key];
  return data;
}

/** Active delegations granted on a device (owner only). */
export async function listDeviceDelegations(deviceId, ownerId) {
  const owned = await getOwnedDevice(deviceId, ownerId);
  if (owned.error) return owned;
  const delegations = await prisma.controlDelegation.findMany({
    where: { deviceId, active: true },
    include: DELEGATE_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  return { delegations: delegations.map(serializeDelegation) };
}

/**
 * Grants control of one device to an accepted friend. An existing active
 * delegation has its rights updated (`created: false`); a revoked one is
 * reactivated with the given rights (defaults: all true).
 */
export async function delegate(deviceId, ownerId, delegateId, rights = {}) {
  const owned = await getOwnedDevice(deviceId, ownerId);
  if (owned.error) return owned;

  if (delegateId === ownerId) {
    return {
      error: 'Vous contrôlez déjà vos propres appareils',
      code: 'CANNOT_DELEGATE_SELF',
      status: 400,
    };
  }
  if (!(await areFriends(ownerId, delegateId))) {
    return {
      error: 'Seuls vos amis peuvent recevoir le contrôle de cet appareil',
      code: 'NOT_FRIENDS',
      status: 403,
    };
  }

  const where = { deviceId_delegateId: { deviceId, delegateId } };
  const existing = await prisma.controlDelegation.findUnique({ where });
  const data = pickRights(rights);

  if (existing?.active) {
    const updated = await prisma.controlDelegation.update({
      where,
      data,
      include: DELEGATE_INCLUDE,
    });
    return { delegation: serializeDelegation(updated), created: false };
  }

  // New grant (or reactivation): unspecified rights fall back to the defaults.
  const fresh = { canPlayPause: true, canSkip: true, canVolume: true, ...data, active: true };
  const delegation = await prisma.controlDelegation.upsert({
    where,
    create: { deviceId, delegateId, ...fresh },
    update: fresh,
    include: DELEGATE_INCLUDE,
  });
  return { delegation: serializeDelegation(delegation), created: true };
}

/** Updates the rights of an active delegation. */
export async function updateRights(deviceId, ownerId, delegateId, rights) {
  const owned = await getOwnedDevice(deviceId, ownerId);
  if (owned.error) return owned;

  const { count } = await prisma.controlDelegation.updateMany({
    where: { deviceId, delegateId, active: true },
    data: pickRights(rights),
  });
  if (count === 0) {
    return { error: 'Délégation introuvable', code: 'DELEGATION_NOT_FOUND', status: 404 };
  }
  const delegation = await prisma.controlDelegation.findUnique({
    where: { deviceId_delegateId: { deviceId, delegateId } },
    include: DELEGATE_INCLUDE,
  });
  return { delegation: serializeDelegation(delegation) };
}

/** Revokes a delegation (kept inactive, so it can be granted again later). */
export async function revoke(deviceId, ownerId, delegateId) {
  const owned = await getOwnedDevice(deviceId, ownerId);
  if (owned.error) return owned;

  const { count } = await prisma.controlDelegation.updateMany({
    where: { deviceId, delegateId, active: true },
    data: { active: false },
  });
  if (count === 0) {
    return { error: 'Délégation introuvable', code: 'DELEGATION_NOT_FOUND', status: 404 };
  }
  return { ok: true };
}

/** Devices other users delegated to `userId` (active, still friends). */
export async function listReceived(userId) {
  const delegations = await prisma.controlDelegation.findMany({
    where: { delegateId: userId, active: true },
    include: {
      device: {
        select: {
          id: true,
          name: true,
          platform: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const result = [];
  for (const d of delegations) {
    if (!(await areFriends(userId, d.device.user.id))) continue;
    result.push({
      id: d.id,
      deviceId: d.deviceId,
      device: { id: d.device.id, name: d.device.name, platform: d.device.platform },
      owner: { id: d.device.user.id, name: d.device.user.name },
      canPlayPause: d.canPlayPause,
      canSkip: d.canSkip,
      canVolume: d.canVolume,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
  }
  return result;
}

/**
 * Access check re-read from the database on every call, so a revocation takes
 * effect immediately. `command` null checks watch access only (any right).
 * Returns `{ ok: true, device, isOwner }` or `{ ok: false, code }`.
 */
export async function canControl(userId, deviceId, command = null) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, userId: true },
  });
  if (!device) return { ok: false, code: 'DEVICE_NOT_FOUND' };
  if (device.userId === userId) return { ok: true, device, isOwner: true };

  const delegation = await prisma.controlDelegation.findUnique({
    where: { deviceId_delegateId: { deviceId, delegateId: userId } },
  });
  if (!delegation?.active) return { ok: false, code: 'DELEGATION_FORBIDDEN' };
  if (command && !delegation[COMMAND_RIGHTS[command]]) {
    return { ok: false, code: 'DELEGATION_FORBIDDEN' };
  }
  if (!(await areFriends(userId, device.userId))) return { ok: false, code: 'DELEGATION_FORBIDDEN' };
  return { ok: true, device, isOwner: false };
}
