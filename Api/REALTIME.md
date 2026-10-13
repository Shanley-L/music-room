# Temps réel (Socket.IO)

Le serveur Socket.IO est attaché au même serveur HTTP que l'API (même port, chemin par défaut `/socket.io`).

- **REST reste le seul chemin d'écriture** pour les salles, playlists, appareils, amis et délégations. Les sockets servent à s'abonner et à recevoir des diffusions, plus une exception : la délégation de contrôle (Music Control Delegation) relaie par socket les commandes de lecture et l'état du lecteur (voir plus bas). Le serveur ne joue jamais d'audio : il vérifie et relaie.
- **L'état serveur fait foi.** Les événements transportent le nouvel état côté serveur (file complète et ordonnée, liste complète des titres), jamais des deltas à réconcilier.
- **Multi-instances.** Quand Redis est joignable au démarrage, l'adaptateur `@socket.io/redis-adapter` synchronise les instances. Sinon, le serveur utilise l'adaptateur en mémoire (une seule instance). **Le choix est fait une seule fois, au démarrage** : si Redis devient disponible plus tard, l'instance reste en mémoire jusqu'à son redémarrage.

## Handshake

```js
import { io } from 'socket.io-client';

const socket = io(API_URL, {
  auth: {
    token: accessToken,  // JWT d'accès (le même que `Authorization: Bearer`)
    platform: 'ios',     // journalisé
    device: 'iPhone 15', // journalisé
    appVersion: '1.2.0', // journalisé
  },
});
```

Si le token est absent, invalide, expiré ou révoqué (blacklist de déconnexion), la connexion est refusée : `connect_error` avec `err.message === 'UNAUTHORIZED'` (et `err.data.code === 'UNAUTHORIZED'`).

Les connexions, déconnexions, entrées et sorties de canal sont journalisées : une ligne console au format `[LOG]` et une entrée `SystemLog` (`method: 'WS'`, avec `platform`, `device`, `appVersion` et un `statusCode` : 101 connexion, 200 succès, 401, 403, 404).

Session :
- Le socket est déconnecté par le serveur (`io server disconnect`) à l'expiration (`exp`) du JWT ; le client se reconnecte avec un token rafraîchi.
- Chaque `room:join` / `playlist:join` revérifie la blacklist : un token révoqué (logout) reçoit `{ ok: false, code: 'UNAUTHORIZED' }`.
- Un socket peut être abonné à 50 canaux au plus (salles, playlists, `device:register`, `device:watch`) : au-delà, `{ ok: false, code: 'TOO_MANY_CHANNELS' }`. Le canal personnel `user:<id>`, rejoint automatiquement à la connexion, n'est pas compté.
- Les identifiants envoyés par le client sont tronqués à 64 caractères et débarrassés des retours à la ligne avant journalisation.

## Canaux (client vers serveur, avec ack)

| Événement | Payload | Ack succès | Ack erreur |
|---|---|---|---|
| `room:join` | `{ roomId }` | `{ ok: true }` | `{ ok: false, code }` : `ROOM_FORBIDDEN`, `ROOM_NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `TOO_MANY_CHANNELS` |
| `room:leave` | `{ roomId }` | `{ ok: true }` | `VALIDATION_ERROR` |
| `playlist:join` | `{ playlistId }` | `{ ok: true }` | `PLAYLIST_FORBIDDEN`, `PLAYLIST_NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `TOO_MANY_CHANNELS` |
| `playlist:leave` | `{ playlistId }` | `{ ok: true }` | `VALIDATION_ERROR` |

Une erreur serveur inattendue renvoie `{ ok: false, code: 'INTERNAL_ERROR' }`.

Règles d'accès (identiques à REST) :
- Salle : publique pour tous ; privée pour le propriétaire et les invités (`isUserAllowedInRoom`).
- Playlist : publique pour tous ; privée pour le propriétaire et les invités (`isUserAllowedInPlaylist`).

