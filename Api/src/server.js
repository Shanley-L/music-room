import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import deezerRoutes from './routes/deezerRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import trackRoutes from './routes/trackRoutes.js';
import { initSocket } from './lib/socket.js';
import { socketAuthMiddleware } from './middleware/auth.js';
import { registerRoomGateway } from './gateways/roomGateway.js';

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/deezer', deezerRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms/:roomId/tracks', trackRoutes);

const port = process.env.PORT || 3000;

const httpServer = http.createServer(app);

const io = await initSocket(httpServer);
io.use(socketAuthMiddleware);
registerRoomGateway(io);

httpServer.listen(port, () => console.log(`API listening on ${port}`));