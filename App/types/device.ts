/**
 * Music Control Delegation types (REST: Api/src/routes/deviceRoutes.js, friendRoutes.js,
 * delegationRoutes.js; realtime: Api/REALTIME.md).
 */

export type PublicUser = { id: string; name: string };

export type Device = {
  id: string;
  name: string;
  platform: string;
  installationId: string;
  createdAt: string;
  updatedAt: string;
};

export type DelegationRights = {
  canPlayPause: boolean;
  canSkip: boolean;
  canVolume: boolean;
};

/** A delegation granted on one of my devices (`GET /api/devices/:id/delegations`). */
export type Delegation = DelegationRights & {
  id: string;
  deviceId: string;
  delegate: PublicUser;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A device a friend delegated to me (`GET /api/delegations/received`). */
export type ReceivedDelegation = DelegationRights & {
  id: string;
  deviceId: string;
  device: { id: string; name: string; platform: string };
  owner: PublicUser;
  createdAt: string;
  updatedAt: string;
};

export type FriendRequest = {
  id: string;
  status: 'PENDING' | 'ACCEPTED';
  direction: 'INCOMING' | 'OUTGOING';
  user: PublicUser;
  createdAt: string;
};

export type PlayerCommand = 'play' | 'pause' | 'next' | 'previous' | 'setVolume';

/** `device:state.state` as published by this app's player (free-form on the server). */
export type PlayerState = {
  playing: boolean;
  trackId: string | null;
  title: string | null;
  artist: string | null;
  coverUrl: string | null;
  /** 0 to 100. */
  volume: number;
};

export const RIGHT_LABELS: Record<keyof DelegationRights, string> = {
  canPlayPause: 'Lecture / pause',
  canSkip: 'Suivant / précédent',
  canVolume: 'Volume',
};
