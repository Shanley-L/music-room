import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { validationMiddleware } from '../middleware/validateMiddleware.js';
import { RegisterDto, LoginDto } from '../dto/auth.dto.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'music-room-secret';

router.post('/register', validationMiddleware(RegisterDto), async (req, res) => {
  try {
    const { email, password, metadata } = req.body;
    console.log(`[REGISTER] ${email} | Platform: ${metadata.platform}`);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await prisma.user.create({
      data: { email, passwordHash },
    });

    return res.status(201).json({ 
      ok: true, 
      message: 'Registration successful ! Please verify your email' 
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    console.log('Raw user object from DB:', user);

    const dbPasswordHash = user.password || user.passwordHash || user.hash;

    if (!dbPasswordHash) {
      console.error('Database returned a user, but the password field is missing!');
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, dbPasswordHash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'music-room-secret';
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '15m' }
    );

    return res.status(200).json({ accessToken });

  } catch (error) {
    console.error('Backend login error:', error);
    return res.status(500).json({ message: 'Internal server error during login.' });
  }
});

export default router;