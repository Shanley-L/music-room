import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { DeezerTrack } from '../app/(tabs)/home';

/** A queue entry: `key` is unique within the queue (e.g. a playlist track id). */
export type QueueItem = { key: string; track: DeezerTrack };

type PlayOptions = {
  /** Unique identity of the track (default: the Deezer id). */
  key?: string;
  /** List that `next` / `previous` move through, e.g. the playlist being played. */
  queue?: QueueItem[];
  /** Identifies the queue's source (e.g. `playlist:<id>`) so it can be refreshed. */
  queueId?: string;
};

type AudioContextType = {
  currentTrack: DeezerTrack | null;
  /** Identity of the current track (see `PlayOptions.key`). */
  currentKey: string | null;
  isPlaying: boolean;
  /** 0 to 100. */
  volume: number;
  /** Plays `track`; toggles play/pause when it is already the current one. */
  playTrack: (track: DeezerTrack, options?: PlayOptions) => void;
  /** Replaces the queue when it comes from `queueId` (e.g. the playlist changed). */
  updateQueue: (queueId: string, queue: QueueItem[]) => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  /** Next playable track of the queue (no-op at the end or without a queue). */
  next: () => void;
  /** Previous playable track of the queue, or back to the start of the current one. */
  previous: () => void;
  /** 0 to 100; non-finite values are ignored. */
  setVolume: (volume: number) => void;
};

const AudioContext = createContext<AudioContextType | null>(null);

const playable = (item: QueueItem) => !!item.track.preview;

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(100);
  const currentTrack = current?.track ?? null;
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

  const playTrack = (track: DeezerTrack, options: PlayOptions = {}) => {
    const key = options.key ?? String(track.id);
    if (options.queue) {
      setQueue(options.queue);
      setQueueId(options.queueId ?? null);
    }
    if (current?.key === key) {
      togglePlay();
    } else {
      setCurrent({ key, track });
    }
  };

  const updateQueue = (id: string, newQueue: QueueItem[]) => {
    if (queueId === id) setQueue(newQueue);
  };

  const indexInQueue = () => (current ? queue.findIndex((item) => item.key === current.key) : -1);

  const next = () => {
    const index = indexInQueue();
    if (index < 0) return;
    const target = queue.slice(index + 1).find(playable);
    if (target) setCurrent(target);
  };

  const previous = () => {
    const index = indexInQueue();
    const target = index > 0 ? queue.slice(0, index).reverse().find(playable) : undefined;
    if (target) {
      setCurrent(target);
    } else if (current) {
      player.seekTo(0);
    }
  };

  const setVolume = (value: number) => {
    if (!Number.isFinite(value)) return;
    setVolumeState(Math.round(Math.min(100, Math.max(0, value))));
  };

  useEffect(() => {
    player.volume = volume / 100;
  }, [player, volume]);

  useEffect(() => {
    if (current?.track.preview) {
      player.play();
    }
  }, [current]);

  return (
    <AudioContext.Provider
      value={{
        currentTrack,
        currentKey: current?.key ?? null,
        isPlaying,
        volume,
        playTrack,
        updateQueue,
        togglePlay,
        pause,
        resume,
        next,
        previous,
        setVolume,
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
