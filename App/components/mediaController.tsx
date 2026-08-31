import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DeezerTrack } from '@/app/(tabs)/home';

export function MediaController({
  track,
  isPlaying,
  onTogglePlay,
}: {
  track: DeezerTrack;
  isPlaying: boolean;
  onTogglePlay: () => void;
}) {
  return (
    <View style={styles.controller}>
      <Image source={{ uri: track.album.cover_medium }} style={styles.cover} />
      
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{track.artist.name}</Text>
      </View>

      <Pressable
        onPress={onTogglePlay}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        hitSlop={8}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={20}
          color="#000"
          style={!isPlaying ? { marginLeft: 2 } : undefined}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  controller: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    backgroundColor: '#282828',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  cover: { width: 44, height: 44, borderRadius: 8 },
  info: { flex: 1, marginLeft: 12, marginRight: 10 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: '#aaa', fontSize: 12 },
  button: {
    backgroundColor: '#fff',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
});