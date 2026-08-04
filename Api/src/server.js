import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import deezerRoutes from './routes/deezerRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import trackRoutes from './routes/trackRoutes.js';
import { createIo } from './socket/index.js';
import { resolveCorsOrigin } from './config/cors.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: resolveCorsOrigin() }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/deezer', deezerRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms/:roomId/tracks', trackRoutes);

const port = process.env.PORT || 3000;

async function start() {
  await createIo(server);

  server.listen(port, '0.0.0.0', () => {
    console.log(`API listening on ${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
