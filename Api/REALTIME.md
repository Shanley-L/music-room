# Temps réel (Socket.IO)

Le serveur Socket.IO est attaché au même serveur HTTP que l'API (même port, chemin par défaut `/socket.io`).

- **REST reste le seul chemin d'écriture.** Les sockets servent uniquement à s'abonner et à recevoir des diffusions.
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
- Un socket peut être abonné à 50 canaux au plus : au-delà, `{ ok: false, code: 'TOO_MANY_CHANNELS' }`.
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

Canaux internes : `room:<id>` et `playlist:<id>`.

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

## Révocation

- Retrait d'une invitation (`DELETE /api/rooms/:id/invites/:userId`) : si l'utilisateur n'a plus accès à la salle (salle privée), ses sockets quittent le canal et ne reçoivent plus rien. Sur une salle publique, il garde l'accès et reste abonné.
- Suppression d'une salle ou d'une playlist : `room:deleted` / `playlist:deleted` est envoyé puis tous les sockets quittent le canal.
- Passage d'une playlist en privé : les sockets des utilisateurs qui ne sont ni propriétaire ni invités quittent le canal **avant** la diffusion de `playlist:updated`.
- Un échec d'éviction (Redis indisponible...) est journalisé mais ne transforme jamais une écriture validée en erreur 500.
- L'accès est revérifié juste après l'entrée dans un canal, pour couvrir une révocation concurrente.
