import { Alert, Platform } from 'react-native';

/** French messages for API / socket error codes (server messages are used when a code is unknown). */
const MESSAGES: Record<string, string> = {
  NOT_INVITED: 'Seuls les invités peuvent voter dans cet événement.',
  OUT_OF_ZONE: 'Vous êtes hors de la zone de vote.',
  OUT_OF_TIME_WINDOW: "Le vote n'est pas ouvert à cette heure.",
  LOCATION_REQUIRED: 'Votre position est requise pour voter dans cet événement.',
  ALREADY_VOTED: 'Vous avez déjà voté pour ce titre.',
  VOTE_NOT_FOUND: "Vous n'avez pas voté pour ce titre.",
  TRACK_ALREADY_IN_QUEUE: 'Ce titre est déjà dans la file.',
  TRACK_NOT_FOUND: "Ce titre n'est plus dans la file.",
  ROOM_FORBIDDEN: "Vous n'avez pas accès à cet événement.",
  ROOM_NOT_FOUND: 'Événement introuvable.',
  ROOM_BUSY: 'Événement occupé, réessayez.',
  INVALID_INVITE_CODE: "Code d'invitation invalide.",
  NOT_ROOM_OWNER: "Seul l'organisateur peut faire cette action.",
  USER_NOT_FOUND: 'Utilisateur introuvable.',
  GEO_CONFIG_REQUIRED:
    'Une zone (position et rayon) ou une plage horaire est requise pour la licence géo-horaire.',
  PLAYLIST_FORBIDDEN: "Vous n'avez plus accès à cette playlist.",
  PLAYLIST_NOT_FOUND: 'Playlist introuvable.',
  PLAYLIST_BUSY: 'Playlist occupée, réessayez.',
  TOO_MANY_CHANNELS: 'Trop de canaux temps réel ouverts.',
  UNAUTHORIZED: 'Session expirée, veuillez vous reconnecter.',
  INTERNAL_ERROR: 'Erreur interne du serveur.',
  TIMEOUT: 'Le serveur ne répond pas.',
  NOT_CONNECTED: 'Temps réel indisponible, réessayez dans un instant.',
  INVITE_NOT_FOUND: 'Invitation introuvable.',
  // Friends
  CANNOT_FRIEND_SELF: 'Vous ne pouvez pas vous ajouter vous-même en ami.',
  FRIENDSHIP_EXISTS: 'Une demande ou une amitié existe déjà avec cet utilisateur.',
  FRIEND_REQUEST_NOT_FOUND: "Cette demande d'ami n'existe plus.",
  NOT_REQUEST_ADDRESSEE: 'Seul le destinataire peut accepter cette demande.',
  NOT_FRIENDS: "Cet utilisateur n'est pas (ou plus) votre ami.",
  // Devices and control delegation
  DEVICE_NOT_FOUND: 'Appareil introuvable.',
  NOT_DEVICE_OWNER: 'Cet appareil ne vous appartient pas.',
  DEVICE_FORBIDDEN: 'Cet appareil ne vous appartient pas.',
  CANNOT_DELEGATE_SELF: 'Vous contrôlez déjà vos propres appareils.',
  DELEGATION_NOT_FOUND: 'Délégation introuvable.',
  DELEGATION_FORBIDDEN: "Vous n'avez pas le droit de faire cette action sur cet appareil.",
  DEVICE_OFFLINE: "L'appareil n'est pas en ligne comme lecteur.",
  RATE_LIMITED: 'Trop de commandes, patientez un instant.',
};

/** Why control of a device was lost (`device:revoked.reason`). */
const REVOKE_REASONS: Record<string, string> = {
  REVOKED: "Le propriétaire vous a retiré le contrôle de cet appareil.",
  UNFRIENDED: "Vous n'êtes plus amis : le contrôle de cet appareil vous a été retiré.",
  DEVICE_DELETED: 'Cet appareil a été supprimé par son propriétaire.',
};

export function revokeReasonMessage(reason: string | undefined) {
  return (reason && REVOKE_REASONS[reason]) || "Vous n'avez plus le contrôle de cet appareil.";
}

/**
 * French message for an API error body `{ error, code }`. Validation errors keep the
 * server message (it names the faulty field); other known codes use the French table.
 */
export function errorMessage(body: { error?: string; code?: string } | null | undefined, fallback: string) {
  const code = body?.code;
  if (code && code !== 'VALIDATION_ERROR' && MESSAGES[code]) return MESSAGES[code];
  return body?.error || (code && MESSAGES[code]) || fallback;
}

/** Message for a socket join ack code. */
export function codeMessage(code: string, fallback: string) {
  return MESSAGES[code] || fallback;
}

/** Alert that also works on web (react-native-web has no Alert implementation). */
export function notify(title: string, message: string, onClose?: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    onClose?.();
    return;
  }
  // `onClose` runs once, whether the user taps OK or dismisses the alert (Android back
  // button / tap outside).
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };
  Alert.alert(title, message, [{ text: 'OK', onPress: close }], {
    cancelable: true,
    onDismiss: close,
  });
}

/** Yes / no question (web: `window.confirm`). `onConfirm` runs only on confirmation. */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void
) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Annuler', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
