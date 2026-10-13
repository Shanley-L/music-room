# Répartition des tâches — Music Room (3 personnes)

> Basé sur le sujet officiel **v6** (`docs/subject.txt`). Statuts mis à jour le 2026-10-13 d'après le code.
> Chaque personne gère une **tranche verticale complète** (backend + mobile).
> Les **trois services** sont implémentés (le sujet en exige au moins deux).

---

## 👤 Personne 1 — Auth + Sécurité + Infrastructure

### Backend
- [x] Architecture Express (routes / controllers / services, Prisma, PostgreSQL, Redis)
- [x] Module `auth`
  - [x] Inscription / connexion email + mot de passe, validation de l'email, mot de passe oublié
  - [x] Google : connexion et liaison d'un compte existant (vérification du jeton ID et de l'audience)
  - [x] JWT (access court + refresh avec rotation), blacklist Redis à la déconnexion
- [x] Module `users` : profil public / amis / privé, préférences musicales, recherche
- [x] Sécurité (V.6) : rate limiting, guards JWT, validation zod, isolation des données, note `docs/SECURITY.md`
- [x] Logs de chaque action (REST et WebSocket) : plateforme, appareil, version (console + `SystemLog`)
- [x] Swagger / OpenAPI (`/api-docs`, `/api-docs.json`)

### Mobile
- [x] Navigation (Expo Router : onglets + pile d'auth)
- [x] Login / Register avec validation email
- [x] Connexion et liaison Google
- [x] Profil (public, amis, privé, préférences)
- [x] Adresse du backend configurable

---

## 👤 Personne 2 — Music Track Vote (temps réel)

### Backend
- [x] Module `rooms` : création, visibilité public/privé, invitations, code d'invitation, mes salles, suppression
- [x] Module `tracks` : suggestions, file de lecture
- [x] Vote atomique sérialisé par salle (votes simultanés sur le même titre ou des titres différents)
- [x] Licences : tout le monde / invités seulement / lieu + plage horaire
- [x] Socket.IO : `queue:updated`, `track:suggested`, `vote:changed`, révocations
- [x] Adaptateur Redis (Pub/Sub entre instances)
- [x] Lecture synchronisée de la salle (`/playback/*`, `playback:updated`), rôles et permissions (`myRole`, `permissions`), `PATCH /api/rooms/:id` (`room:updated`)

### Mobile
- [x] Création d'un événement (nom, visibilité, licence, zone et horaires)
- [x] Rejoindre un événement (publics, code privé, mes salles)
- [x] Vote en temps réel (file, voter / retirer, suggestion via Deezer)
- [x] Client WebSocket partagé (`SocketContext`)
- [x] Salle live : « en cours » synchronisé, contrôles propriétaire, section gestion, badge de rôle

---

## 👤 Personne 3 — Music Playlist Editor + Control Delegation + Tests de charge

### Backend
- [x] Intégration Deezer (recherche, découverte)
- [x] Module `playlists` : visibilité, licence d'édition, invitations, code d'invitation
- [x] Conflits de déplacement (verrou consultatif par playlist, l'état serveur fait foi)
- [x] Socket.IO : `playlist:tracks-updated`, `playlist:updated`, révocations
- [x] Appareils, amis, délégations par appareil (droits play/pause, skip, volume), relais des commandes par socket

### Mobile
- [x] Recherche de titres, liste de playlists, éditeur collaboratif (drag & drop) en temps réel
- [x] Écrans appareils, amis, télécommande ; exécution des commandes sur l'appareil propriétaire

### Tests de charge (V.7)
- [x] Scripts k6 pour les 3 services en parallèle, REST + WebSocket (`load/`)
- [x] Mesure du nombre maximal d'utilisateurs simultanés et des goulots d'étranglement
- [x] Specs machine et justification (`docs/LOAD_TESTING.md`)

---

## Tâches communes

| Tâche | Statut |
|-------|--------|
| Docker Compose, ports configurables | ✅ |
| `.env.example` (API et App), secrets hors git | ✅ |
| Makefile (`up`, `test`, `test-db`, `load`, `load-api`) | ✅ |
| Tests API automatisés (`npm test`) | ✅ |
| CI GitHub Actions (tests API + typecheck App) | ✅ |
| README racine (architecture, choix, lancement) | ✅ |
| Note de sécurité | ✅ `docs/SECURITY.md` |

---

## Hors périmètre (volontairement)

Les bonus (VI) ne sont pas réalisés : le sujet ne les évalue que si la partie obligatoire est parfaite.
- Support web responsive (VI.1)
- IoT / iBeacon (VI.2)
- Abonnement gratuit / payant (VI.3)
- Mode hors ligne et synchronisation (VI.4)

Connexion Facebook : non implémentée, Google suffit (« Facebook ou Google »).
