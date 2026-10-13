import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useApiConfig } from './ApiConfigContext';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinPlaylist: (playlistId: string) => void;
  leavePlaylist: (playlistId: string) => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: (roomId: string) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  joinPlaylist: () => {},
  leavePlaylist: () => {},
  joinRoom: () => {},
  leaveRoom: () => {},
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { backendUrl } = useApiConfig();
  const { token } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!backendUrl) return;

    // Connect to Socket.IO backend
    const s = io(backendUrl, {
      transports: ['websocket', 'polling'],
      auth: { token: token || undefined },
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    s.on('connect', () => {
      console.log('[Socket] Connected to gateway:', s.id);
      setIsConnected(true);
    });

    s.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setIsConnected(false);
    });

    s.on('connect_error', (err) => {
      console.warn('[Socket] Connection warning:', err.message);
      setIsConnected(false);
    });

    socketRef.current = s;

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [backendUrl, token]);

  const joinPlaylist = (playlistId: string) => {
    if (!socketRef.current || !playlistId) return;
    socketRef.current.emit('join:playlist', { playlistId });
  };

  const leavePlaylist = (playlistId: string) => {
    if (!socketRef.current || !playlistId) return;
    socketRef.current.emit('leave:playlist', { playlistId });
  };

  const joinRoom = (roomId: string) => {
    if (!socketRef.current || !roomId) return;
    socketRef.current.emit('join:room', { roomId });
  };

  const leaveRoom = (roomId: string) => {
    if (!socketRef.current || !roomId) return;
    socketRef.current.emit('leave:room', { roomId });
  };

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        isConnected,
        joinPlaylist,
        leavePlaylist,
        joinRoom,
        leaveRoom,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
