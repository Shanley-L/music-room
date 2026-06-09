
# Utilisation de l'API Deezer

Ce document résume comment utiliser l'API Deezer depuis le backend `Api/` du projet, afin d'alimenter le front Expo avec des données musicales.

## Objectif

L'API Deezer permet de :

- rechercher des artistes, albums, playlists ou titres,
- récupérer les métadonnées d'un morceau,
- afficher des suggestions ou des résultats de recherche,
- déléguer au backend les appels externes pour éviter d'exposer la logique côté front.

Dans ce projet, le backend peut exposer une route interne comme `/discover` qui interroge Deezer, formate la réponse, puis renvoie au frontend uniquement les champs utiles.

## Exemples d'usages concrets

L'idée n'est pas de montrer une URL seule, mais un vrai flux avec :

- une fonction backend qui appelle Deezer,
- une route Express qui l'expose,
- une fonction front qui consomme cette route.

### 1. Fonction backend qui interroge Deezer

Exemple de fonction utilitaire côté API :

```js
async function searchDeezer(query) {
  const response = await fetch(
    `https://api.deezer.com/search?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error('Erreur Deezer');
  }

  const data = await response.json();

  return data.data.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist?.name,
    album: track.album?.title,
    preview: track.preview,
  }));
}
```

### 2. Route Express `/discover`

Exemple de route backend plus réaliste :

```js
app.get('/discover', async (req, res) => {
  try {
    const query = req.query.q || '';

    if (!query) {
      return res.status(400).json({
        error: 'Le paramètre q est obligatoire',
        results: [],
      });
    }

    const results = await searchDeezer(query);

    return res.json({
      query,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Impossible de récupérer les résultats Deezer',
      results: [],
    });
  }
});
```

### 3. Fonction front qui appelle votre API

Exemple côté Expo / React Native :

```ts
export async function discoverTracks(query: string) {
  const response = await fetch(
    `http://localhost:3000/discover?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error('Impossible de charger les morceaux');
  }

  return response.json();
}
```

### 4. Utilisation dans un composant front

```tsx
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

export default function HomeScreen() {
  const [results, setResults] = useState([]);

  useEffect(() => {
    async function load() {
      const data = await discoverTracks('daft punk');
      setResults(data.results);
    }

    load();
  }, []);

  return (
    <View>
      {results.map((track) => (
        <Text key={track.id}>{track.title}</Text>
      ))}
    </View>
  );
}
```

### 5. Réponse attendue côté front

Avec les fonctions ci-dessus, le front reçoit un format simple et stable :

```json
{
  "query": "daft punk",
  "results": [
    {
      "id": 3135556,
      "title": "Harder, Better, Faster, Stronger",
      "artist": "Daft Punk",
      "album": "Discovery",
      "preview": "https://..."
    }
  ]
}
```

## Exemple MVC pour `discover`

Si vous voulez structurer proprement la route `discover`, vous pouvez la penser en MVC.

### Model

Le model contient la logique de données et l'appel à Deezer.

```js
// model/deezerModel.js
export async function searchDeezer(query) {
  const response = await fetch(
    `https://api.deezer.com/search?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error('Erreur Deezer');
  }

  const data = await response.json();

  return data.data.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist?.name,
    album: track.album?.title,
    preview: track.preview,
  }));
}
```

### Controller

Le controller reçoit la requête HTTP, appelle le model et renvoie la réponse.

```js
// controller/discoverController.js
import { searchDeezer } from '../model/deezerModel.js';

export async function discover(req, res) {
  try {
    const query = req.query.q || '';

    if (!query) {
      return res.status(400).json({
        error: 'Le paramètre q est obligatoire',
        results: [],
      });
    }

    const results = await searchDeezer(query);

    return res.json({
      query,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Impossible de récupérer les résultats Deezer',
      results: [],
    });
  }
}
```

### View

La view correspond ici à l'écran front qui affiche les morceaux.

```tsx
// example de view côté front
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

