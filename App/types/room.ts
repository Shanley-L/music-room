/** Track Vote types (REST contract: Api/src/routes/roomRoutes.js, trackRoutes.js). */

export type RoomVisibility = 'PUBLIC' | 'PRIVATE';
export type RoomLicense = 'EVERYONE' | 'INVITED_ONLY' | 'GEO_TIME_RESTRICTED';

export type Room = {
  id: string;
  name: string;
  visibility: RoomVisibility;
  license: RoomLicense;
  /** Owner only. */
  inviteCode?: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusM: number | null;
  voteStartAt: string | null;
  voteEndAt: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Owner only. */
  invites?: { id: string; roomId: string; userId: string; createdAt: string }[];
  _count?: { tracks: number };
  /** Only in GET / PATCH /api/rooms/:id. */
  myRole?: RoomRole;
  permissions?: RoomPermissions;
};

export type RoomRole = 'OWNER' | 'INVITED' | 'MEMBER';

export const ROLE_LABELS: Record<RoomRole, string> = {
  OWNER: 'Organisateur',
  INVITED: 'Invité',
  MEMBER: 'Membre',
};

export type RoomPermissions = {
  /** True too when the position is required (`voteRequiresLocation`). */
  canVote: boolean;
  voteRequiresLocation: boolean;
  /** French reason when voting is (or may be) blocked by the license. */
  voteBlockedReason: string | null;
  voteBlockedCode: string | null;
  canSuggest: boolean;
  canControlPlayback: boolean;
  canManageRoom: boolean;
  canInvite: boolean;
  canRemoveTrack: boolean;
};

export type PlaybackStatus = 'IDLE' | 'PLAYING' | 'PAUSED';

/** Server playback state (REST GET /playback and socket `playback:updated`). */
export type PlaybackState = {
  roomId: string;
  status: PlaybackStatus;
  currentTrack: (RoomTrack & { durationMs: number }) | null;
  /** Server time at which position 0 would have been reached (null unless PLAYING). */
  startedAt: string | null;
  positionMs: number;
  serverTime: string;
};

export type RoomTrack = {
  id: string;
  roomId: string;
  externalId: string;
  title: string;
  artist: string;
  album: string | null;
  preview: string | null;
  coverUrl?: string | null;
  duration: number | null;
  voteCount: number;
  /** 1 = next track. */
  position: number;
  suggestedBy: string;
  createdAt: string;
  /**
   * Did the caller vote for this track? Only in REST responses (GET tracks, vote,
   * unvote); absent from socket events, which are shared by every client.
   */
  hasVoted?: boolean;
};

export const LICENSE_LABELS: Record<RoomLicense, string> = {
  EVERYONE: 'Tout le monde vote',
  INVITED_ONLY: 'Invités seulement',
  GEO_TIME_RESTRICTED: 'Lieu et horaire',
};
