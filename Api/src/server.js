import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import deezerRoutes from './routes/deezerRoutes.js'
import roomRoutes from './routes/roomRoutes.js'
import trackRoutes from './routes/trackRoutes.js'

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/deezer', deezerRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms/:roomId/tracks', trackRoutes);

const port = process.env.PORT || 3000;

app.listen(port, () => console.log(`API listening on ${port}`));

