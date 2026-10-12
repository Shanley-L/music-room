import prisma from '../lib/prisma.js';

function sanitizeUser(user, isOwner = false) {
  if (!user) return null;

  if (isOwner) {
    const { password, verificationCode, resetPasswordCode, resetPasswordExpires, ...full } = user;
    return full;
  }

  // Public view: only public info & music preferences
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    musicPreferences: user.musicPreferences,
    createdAt: user.createdAt,
  };
}

export async function getUserProfile(userId, requesterId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) return null;

  const isOwner = userId === requesterId;
  return sanitizeUser(user, isOwner);
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

  return sanitizeUser(updated, true);
}
