import prisma from '../lib/prisma.js';

const DEVICE_SELECT = {
  id: true,
  name: true,
  platform: true,
  installationId: true,
  createdAt: true,
  updatedAt: true,
};

const NOT_FOUND = { error: 'Appareil introuvable', code: 'DEVICE_NOT_FOUND', status: 404 };
const NOT_OWNER = { error: 'Cet appareil ne vous appartient pas', code: 'NOT_DEVICE_OWNER', status: 403 };

/**
 * Loads a device and checks that `userId` owns it.
 * Returns `{ device }` or `{ error, code, status }`.
 */
export async function getOwnedDevice(deviceId, userId, client = prisma) {
  const device = await client.device.findUnique({ where: { id: deviceId } });
  if (!device) return NOT_FOUND;
  if (device.userId !== userId) return NOT_OWNER;
  return { device };
}

/**
 * Registers a device for the user. The same installationId for the same user
 * returns the existing device (`created: false`), with its name and platform
 * updated when they changed.
 */
export async function registerDevice(userId, { name, platform, installationId }) {
  const where = { userId_installationId: { userId, installationId } };
  const existing = await prisma.device.findUnique({ where, select: DEVICE_SELECT });
  if (existing) {
    if (existing.name === name && existing.platform === platform) {
      return { device: existing, created: false };
    }
    // Re-registration of the same installation refreshes its name and platform.
    const device = await prisma.device.update({
      where,
      data: { name, platform },
      select: DEVICE_SELECT,
    });
    return { device, created: false };
  }

  try {
    const device = await prisma.device.create({
      data: { userId, name, platform, installationId },
      select: DEVICE_SELECT,
    });
    return { device, created: true };
  } catch (err) {
    // Concurrent registration of the same installation: the winner gets our name/platform.
    if (err?.code === 'P2002') {
      const device = await prisma.device.update({
        where,
        data: { name, platform },
        select: DEVICE_SELECT,
      });
      return { device, created: false };
    }
    throw err;
  }
}

export async function listDevices(userId) {
  return prisma.device.findMany({
    where: { userId },
    select: DEVICE_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

export async function renameDevice(deviceId, userId, name) {
  const owned = await getOwnedDevice(deviceId, userId);
  if (owned.error) return owned;
  const device = await prisma.device.update({
    where: { id: deviceId },
    data: { name },
    select: DEVICE_SELECT,
  });
  return { device };
}

/**
 * Deletes a device (its delegations cascade). Returns the ids of the users whose
 * active delegation was removed (revoked ones are not notified again).
 */
export async function deleteDevice(deviceId, userId) {
  return prisma.$transaction(async (tx) => {
    const owned = await getOwnedDevice(deviceId, userId, tx);
    if (owned.error) return owned;
    const delegations = await tx.controlDelegation.findMany({
      where: { deviceId, active: true },
      select: { delegateId: true },
    });
    await tx.device.delete({ where: { id: deviceId } });
    return { delegateIds: delegations.map((d) => d.delegateId) };
  });
}
