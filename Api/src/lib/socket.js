import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from './prisma.js';

let io = null;

/**
 * Initialize Socket.IO with HTTP server
 */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Socket middleware for optional JWT authentication
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
      } catch (err) {
        // Allow unauthenticated connection for public viewing, but attach error info
        socket.authError = err.message;
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    const socketUserId = socket.user?.sub || socket.user?.userId || null;
    console.log(`[Socket] User connected: ${socket.id} (user: ${socketUserId || 'anonymous'})`);

    // Join Playlist room (with privacy check)
    socket.on('join:playlist', async ({ playlistId }) => {
      if (!playlistId) return;
      try {
        const playlist = await prisma.playlist.findUnique({
          where: { id: playlistId },
          include: { invites: true },
        });

        if (!playlist) return;

        // If private, ensure user is owner or invited
        if (playlist.visibility === 'PRIVATE') {
          const isOwner = socketUserId && playlist.ownerId === socketUserId;
          const isInvited = socketUserId && playlist.invites.some((inv) => inv.userId === socketUserId);
          if (!isOwner && !isInvited) {
            socket.emit('error:playlist', { message: 'Accès non autorisé à cette playlist privée' });
            return;
          }
        }

        const room = `playlist:${playlistId}`;
        socket.join(room);
        console.log(`[Socket] ${socket.id} joined ${room}`);
        socket.emit('joined:playlist', { playlistId, success: true });
      } catch (err) {
        console.error('[Socket] join:playlist error:', err);
      }
    });

    // Leave Playlist room
    socket.on('leave:playlist', ({ playlistId }) => {
      if (!playlistId) return;
      const room = `playlist:${playlistId}`;
      socket.leave(room);
      console.log(`[Socket] ${socket.id} left ${room}`);
    });

    // Join Music Room (for Personne 2)
    socket.on('join:room', ({ roomId }) => {
      if (!roomId) return;
      const room = `room:${roomId}`;
      socket.join(room);
      console.log(`[Socket] ${socket.id} joined ${room}`);
      socket.emit('joined:room', { roomId, success: true });
    });

    // Leave Music Room
    socket.on('leave:room', ({ roomId }) => {
      if (!roomId) return;
      const room = `room:${roomId}`;
      socket.leave(room);
      console.log(`[Socket] ${socket.id} left ${room}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] User disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
}

/**
 * Get Socket.IO instance
 */
export function getIO() {
  if (!io) {
    console.warn('[Socket] Socket.io has not been initialized yet.');
  }
  return io;
}

/**
 * Emit event to a playlist room
 */
export function emitToPlaylist(playlistId, event, data) {
  if (!io || !playlistId) return;
  io.to(`playlist:${playlistId}`).emit(event, data);
}

/**
 * Emit event to a music room (Personne 2)
 */
export function emitToRoom(roomId, event, data) {
  if (!io || !roomId) return;
  io.to(`room:${roomId}`).emit(event, data);
}
