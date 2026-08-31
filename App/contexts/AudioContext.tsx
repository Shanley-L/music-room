import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { DeezerTrack } from '../app/(tabs)/home';

type AudioContextType = {
  currentTrack: DeezerTrack | null;
  isPlaying: boolean;
  playTrack: (track: DeezerTrack) => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
};

const AudioContext = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<DeezerTrack | null>(null);
  const player = useAudioPlayer(currentTrack?.preview || null);
  const status = useAudioPlayerStatus(player);

  const isPlaying = status.playing;

  const togglePlay = () => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  const pause = () => {
    player.pause();
  };

  const resume = () => {
    player.play();
  };

  const playTrack = (track: DeezerTrack) => {
    if (currentTrack?.id === track.id) {
      togglePlay();
    } else {
      setCurrentTrack(track);
    }
  };

  useEffect(() => {
    if (currentTrack?.preview) {
      player.play();
    }
  }, [currentTrack]);

  return (
    <AudioContext.Provider
      value={{
        currentTrack,
        isPlaying,
        playTrack,
        togglePlay,
        pause,
        resume,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
}