export default function DiscoverScreen() {
  const [results, setResults] = useState([]);

  useEffect(() => {
    async function load() {
      const response = await fetch('http://localhost:3000/discover?q=daft%20punk');
      const data = await response.json();
      setResults(data.results);
    }

    load();
  }, []);

  return (
    <View>
      {results.map((track) => (
        <Text key={track.id}>{track.title}</Text>
      ))}
    </View>
  );
}
```

### Flux MVC

1. La view appelle `/discover?q=daft punk`.
2. Le controller lit `req.query.q`.
3. Le model appelle Deezer.
4. Le controller renvoie un JSON simple.
5. La view affiche les résultats.

## Pourquoi passer par votre backend

Ce schéma est utile parce que le front ne dépend pas directement de Deezer.

- Le front appelle une route locale simple.
- Le backend gère la logique d'appel à Deezer.
- La réponse est normalisée avant d'être affichée.
- Vous pouvez ajouter un cache, des logs et des filtres sans toucher au front.

## Exemple concret pour votre route `/discover`

Aujourd'hui, votre route ressemble à ceci :

```js
app.get('/discover', (req, res) => res.json({
    
}));
```

Cette version renvoie simplement un objet vide. Elle ne teste pas Deezer et ne fournit aucune donnée utile au front.

Pour que l'exemple soit concret, la route doit au minimum renvoyer quelque chose de lisible par le front, par exemple :

```json
{
  "query": "daft punk",
  "results": [
    {
      "id": 3135556,
      "title": "Harder, Better, Faster, Stronger",
      "artist": "Daft Punk",
      "album": "Discovery",
      "preview": "https://..."
    }
  ]
}
```

Dans la doc, c'est ce type de réponse qu'il faut viser : un objet avec une requête, une liste de résultats, puis quelques champs simples à afficher côté front.

## Point d'entrée Deezer

Deezer expose une API REST publique. La documentation officielle est disponible ici :

- https://developers.deezer.com/api

L'API est accessible sans clé pour de nombreux endpoints publics, mais il faut respecter les limites d'usage et les contraintes de CORS/proxy selon le contexte.

## Endpoints utiles

### Recherche

Exemple de requête HTTP explicite pour une recherche globale :

```bash
curl "https://api.deezer.com/search?q=artist:Daft%20Punk"
```

Exemple pour une recherche de titres :

```bash
curl "https://api.deezer.com/search/track?q=around%20the%20world"
```

Exemple pour une recherche d'artistes :

```bash
curl "https://api.deezer.com/search/artist?q=madonna"
```

### Récupération de détails

Détail d'un morceau :

```http
GET https://api.deezer.com/track/{id}
```

Détail d'un album :

```http
GET https://api.deezer.com/album/{id}
```

Détail d'un artiste :

```http
GET https://api.deezer.com/artist/{id}
```

### Top / suggestions

Selon le besoin, Deezer expose aussi des routes de découverte ou de classement, par exemple :

- top tracks,
- top albums,
- radios,
- playlists publiques.

## Format de réponse

Les réponses Deezer sont généralement au format JSON et contiennent des champs comme :

- `id`
- `title`
- `name`
- `link`
- `preview`
- `duration`
- `artist`
- `album`
- `cover`
- `cover_medium`
- `cover_big`

Exemple simplifié d'un résultat de recherche :

```json
{
  "id": 3135556,
  "title": "Harder, Better, Faster, Stronger",
  "artist": {
    "id": 27,
    "name": "Daft Punk"
  },
  "album": {
    "id": 302127,
    "title": "Discovery"
  },
  "preview": "https://cdns-preview..."
}
```

## Utilisation recommandée côté backend

Il est préférable de ne pas appeler Deezer directement depuis le front si vous voulez :

- centraliser la logique métier,
- limiter les variations de format,
- ajouter un cache,
- gérer les erreurs proprement,
- préparer une future base de données locale.

Le backend peut faire office de proxy métier :

1. le front appelle `/discover?q=daft punk`,
2. le backend interroge Deezer,
3. le backend filtre et renvoie seulement les données utiles.

## Exemple de flux d'intégration

### 1. Front

Le frontend appelle votre API locale :

```http
GET /discover?q=daft%20punk
```

### 2. Backend

Le backend appelle Deezer avec une vraie requête HTTP :

```bash
curl "https://api.deezer.com/search?q=daft%20punk"
```

### 3. Réponse renvoyée au front

Le backend renvoie un JSON simplifié, par exemple :

```json
{
  "query": "daft punk",
  "results": [
    {
      "id": 3135556,
      "title": "Harder, Better, Faster, Stronger",
      "artist": "Daft Punk",
      "album": "Discovery",
      "preview": "https://..."
    }
  ]
}
```

## Exemple de cas d'usage complet

### Cas 1: recherche simple

Appel depuis le front :

```http
GET /discover?q=daft%20punk
```

Le backend peut ensuite transformer cette requête en appel Deezer comme :

```bash
curl "https://api.deezer.com/search?q=daft%20punk"
```

Réponse attendue :

```json
{
  "query": "daft punk",
  "results": [
    {
      "id": 3135556,
      "title": "Harder, Better, Faster, Stronger",
      "artist": "Daft Punk",
      "album": "Discovery",
      "preview": "https://cdns-preview..."
    },
    {
      "id": 3021274,
      "title": "One More Time",
      "artist": "Daft Punk",
      "album": "Discovery",
      "preview": "https://cdns-preview..."
    }
  ]
}
```

### Cas 2: aucun résultat

```json
{
  "query": "mot qui n'existe pas",
  "results": []
}
```

### Cas 3: erreur Deezer

```json
{
  "error": "Impossible de récupérer les résultats Deezer"
}
```

Ces exemples sont utiles pour construire l'interface front avant même d'avoir branché Deezer.

## Bonnes pratiques

- Garder la réponse backend la plus simple possible.
- Normaliser les champs avant de les envoyer au front.
- Gérer les cas où Deezer renvoie une liste vide.
- Prévoir un message d'erreur clair si Deezer est indisponible.
- Ajouter un cache si les mêmes requêtes reviennent souvent.
- Éviter les appels trop fréquents depuis l'interface utilisateur.

## Variables d'environnement

Si vous utilisez une configuration locale, vous pouvez garder :

```env
PORT=3000
CORS_ORIGIN=http://localhost:19006
```

Pour Deezer, il n'y a généralement pas de secret nécessaire pour les endpoints publics, mais vous pouvez conserver une config dédiée si vous ajoutez d'autres services.

## Points d'attention

- Certaines plateformes limitent les requêtes directes côté navigateur ; le backend est souvent plus fiable.
- Vérifiez que votre front et votre backend utilisent la bonne URL selon l'environnement :
  - `localhost` en local,
  - IP locale sur appareil réel,
  - domaine en production.
- Si vous ajoutez de l'authentification ou des endpoints privés, documentez-les séparément.

## Références utiles

- Deezer API: https://developers.deezer.com/api
- Deezer search docs: https://developers.deezer.com/api/search

## Prochaine étape suggérée

Créer une petite couche `service` dans le backend pour :

- appeler Deezer,
- transformer les résultats,
- exposer une route stable au frontend.

