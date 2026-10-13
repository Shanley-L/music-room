import 'dotenv/config';
import bcrypt from '../Api/node_modules/bcryptjs/index.js';
import jwt from '../Api/node_modules/jsonwebtoken/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../Api/src/lib/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupBenchmarkData() {
  console.log('[Setup] Initialisation des données pour les tests de charge...');

  const email = 'benchmark@musicroom.test';
  const rawPassword = 'Benchmark123!';
  const hashedPassword = await bcrypt.hash(rawPassword, 10);

  // 1. Ensure benchmark user exists
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: 'Benchmark Tester',
        isEmailVerified: true,
        musicPreferences: JSON.stringify(['Electro', 'Rock', 'Jazz']),
      },
    });
    console.log(`[Setup] Utilisateur de test créé: ${user.email} (${user.id})`);
  } else {
    // Make sure verified and password matches
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        password: hashedPassword,
      },
    });
    console.log(`[Setup] Utilisateur de test mis à jour: ${user.email} (${user.id})`);
  }

  // 2. Generate valid JWT tokens
  const jwtSecret = process.env.JWT_SECRET || 'music-room-super-secret-jwt-key-2026';
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || 'music-room-super-secret-refresh-key-2026';

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email },
    jwtSecret,
    { expiresIn: '1h' }
  );

  const refreshToken = jwt.sign(
    { sub: user.id, email: user.email },
    jwtRefreshSecret,
    { expiresIn: '7d' }
  );

  // Store refresh token in DB so /api/auth/refresh works
  await prisma.refreshToken.upsert({
    where: { token: refreshToken },
    create: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: { revoked: false },
  });

  // 3. Ensure a public playlist exists
  let playlist = await prisma.playlist.findFirst({
    where: { visibility: 'PUBLIC' },
    include: { tracks: true },
  });

  if (!playlist) {
    playlist = await prisma.playlist.create({
      data: {
        name: 'Benchmark Live Playlist',
        description: 'Playlist utilisée pour les tests de charge k6',
        visibility: 'PUBLIC',
        license: 'EVERYONE',
        ownerId: user.id,
      },
      include: { tracks: true },
    });
    console.log(`[Setup] Playlist de benchmark créée: ${playlist.id}`);
  }

  // Ensure playlist has at least 1 track
  if (playlist.tracks.length === 0) {
    await prisma.playlistTrack.create({
      data: {
        playlistId: playlist.id,
        externalId: '12345678',
        title: 'One More Time',
        artist: 'Daft Punk',
        album: 'Discovery',
        position: 1,
        addedBy: user.id,
      },
    });
  }

  // 4. Ensure a public room exists (Personne 2 Track Vote)
  let room = await prisma.room.findFirst({
    where: { visibility: 'PUBLIC' },
  });

  if (!room) {
    room = await prisma.room.create({
      data: {
        name: 'Benchmark Live Room',
        visibility: 'PUBLIC',
        license: 'EVERYONE',
        ownerId: user.id,
      },
    });
    console.log(`[Setup] Salle de benchmark créée: ${room.id}`);
  }

  const config = {
    apiUrl: process.env.API_URL || 'http://localhost:3000',
    email,
    password: rawPassword,
    userId: user.id,
    accessToken,
    refreshToken,
    playlistId: playlist.id,
    roomId: room.id,
  };

  const configPath = path.join(__dirname, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[Setup] Fichier de configuration généré avec succès dans: ${configPath}`);

  return config;
}

setupBenchmarkData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Setup Error]', err);
    process.exit(1);
  });
