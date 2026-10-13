import prisma from '../lib/prisma.js';
import { areFriends } from './friendService.js';

/**
 * Profile visibility levels (subject V.1 / V.6):
 * - public: everyone (id, name, avatar, bio, music preferences);
 * - friends: public + friendsInfo, for accepted friends (Friendship ACCEPTED);
 * - owner: every field except secrets (password, verification/reset codes);
 *   email, privateInfo and linked accounts are never shown to anyone else.
 */
function sanitizeUser(user, level = 'public') {
  if (!user) return null;

  if (level === 'owner') {
    const { password, verificationCode, resetPasswordCode, resetPasswordExpires, ...full } = user;
    return full;
  }

  const view = {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    musicPreferences: user.musicPreferences,
    createdAt: user.createdAt,
  };

  if (level === 'friend') view.friendsInfo = user.friendsInfo;

  return view;
}

export async function getUserProfile(userId, requesterId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) return null;

  if (requesterId && userId === requesterId) return sanitizeUser(user, 'owner');
  if (requesterId && (await areFriends(userId, requesterId))) return sanitizeUser(user, 'friend');
  return sanitizeUser(user, 'public');
}

export async function updateUserProfile(userId, data) {
  const { name, bio, friendsInfo, privateInfo, musicPreferences, avatarUrl } = data;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(bio !== undefined && { bio }),
      ...(friendsInfo !== undefined && { friendsInfo }),
      ...(privateInfo !== undefined && { privateInfo }),
      ...(musicPreferences !== undefined && { musicPreferences }),
      ...(avatarUrl !== undefined && { avatarUrl }),
    },
  });

  return sanitizeUser(updated, 'owner');
}

/** Name search for adding friends: `{ id, name }` only, caller excluded, 20 max. */
export async function searchUsers(query, requesterId) {
  return prisma.user.findMany({
    where: {
      id: { not: requesterId },
      // LIKE wildcards in the query are matched literally.
      name: { contains: query.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' },
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 20,
  });
}
