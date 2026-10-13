import { useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApiConfig } from '../contexts/ApiConfigContext';
import type { DeezerTrack } from '../app/(tabs)/home';

/** Full-screen Deezer search. `onPick` gets the chosen result; resolving to `true` closes the modal. */
export function TrackSearchModal({
  visible,
  title,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onPick: (track: DeezerTrack) => boolean | void | Promise<boolean | void>;
}) {
  const { apiFetch } = useApiConfig();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DeezerTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickingId, setPickingId] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest search may apply its response (bumped by each search, clear and close).
  const searchSeq = useRef(0);

  const performSearch = async (term: string) => {
    const seq = ++searchSeq.current;
    if (!term.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const res = await apiFetch(`/api/deezer/search?q=${encodeURIComponent(term.trim())}`);
      const json = await res.json();
      if (seq === searchSeq.current) setResults(json.results || []);
    } catch (err) {
      console.log('Search error:', err);
      if (seq === searchSeq.current) setResults([]);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const handleChange = (text: string) => {
    setQuery(text);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!text.trim()) {
      searchSeq.current += 1;
      setSearching(false);
      setResults([]);
      return;
    }
    timeoutRef.current = setTimeout(() => performSearch(text), 400);
  };

  const close = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    searchSeq.current += 1;
    setSearching(false);
    setQuery('');
    setResults([]);
    onClose();
  };

  const pick = async (track: DeezerTrack) => {
    if (pickingId !== null) return;
    setPickingId(track.id);
    try {
      if ((await onPick(track)) === true) close();
    } finally {
      setPickingId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.modalContainer}>
        <View style={styles.modalNav}>
          <Text style={styles.modalHeading}>{title}</Text>
          <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#888" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Rechercher sur Deezer..."
            placeholderTextColor="#777"
            value={query}
            onChangeText={handleChange}
            style={styles.searchInput}
            autoFocus
          />
        </View>

        {searching ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#652edc" />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={{ padding: 16 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <View style={styles.resultItem}>
                <Image source={{ uri: item.album.cover_medium }} style={styles.resultCover} />
                <View style={styles.resultInfo}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.resultArtist} numberOfLines={1}>
                    {item.artist.name}
                  </Text>
                </View>
                <Pressable
                  style={[styles.addBtn, pickingId !== null && { opacity: 0.5 }]}
                  onPress={() => pick(item)}
                  disabled={pickingId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Ajouter ${item.title}`}
                >
                  {pickingId === item.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="add" size={20} color="#fff" />
                  )}
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#141414',
    paddingTop: 20,
  },
  modalNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  modalHeading: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#202020',
    borderRadius: 10,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#303030',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
  },
  resultCover: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  resultInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  resultTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  resultArtist: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#652edc',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
