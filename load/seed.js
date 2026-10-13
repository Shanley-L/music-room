#!/usr/bin/env node
// Seeds the load-test users straight into the TEST database and writes their JWTs
// to load/.tokens.json (git-ignored). No email flow, no password hashing.
//
//   node load/seed.js [users=2000] [pairs=500]      seed (wipes the test database first)
//   node load/seed.js clean                         wipe the load data only
//
// Safeguards (same rule as Api/test/helpers.js): the script only ever connects to
// TEST_DATABASE_URL from Api/.env and refuses to run without it or in production.

import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '../Api');
const require = createRequire(path.join(apiDir, 'package.json'));

require('dotenv').config({ path: path.join(apiDir, '.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL is not set (Api/.env): refusing to seed, the script wipes the database.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('NODE_ENV=production: refusing to seed.');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const jwt = require('jsonwebtoken');
const { default: prisma } = await import(path.join(apiDir, 'src/lib/prisma.js'));

const EMAIL_DOMAIN = 'load.local';
const TOKENS_FILE = path.join(here, '.tokens.json');
// Long enough for a full run: sockets are disconnected by the server at `exp`.
const TOKEN_TTL = process.env.LOAD_TOKEN_TTL || '6h';

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('JWT_SECRET is not set (Api/.env).');
  process.exit(1);
}

function tokenFor(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name, jti: randomUUID() }, secret, {
    expiresIn: TOKEN_TTL,
  });
}

async function wipe() {
  // Same tables as Api/test/helpers.js resetDb(): the test database is disposable.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ControlDelegation", "Device", "Friendship", "Vote", "Track", "RoomInvite", "Room", "PlaylistTrack", "PlaylistInvite", "Playlist", "RefreshToken", "SystemLog", "User" RESTART IDENTITY CASCADE'
  );
}

async function createUsers(prefix, count) {
  const data = Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i).padStart(6, '0')}${randomUUID().slice(0, 8)}`,
    email: `${prefix}${i}@${EMAIL_DOMAIN}`,
    name: `${prefix}${i}`,
    isEmailVerified: true,
  }));
  for (let i = 0; i < data.length; i += 1000) {
    await prisma.user.createMany({ data: data.slice(i, i + 1000) });
  }
  return data;
}

async function main() {
  const [arg1, arg2] = process.argv.slice(2);

  if (arg1 === 'clean') {
    await wipe();
    console.log('Load data wiped from the test database.');
    return;
  }

  const userCount = Number.parseInt(arg1 ?? '2000', 10);
  const pairCount = Number.parseInt(arg2 ?? '500', 10);
  if (!(userCount > 0) || !(pairCount >= 0)) {
    console.error('usage: node load/seed.js [users] [pairs] | clean');
    process.exit(1);
  }

  await wipe();

  const users = await createUsers('lu', userCount);

  // Control Delegation: owner + friend, an accepted friendship, one device and
  // an active delegation with every right.
  const owners = await createUsers('lo', pairCount);
  const friends = await createUsers('lf', pairCount);
  const devices = owners.map((o, i) => ({
    id: `ld${String(i).padStart(6, '0')}${randomUUID().slice(0, 8)}`,
    userId: o.id,
    name: `load-device-${i}`,
    platform: 'k6',
    installationId: `load-${i}`,
  }));
  await prisma.friendship.createMany({
    data: owners.map((o, i) => ({
      requesterId: o.id,
      addresseeId: friends[i].id,
      status: 'ACCEPTED',
      pairKey: [o.id, friends[i].id].sort().join(':'),
    })),
  });
  await prisma.device.createMany({ data: devices });
  await prisma.controlDelegation.createMany({
    data: devices.map((d, i) => ({ deviceId: d.id, delegateId: friends[i].id })),
  });

  const out = {
    createdAt: new Date().toISOString(),
    users: users.map((u) => ({ id: u.id, token: tokenFor(u) })),
    pairs: devices.map((d, i) => ({
      deviceId: d.id,
      owner: { id: owners[i].id, token: tokenFor(owners[i]) },
      friend: { id: friends[i].id, token: tokenFor(friends[i]) },
    })),
  };
  writeFileSync(TOKENS_FILE, JSON.stringify(out));
  console.log(`Seeded ${userCount} users and ${pairCount} delegation pairs; tokens in ${TOKENS_FILE}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
