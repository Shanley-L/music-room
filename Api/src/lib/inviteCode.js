import { randomBytes } from 'crypto';

/**
 * Invite codes for private rooms and playlists. 32-symbol alphabet without the
 * ambiguous I, O, 0 and 1 (32 divides 256, so byte % 32 has no modulo bias):
 * 10 symbols = 50 bits of entropy, about 1.1e15 possible codes.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 10;

export function generateInviteCode(length = INVITE_CODE_LENGTH) {
  const bytes = randomBytes(length);
  let code = '';
  for (const byte of bytes) code += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
  return code;
}

/** Normalizes a user-typed code (codes are case-insensitive, surrounding spaces ignored). */
export function normalizeInviteCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

/**
 * Runs `write(code)` with fresh codes until it does not hit the unique constraint
 * on inviteCode (Prisma P2002), at most `attempts` times.
 */
export async function withFreshInviteCode(write, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await write(generateInviteCode());
    } catch (err) {
      const target = err?.meta?.target;
      const onInviteCode =
        err?.code === 'P2002' &&
        (target == null || String(Array.isArray(target) ? target.join(',') : target).includes('inviteCode'));
      if (!onInviteCode || i >= attempts) throw err;
    }
  }
}