Canaux internes : `room:<id>`, `playlist:<id>`, `device:<id>` (observateurs d'un appareil), `device-player:<id>` (lecteur de l'appareil) et `user:<id>` (tous les sockets d'un utilisateur).

## Événements (serveur vers client)

### Salles (Track Vote)

| Événement | Payload | Déclencheur REST |
|---|---|---|
| `track:suggested` | `{ roomId, track }` | `POST /api/rooms/:roomId/tracks` |
| `track:removed` | `{ roomId, trackId }` | `DELETE /api/rooms/:roomId/tracks/:trackId` |
| `vote:changed` | `{ roomId, trackId, voteCount }` | `POST` / `DELETE /api/rooms/:roomId/tracks/:trackId/vote` |
| `queue:updated` | `{ roomId, queue }` (file complète, triée par `position`) | toutes les écritures ci-dessus |
| `room:deleted` | `{ roomId }` | `DELETE /api/rooms/:id` |

### Playlists (Playlist Editor)

| Événement | Payload | Déclencheur REST |
|---|---|---|
| `playlist:tracks-updated` | `{ playlistId, tracks }` (liste complète, triée par `position`) | ajout, suppression, réordonnancement de titres |
| `playlist:updated` | `{ playlistId, playlist }` (champs publics uniquement : `id, name, description, visibility, license, coverUrl, version, ownerId, createdAt, updatedAt` ; jamais `inviteCode` ni `invites`) | `PUT /api/playlists/:id` (nom, visibilité, licence...), ajout du premier titre avec pochette |
| `playlist:deleted` | `{ playlistId }` | `DELETE /api/playlists/:id` |

`queue:updated` et `playlist:tracks-updated` relisent l'état en base au moment de la diffusion, en série par canal : le dernier événement reçu reflète le dernier état validé, même quand des écritures concurrentes se terminent dans le désordre. Les clients doivent donc **remplacer** leur état local par le payload reçu.

**Garanties d'ordre par instance uniquement.** Cette sérialisation est locale à chaque instance d'API. Avec plusieurs instances derrière l'adaptateur Redis, deux écritures traitées par des instances différentes peuvent diffuser leurs états dans un ordre quelconque ; un client peut alors recevoir brièvement un état plus ancien. Il doit refaire un `GET` en cas de doute (par exemple à la reconnexion).

Une écriture de playlist qui n'obtient pas le verrou à temps renvoie `503 { error: 'Playlist occupée, réessayez', code: 'PLAYLIST_BUSY' }`.

Les réordonnancements de playlist sont sérialisés côté serveur (verrou consultatif Postgres par playlist) : deux déplacements simultanés s'appliquent l'un après l'autre et tous les clients reçoivent l'ordre final.

## Délégation de contrôle (Music Control Delegation)

La licence est **propre à chaque appareil** : déléguer l'appareil A n'autorise rien sur l'appareil B. Les appareils, amitiés et délégations se gèrent en REST (`/api/devices`, `/api/friends`, `/api/delegations/received`, `/api/users/search`, voir Swagger). Seuls les amis acceptés peuvent être délégués ; le propriétaire contrôle toujours ses propres appareils.

Rôles :
- **Lecteur** : un socket du propriétaire, sur l'appareil qui joue la musique, s'enregistre avec `device:register`. Il reçoit les commandes, les exécute localement et publie son état avec `device:state`.
- **Observateur** : le propriétaire ou un délégué actif s'abonne à l'état avec `device:watch`.
- **Télécommande** : le propriétaire ou un délégué envoie `device:command`.

### Événements client vers serveur (avec ack)

| Événement | Payload | Qui | Ack succès | Ack erreur |
|---|---|---|---|---|
| `device:register` | `{ deviceId }` | propriétaire | `{ ok: true }` | `DEVICE_NOT_FOUND`, `DEVICE_FORBIDDEN`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `TOO_MANY_CHANNELS` |
| `device:unregister` | `{ deviceId }` | lecteur | `{ ok: true }` | `VALIDATION_ERROR` |
| `device:watch` | `{ deviceId }` | propriétaire ou délégué actif | `{ ok: true }` | `DEVICE_NOT_FOUND`, `DELEGATION_FORBIDDEN`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `TOO_MANY_CHANNELS` |
| `device:unwatch` | `{ deviceId }` | observateur | `{ ok: true }` | `VALIDATION_ERROR` |
| `device:command` | `{ deviceId, command, value? }` | propriétaire ou délégué ayant le droit | `{ ok: true }` (relayé au lecteur) | `RATE_LIMITED`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `DEVICE_NOT_FOUND`, `DELEGATION_FORBIDDEN`, `DEVICE_OFFLINE` |
| `device:state` | `{ deviceId, state }` | socket lecteur de l'appareil (enregistré par `device:register`) | `{ ok: true }` (diffusé aux observateurs) | `RATE_LIMITED`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `DEVICE_FORBIDDEN` (socket non enregistré comme lecteur de cet appareil), `DEVICE_NOT_FOUND` |

Commandes et droits requis :

| `command` | `value` | Droit du délégué |
|---|---|---|
| `play`, `pause` | ignoré (`null`) | `canPlayPause` |
| `next`, `previous` | ignoré (`null`) | `canSkip` |
| `setVolume` | nombre de 0 à 100 (requis) | `canVolume` |

Règles :
- **Autorisation relue en base à chaque commande** (appareil, délégation active, droit, amitié acceptée) : une révocation, une modification de droits (`PATCH`), la fin d'une amitié ou la suppression de l'appareil s'appliquent dès la commande suivante.
- `DEVICE_OFFLINE` : aucun socket lecteur n'est enregistré pour l'appareil (sur aucune instance).
- **Limite de débit** : au plus 10 `device:command` par seconde et par socket (fenêtre glissante) ; au-delà, `RATE_LIMITED` et la commande n'est pas relayée. `device:state` a sa propre limite identique (10 par seconde et par socket).
- `device:command` et `device:state` revérifient la blacklist : un token révoqué (logout) reçoit `UNAUTHORIZED`.
- **Ordre** : les commandes d'un même appareil sont vérifiées et relayées dans l'ordre d'arrivée sur l'instance. En cas de commandes simultanées, le lecteur les applique dans cet ordre puis publie son état, que tous les observateurs reçoivent : c'est cet état qui fait foi.
- `state` est un objet libre défini par le client (par exemple `{ playing, trackId, positionMs, volume }`), 8 Ko au plus une fois sérialisé. Le lecteur doit l'envoyer à chaque changement, pas en continu : chaque envoi est journalisé.

### Événements serveur vers client

| Événement | Destinataires | Payload |
|---|---|---|
| `device:command` | sockets lecteurs de l'appareil (`device-player:<id>`) | `{ deviceId, command, value, from: { id, name } }` |
| `device:state` | observateurs (`device:<id>`) | `{ deviceId, state, at }` (`at` : date ISO du serveur) |
| `delegation:updated` | tous les sockets du délégué (`user:<id>`) | `{ deviceId, rights: { canPlayPause, canSkip, canVolume }, active }`, envoyé à l'octroi (`POST /api/devices/:id/delegations`, y compris mise à jour et réactivation) et à la modification des droits (`PATCH`) |
| `device:revoked` | tous les sockets du délégué (`user:<id>`) | `{ deviceId, reason }` avec `reason` : `REVOKED`, `UNFRIENDED` ou `DEVICE_DELETED` |

## Révocation

- Retrait d'une invitation (`DELETE /api/rooms/:id/invites/:userId`) : si l'utilisateur n'a plus accès à la salle (salle privée), ses sockets quittent le canal et ne reçoivent plus rien. Sur une salle publique, il garde l'accès et reste abonné.
- Retrait d'une invitation à une playlist (`DELETE /api/playlists/:id/invites/:userId`) : même règle, sur une playlist privée les sockets de l'utilisateur révoqué quittent le canal.
- Suppression d'une salle ou d'une playlist : `room:deleted` / `playlist:deleted` est envoyé puis tous les sockets quittent le canal.
- Passage d'une playlist en privé : les sockets des utilisateurs qui ne sont ni propriétaire ni invités quittent le canal **avant** la diffusion de `playlist:updated`.
- Un échec d'éviction (Redis indisponible...) est journalisé mais ne transforme jamais une écriture validée en erreur 500.
- L'accès est revérifié juste après l'entrée dans un canal, pour couvrir une révocation concurrente.
- Révocation d'une délégation (`DELETE /api/devices/:id/delegations/:userId`) ou fin d'amitié (`DELETE /api/friends/:userId`, qui supprime les délégations dans les deux sens) : les sockets du délégué quittent `device:<id>` (plus aucun `device:state`), puis reçoivent `device:revoked`. Leur commande suivante est refusée (`DELEGATION_FORBIDDEN`).
- Suppression d'un appareil (`DELETE /api/devices/:id`) : tous les sockets quittent `device:<id>` et `device-player:<id>`, et chaque délégué dont la délégation était active reçoit `device:revoked { reason: 'DEVICE_DELETED' }`.
