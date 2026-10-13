import prisma from '../lib/prisma.js';

/** Only public identity fields are ever exposed for other users. */
const PUBLIC_USER = { id: true, name: true };

/** One relation per pair of users, whatever its direction. */
export function pairKey(a, b) {
  return [a, b].sort().join(':');
}

export async function areFriends(userA, userB, client = prisma) {
  if (!userA || !userB || userA === userB) return false;
  const friendship = await client.friendship.findUnique({
    where: { pairKey: pairKey(userA, userB) },
    select: { status: true },
  });
  return friendship?.status === 'ACCEPTED';
}

function serializeRequest(request, viewerId) {
  const other = request.requesterId === viewerId ? request.addressee : request.requester;
  return {
    id: request.id,
    status: request.status,
    direction: request.requesterId === viewerId ? 'OUTGOING' : 'INCOMING',
    user: other ? { id: other.id, name: other.name } : undefined,
    createdAt: request.createdAt,
  };
}

const REQUEST_INCLUDE = {
  requester: { select: PUBLIC_USER },
  addressee: { select: PUBLIC_USER },
};

export async function sendRequest(requesterId, addresseeId) {
  if (requesterId === addresseeId) {
    return {
      error: 'Impossible de vous ajouter vous-même en ami',
      code: 'CANNOT_FRIEND_SELF',
      status: 400,
    };
  }

  const addressee = await prisma.user.findUnique({ where: { id: addresseeId }, select: { id: true } });
  if (!addressee) return { error: 'Utilisateur introuvable', code: 'USER_NOT_FOUND', status: 404 };

  // The other user already asked: sending a request back accepts theirs.
  const reverse = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId: addresseeId, addresseeId: requesterId } },
    select: { id: true, status: true },
  });
  if (reverse?.status === 'PENDING') {
    const accepted = await acceptRequest(reverse.id, requesterId);
    if (!accepted.error) return { request: accepted.request, accepted: true };
    // Cancelled meanwhile: fall through and create our own request.
  }

  try {
    const request = await prisma.friendship.create({
      data: { requesterId, addresseeId, pairKey: pairKey(requesterId, addresseeId) },
      include: REQUEST_INCLUDE,
    });
    return { request: serializeRequest(request, requesterId) };
  } catch (err) {
    if (err?.code === 'P2002') {
      return {
        error: 'Une demande ou une amitié existe déjà avec cet utilisateur',
        code: 'FRIENDSHIP_EXISTS',
        status: 409,
      };
    }
    throw err;
  }
}

/** Pending requests involving the user, split by direction. */
export async function listRequests(userId) {
  const requests = await prisma.friendship.findMany({
    where: { status: 'PENDING', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: REQUEST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  const serialized = requests.map((r) => serializeRequest(r, userId));
  return {
    incoming: serialized.filter((r) => r.direction === 'INCOMING'),
    outgoing: serialized.filter((r) => r.direction === 'OUTGOING'),
  };
}

export async function acceptRequest(requestId, userId) {
  const request = await prisma.friendship.findUnique({ where: { id: requestId } });
  if (!request || (request.requesterId !== userId && request.addresseeId !== userId)) {
    return { error: 'Demande introuvable', code: 'FRIEND_REQUEST_NOT_FOUND', status: 404 };
  }
  if (request.addresseeId !== userId) {
    return {
      error: 'Seul le destinataire peut accepter la demande',
      code: 'NOT_REQUEST_ADDRESSEE',
      status: 403,
    };
  }
  if (request.status === 'ACCEPTED') {
    return { error: 'Demande déjà acceptée', code: 'FRIENDSHIP_EXISTS', status: 409 };
  }

  // Conditional update: a request cancelled meanwhile is not resurrected.
  const { count } = await prisma.friendship.updateMany({
    where: { id: requestId, status: 'PENDING' },
    data: { status: 'ACCEPTED' },
  });
  if (count === 0) {
    return { error: 'Demande introuvable', code: 'FRIEND_REQUEST_NOT_FOUND', status: 404 };
  }

  const accepted = await prisma.friendship.findUnique({
    where: { id: requestId },
    include: REQUEST_INCLUDE,
  });
  return { request: serializeRequest(accepted, userId) };
}

/** Declines (addressee) or cancels (requester) a pending request. */
export async function deleteRequest(requestId, userId) {
  const { count } = await prisma.friendship.deleteMany({
    where: {
      id: requestId,
      status: 'PENDING',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
  });
  if (count === 0) {
    return { error: 'Demande introuvable', code: 'FRIEND_REQUEST_NOT_FOUND', status: 404 };
  }
  return { ok: true };
}

/** Accepted friends of the user, as `{ id, name }` only. */
export async function listFriends(userId) {
  const friendships = await prisma.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: REQUEST_INCLUDE,
  });
  return friendships
    .map((f) => (f.requesterId === userId ? f.addressee : f.requester))
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

/**
 * Ends an accepted friendship and deletes every delegation between the two users
 * (both directions), in one transaction. Returns `{ revoked: [{ deviceId, delegateId }] }`
 * so the caller can evict the affected sockets.
 */
export async function removeFriend(userId, friendId) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.friendship.deleteMany({
      where: { pairKey: pairKey(userId, friendId), status: 'ACCEPTED' },
    });
    if (count === 0) {
      return { error: 'Cet utilisateur n\'est pas votre ami', code: 'NOT_FRIENDS', status: 404 };
    }

    const where = {
      OR: [
        { delegateId: friendId, device: { userId } },
        { delegateId: userId, device: { userId: friendId } },
      ],
    };
    const revoked = await tx.controlDelegation.findMany({
      where,
      select: { deviceId: true, delegateId: true },
    });
    await tx.controlDelegation.deleteMany({ where });
    return { revoked };
  });
}
