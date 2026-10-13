import prisma from './prisma.js';

// Interactive transactions queue behind a per-room advisory lock, so allow
// enough time for a burst of concurrent votes on the same room to drain.
const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

export class ServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isUniqueViolation(err) {
  return (
    err?.code === 'P2002' ||
    err?.cause?.code === '23505' ||
    /Unique constraint failed/i.test(err?.message || '')
  );
}

/**
 * Runs `fn` in a transaction serialized per room with a Postgres advisory lock.
 * ServiceErrors thrown inside roll the transaction back and are returned as
 * `{ error, code, status }`.
 */
export async function withRoomLock(roomId, fn) {
  try {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}))`;
        return fn(tx);
      }, TX_OPTIONS);
    } catch (err) {
      // P2028: transaction could not start in time or exceeded its timeout
      if (err?.code === 'P2028') {
        throw new ServiceError(503, 'ROOM_BUSY', 'Salle occupée, réessayez');
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof ServiceError) {
      return { error: err.message, code: err.code, status: err.status };
    }
    throw err;
  }
}
