import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import deezerRoutes from './routes/deezerRoutes.js'

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*'}));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/deezer', deezerRoutes);

const port = process.env.PORT || 3000;

app.listen(port, () => console.log(`API listening on ${port}`));

