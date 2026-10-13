# Music Room — Rapport des Tests de Charge & Montée en Charge (Ramp-up)

> **Référence Sujet :** Chapitre V.7 (*Ramp-up*) & Personne 3 (*Tests de charge*).  
> **Date d'exécution :** 13 Octobre 2026  
> **Outils utilisés :** Grafana **k6** v2.3.0, **Autocannon** v8.0.0, **Apache Benchmark** (ab).

---

## 1. Caractéristiques de l'Environnement Serveur

Conformément aux exigences du sujet, voici les spécifications techniques de la machine et de l'infrastructure hébergeant l'API et les bases de données :

| Composant | Spécification |
| :--- | :--- |
| **Type d'hébergement** | On-Premise (Workstation 42 School) |
| **Processeur (CPU)** | Intel® Core™ i7-12700 (12 cœurs / 20 threads, jusqu'à 4.90 GHz) |
| **Mémoire Vive (RAM)** | 16 Go DDR4 (15 GiB disponible) |
| **Système d'exploitation** | Linux x86_64 (Noyau 7.1.10 preempt dynamic) |
| **Conteneurisation** | Podman 5 / Docker Compose |
| **Serveur d'application** | Node.js v22.x (Express 5 + Prisma ORM 7) |
| **Base de données relationnelle**| PostgreSQL 16 Alpine (`postgres:16-alpine`) |
| **Cache & In-Memory Store** | Redis 7 Alpine (`redis:7-alpine`) |
| **Passerelle WebSocket** | Socket.IO v4.8 |

---

## 2. Méthodologie de Test & Scénario Multi-Services

Le script k6 ([load-tests/k6-script.js](file:///home/jileroux/Documents/music-room/load-tests/k6-script.js)) simule le trafic réel d'utilisateurs concurrents interagissant simultanément avec les **3 services obligatoires** de l'application :

1. **Service 1 : Authentification & Profil Utilisateur (Personne 1)**
   - Requête récurrente : `GET /api/users/me` avec JWT Bearer token valide (vérification en base et cache Redis).
   - Requête ponctuelle : `POST /api/auth/login` (validation bcrypt et émission de tokens).
2. **Service 2 : Music Playlist Editor (Personne 3)**
   - Consultation du flux : `GET /api/playlists` (récupération des playlists publiques).
   - Accès détaillé : `GET /api/playlists/:id` (récupération de la playlist collaborative et de ses pistes).
3. **Service 3 : Tracks, Salles & Découverte Musicale (Personne 2 & 3)**
   - Liste des salles publiques pour le vote : `GET /api/rooms/public`.
   - Recherche de musique catalogue Deezer : `GET /api/deezer/search?q=...`.

### Profil de montée en charge (Stages k6) :
- **0s à 10s :** Ramp-up progressif de 0 à 20 Virtual Users (VUs).
- **10s à 30s :** Charge nominale stable à 50 VUs simultanés.
- **30s à 50s :** Montée en charge à 100 VUs simultanés.
- **50s à 70s :** Pic de stress maximal à 150 VUs simultanés.
- **70s à 80s :** Descente progressive (ramp-down) à 0 VU.

---

## 3. Résultats Mesurés & Métriques Détaillées

### A. Résultats Globaux k6

```
     scenarios: (100.00%) 1 scenario, 150 max VUs, 1m20s duration
     checks_total.......: 37,906 (100.00% de réussite)
     checks_failed......: 0 (0.00% d'échec)
     http_reqs..........: 21,028 requêtes
     http_req_failed....: 0.00% (0 erreur HTTP)
     throughput.........: 259.4 requêtes / seconde (moyenne sur le scénario complet)
     données transférées: 57 Mo reçus / 7.3 Mo envoyés
```

### B. Temps de Réponse (Latence)

| Métrique | Moyenne | Médiane (p50) | 90ème percentile (p90) | 95ème percentile (p95) | 99ème percentile (p99) | SLA Sujet |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Toutes requêtes HTTP** | **50.30 ms** | **30.73 ms** | **129.16 ms** | **177.63 ms** | **266.19 ms** | ✅ < 500 ms |
| **Service 1 (Auth / Profil)** | 42.38 ms | 13.14 ms | 117.48 ms | 173.90 ms | 240.50 ms | ✅ < 400 ms |
| **Service 2 (Playlists)** | 45.10 ms | 13.68 ms | 134.98 ms | 190.00 ms | 258.10 ms | ✅ < 300 ms |
| **Service 3 (Search & Salles)**| 59.72 ms | 48.05 ms | 131.33 ms | 166.28 ms | 280.12 ms | ✅ < 600 ms |

### C. Débit Maximal par Service (Benchmark Autocannon — 50 connexions persistantes)

| Endpoint | Débit Max (Req/Sec) | Latence Moyenne | Latence p99 | Taux d'Erreur |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/users/me` (Profil) | **1 443.5 req/s** | 34.08 ms | 46.0 ms | **0.00%** |
| `GET /api/playlists` (Playlists) | **1 745.5 req/s** | 28.12 ms | 36.0 ms | **0.00%** |
| `GET /api/rooms/public` (Salles) | **1 231.8 req/s** | 40.02 ms | 52.0 ms | **0.00%** |

---

## 4. Analyse de Capacité & Justification du Nombre d'Utilisateurs Simultanés

### Capacité Mesurée sur l'Instance Unique
- **Utilisateurs simultanés actifs (VUs k6) :** **150 utilisateurs virtuels** effectuant des requêtes en continu sans aucun échec ni timeout (0.00% de requêtes échouées).
- **Débit maximal mesuré :** **~1 745 requêtes par seconde** sur un conteneur unique Node.js.
- **Utilisation réelle :** Dans une utilisation humaine classique (où un utilisateur effectue une action toutes les 3 à 5 secondes), un débit de **1 500 req/s** permet de supporter confortablement entre **4 500 et 7 500 utilisateurs actifs simultanés** sur un serveur dédié équivalent (12 cœurs, 16 Go RAM).

### Identification des Bottlenecks Potentiels
1. **CPU & Hashing de mot de passe (`bcryptjs`) :**
   - Le calcul de hash (`bcrypt.hash` / `bcrypt.compare`) est bloquant pour l'Event Loop Node.js.
   - *Protection mise en place :* Utilisation de JWT courts (15 min) et rafraîchissement transparent en mémoire pour que 99% des requêtes n'aient pas à ré-exécuter de calcul bcrypt.
2. **Pool de connexions PostgreSQL (Prisma ORM) :**
   - Par défaut, Prisma limite la taille du pool (`num_physical_cpus * 2 + 1` = environ 25 connexions). Au-delà de 200 connexions concurrentes directes, les requêtes SQL se mettent en file d'attente.
3. **Mise en cache Redis :**
   - L'utilisation de Redis pour la vérification rapide de blacklist des tokens et les sessions temps réel allège drastiquement la charge sur la base de données PostgreSQL.

---

## 5. Recommandations d'Architecture pour la Mise à l'Échelle (Scaling)

Pour passer d'une instance unique à un déploiement cloud à très haute échelle (dizaines de milliers d'utilisateurs simultanés) :

1. **Scaling Horizontal (Stateless API) :**
   - Multiplier les instances du conteneur API derrière un reverse-proxy équilibreur de charge (Nginx, Traefik ou HAProxy avec algorithme *round-robin* ou *least-connections*).
2. **Connection Pooling BDD (PgBouncer) :**
   - Intercaler PgBouncer entre les instances Node.js et PostgreSQL pour mutualiser des milliers de connexions clientes sur un pool restreint de connexions serveur.
3. **Redis Pub/Sub & Cluster Socket.IO :**
   - Activer `@socket.io/redis-adapter` pour synchroniser les événements WebSocket entre plusieurs nœuds d'API lors de l'édition collaborative de playlists ou du vote en direct.
4. **Réplicas de Lecture (Read Replicas) :**
   - Séparer les lectures (consultation de playlists et de profils) vers des réplicas PostgreSQL en lecture seule, en réservant le master pour les écritures (votes, ajouts de pistes).

---

## 6. Commandes pour Reproduire les Benchmarks

Les scripts sont directement intégrés au projet et exécutables via le `Makefile` ou en ligne de commande :

```bash
# 1. Test k6 complet (scénario multi-services avec montée en charge)
make test-load-k6
# ou directement :
./load-tests/run-k6.sh

# 2. Benchmark Autocannon (mesure précise de débit et percentiles)
make test-load-autocannon
# ou :
node load-tests/autocannon-suite.js

# 3. Apache Benchmark (test de concurrence HTTP rapide)
make test-load-ab
# ou :
./load-tests/ab-test.sh
```
