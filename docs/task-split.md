# Répartition des tâches — Music Room (3 personnes)

> Basé sur le sujet officiel v2. Chaque personne gère une **tranche verticale complète** (backend + mobile) pour limiter les dépendances bloquantes.

---

## 👤 Personne 1 — Auth + Sécurité + Infrastructure

### Backend
- [x] Architecture Express (structure modulaire, Prisma ORM, connexion PostgreSQL/Redis)
- [x] Module `auth`
  - [x] Inscription / Connexion email + mot de passe
  - [x] OAuth2 : Google
  - [x] JWT (access token court + refresh token)
  - [x] Blacklist de tokens dans Redis
- [x] Module `users` — profil, préférences, données publiques/privées
- [x] **Sécurité obligatoire**
  - [x] Rate limiting sur les endpoints sensibles (bruteforce)
  - [x] Guards/middlewares JWT sur toutes les routes protégées
  - [x] Validation des inputs & gestion d'erreurs
- [x] **Logs obligatoires** pour chaque action : plateforme, appareil, version de l'app (console + table `SystemLog`)
- [x] Documentation **Swagger / OpenAPI** (/api-docs et /api-docs.json)

### Mobile
- [x] Navigation globale (Expo Router — Tabs + Auth Stack)
- [x] Écran Login / Register avec validation email
- [x] Connexion OAuth (Google)
- [x] Écran profil utilisateur (public, amis, privé, préférences musicales, liaison OAuth Google)
- [x] **Adresse du backend configurable** dans l'app (modal sur login et profil + `useApiConfig`)

### Priorité
> ✅ **Terminé** — Authentification, sécurité, logs et configuration mobile opérationnels.

---

## 👤 Personne 2 — Music Track Vote (temps réel)

### Backend
- [ ] Module `rooms` — création de salles, gestion visibilité **public/privé**
  - [ ] Événement public → tous les utilisateurs peuvent voter
  - [ ] Événement privé → uniquement les utilisateurs invités
- [ ] Module `tracks` — suggestions de titres, file de lecture
- [ ] **Système de vote**
  - [ ] Vote pour un titre → monte dans la liste
  - [ ] Gestion des **conflits** (plusieurs votes simultanés sur le même titre ou différents)
- [ ] **Gestion des licences**
  - [ ] Par défaut : tout le monde peut voter
  - [ ] Licence avancée : seuls les invités votent
  - [ ] Licence avancée : restriction par lieu / plage horaire
- [ ] **WebSocket Gateway** (Socket.IO) — diffusion des votes en temps réel
- [ ] Redis Pub/Sub — synchronisation entre utilisateurs

### Mobile
- [ ] Écran création d'un événement (nom, visibilité, licence)
- [ ] Écran rejoindre un événement (liste des publics + code privé)
- [ ] Écran vote en temps réel (liste des titres, bouton vote, mise à jour instantanée)
- [ ] Client WebSocket

---

## 👤 Personne 3 — Music Playlist Editor + Tests de charge

### Backend
- [x] Intégration **Spotify API** (ou Deezer) — recherche de titres, métadonnées
- [x] Module `playlists` — création de playlists collaboratives / stations radio
  - [x] Visibilité **public/privé**
    - [x] Publique : tout utilisateur y a accès
    - [x] Privée : uniquement les invités
  - [x] **Gestion des licences**
    - [x] Par défaut : tout le monde peut éditer
    - [x] Licence avancée : seuls les invités peuvent éditer
  - [x] Gestion des **conflits** (déplacement simultané de titres)
- [ ] WebSocket Gateway — propagation des modifications en temps réel

### Mobile
- [x] Écran recherche de titres (via Spotify/Deezer)
- [x] Écran liste de playlists (publiques + privées invité)
- [x] Écran éditeur collaboratif (drag & drop, ajout/suppression de titres)
- [ ] Mises à jour temps réel via WebSocket

### Tests de charge (obligatoires)
- [ ] Script **k6** (ou Apache Benchmark) pour les 3 services simultanément
- [ ] Mesure du nombre maximum d'utilisateurs simultanés
- [ ] Documentation des specs serveur (CPU, RAM, type d'hébergement)

---

## Tâches communes (à se partager)

| Tâche | Responsable suggéré |
|-------|---------------------|
| Setup Docker Compose | ✅ Fait |
| `.env` / `.env.example` | ✅ Fait |
| Makefile | ✅ Fait |
| Schéma Prisma (BDD) | Personne 1 (base) + chacun ajoute ses tables |
| Swagger (documentation) | Personne 1 bootstrap, chacun documente ses routes |
| README final | Tout le monde |

---

## Ordre de développement recommandé

```
Semaine 1    → Personne 1 livre : Auth + JWT + structure NestJS
Semaine 2    → Personnes 2 & 3 développent leurs features en parallèle
Semaine 3    → Intégration + tests de charge + polish mobile
```

---

## Récapitulatif

|  | Personne 1 | Personne 2 | Personne 3 |
|--|--|--|--|
| **Feature** | Auth + Sécurité | Music Track Vote | Music Playlist Editor |
| **Backend** | auth, users, logs | rooms, tracks, vote | playlists, spotify |
| **Mobile** | Login, profil, OAuth | Vote UI, rooms | Playlist editor |
| **Temps réel** | ❌ | ✅ WebSocket | ✅ WebSocket |
| **Spécifique** | Swagger, Rate limit | Licences, conflits vote | Licences, conflits playlist |
| **Tests** | ❌ | ❌ | ✅ k6 load tests |
