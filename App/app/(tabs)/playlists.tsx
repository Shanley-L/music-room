import { useState, useEffect, useCallback } from 'react';
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
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getApiBaseUrl } from '../../lib/apiConfig';

export type Playlist = {
  id: string;
  name: string;
  description: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  license: 'EVERYONE' | 'INVITED_ONLY';
  inviteCode: string | null;
  coverUrl: string | null;
  version: number;
  trackCount: number;
  previewCovers: string[];
  createdAt: string;
  updatedAt: string;
};

export default function PlaylistsScreen() {
  const router = useRouter();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'PRIVATE'>('ALL');

  // Create Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newVisibility, setNewVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [newLicense, setNewLicense] = useState<'EVERYONE' | 'INVITED_ONLY'>('EVERYONE');
  const [creating, setCreating] = useState(false);

  // Join Modal State
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    try {
      const url =
        activeFilter === 'PRIVATE'
          ? `${getApiBaseUrl()}/api/playlists?visibility=PRIVATE`
          : `${getApiBaseUrl()}/api/playlists`;

      const response = await fetch(url);
      const data = await response.json();
      setPlaylists(data.playlists || []);
    } catch (error) {
      console.log('Error loading playlists:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    setLoading(true);
    fetchPlaylists();
  }, [fetchPlaylists]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPlaylists();
  };

  const handleCreatePlaylist = async () => {
    if (!newTitle.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir un nom de playlist');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTitle.trim(),
          description: newDesc.trim() || undefined,
          visibility: newVisibility,
          license: newLicense,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erreur lors de la création');
      }

      setCreateModalVisible(false);
      setNewTitle('');
      setNewDesc('');
      setNewVisibility('PUBLIC');
      setNewLicense('EVERYONE');
      fetchPlaylists();

      // Navigate directly to the new playlist editor
      if (data.playlist?.id) {
        router.push(`/playlist/${data.playlist.id}`);
      }
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer la playlist');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Erreur', "Veuillez saisir un code d'invitation");
      return;
    }

    setJoining(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/playlists/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteCode: joinCode.trim().toUpperCase(),
          userId: 'anonymous_user',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Code invalide');
      }

      setJoinModalVisible(false);
      setJoinCode('');
      fetchPlaylists();

      if (data.playlist?.id) {
        router.push(`/playlist/${data.playlist.id}`);
      }
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Code invalide ou introuvable');
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Playlists</Text>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Réglages"
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={18} color="#aaa" />
          </Pressable>
          <Pressable
            style={styles.headerIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Rejoindre une playlist par code"
            onPress={() => setJoinModalVisible(true)}
          >
            <Ionicons name="key-outline" size={18} color="#aaa" />
          </Pressable>
          <Pressable
            style={styles.createButton}
            onPress={() => setCreateModalVisible(true)}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <Pressable
          style={[styles.filterChip, activeFilter === 'ALL' && styles.activeFilterChip]}
          onPress={() => setActiveFilter('ALL')}
        >
          <Text
            style={[
              styles.filterText,
              activeFilter === 'ALL' && styles.activeFilterText,
            ]}
          >
            Toutes les playlists
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.filterChip,
            activeFilter === 'PRIVATE' && styles.activeFilterChip,
          ]}
          onPress={() => setActiveFilter('PRIVATE')}
        >
          <Ionicons
            name="lock-closed"
            size={12}
            color={activeFilter === 'PRIVATE' ? '#fff' : '#888'}
            style={{ marginRight: 4 }}
          />
          <Text
            style={[
              styles.filterText,
              activeFilter === 'PRIVATE' && styles.activeFilterText,
            ]}
          >
            Privées
          </Text>
        </Pressable>
      </View>

      {/* Loading */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#652edc" />
        </View>
      ) : playlists.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="albums-outline" size={54} color="#333" />
          <Text style={styles.emptyTitle}>Aucune playlist trouvée</Text>
          <Text style={styles.emptySubtext}>
            Créez votre première playlist collaborative en appuyant sur le bouton +
          </Text>
          <Pressable
            style={styles.primaryActionButton}
            onPress={() => setCreateModalVisible(true)}
          >
            <Text style={styles.primaryActionText}>Créer une playlist</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#652edc"
            />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.playlistCard,
                pressed && styles.playlistCardPressed,
              ]}
              onPress={() => router.push(`/playlist/${item.id}`)}
            >
              {/* Cover Art */}
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cardCover} />
              ) : (
                <View style={styles.placeholderCover}>
                  <Ionicons name="musical-notes" size={28} color="#652edc" />
                </View>
              )}

              {/* Info */}
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description ? (
                  <Text style={styles.cardDescription} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}

                <View style={styles.badgeRow}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {item.trackCount} {item.trackCount > 1 ? 'titres' : 'titre'}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.badge,
                      item.visibility === 'PRIVATE'
                        ? styles.privateBadge
                        : styles.publicBadge,
                    ]}
                  >
                    <Ionicons
                      name={item.visibility === 'PRIVATE' ? 'lock-closed' : 'globe-outline'}
                      size={10}
                      color={item.visibility === 'PRIVATE' ? '#f59e0b' : '#10b981'}
                      style={{ marginRight: 3 }}
                    />
                    <Text
                      style={[
                        styles.badgeText,
                        {
                          color:
                            item.visibility === 'PRIVATE' ? '#f59e0b' : '#10b981',
                        },
                      ]}
                    >
                      {item.visibility === 'PRIVATE' ? 'Privée' : 'Publique'}
                    </Text>
                  </View>

                  {item.license === 'INVITED_ONLY' && (
                    <View style={[styles.badge, styles.licenseBadge]}>
                      <Text style={[styles.badgeText, { color: '#a77bf3' }]}>
                        Invités
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              <Ionicons name="chevron-forward" size={18} color="#555" />
            </Pressable>
          )}
        />
      )}

      {/* CREATE PLAYLIST MODAL */}
      <Modal
        visible={createModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nouvelle Playlist</Text>
              <Pressable
                onPress={() => setCreateModalVisible(false)}
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color="#aaa" />
              </Pressable>
            </View>

            {/* Name input */}
            <Text style={styles.inputLabel}>Nom de la playlist *</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Ex: Soirée Électro, Chill Room..."
              placeholderTextColor="#666"
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
            />

            {/* Description input */}
            <Text style={styles.inputLabel}>Description (optionnelle)</Text>
            <TextInput
              style={[styles.modalInput, { height: 64, textAlignVertical: 'top' }]}
              placeholder="Ajoutez quelques mots sur l'ambiance..."
              placeholderTextColor="#666"
              value={newDesc}
              onChangeText={setNewDesc}
              multiline
            />

            {/* Visibility Selector */}
            <Text style={styles.inputLabel}>Visibilité</Text>
            <View style={styles.optionRow}>
              <Pressable
                style={[
                  styles.optionCard,
                  newVisibility === 'PUBLIC' && styles.activeOptionCard,
                ]}
                onPress={() => setNewVisibility('PUBLIC')}
              >
                <Ionicons
                  name="globe-outline"
                  size={20}
                  color={newVisibility === 'PUBLIC' ? '#652edc' : '#888'}
                />
                <Text
                  style={[
                    styles.optionTitle,
                    newVisibility === 'PUBLIC' && styles.activeOptionTitle,
                  ]}
                >
                  Publique
                </Text>
                <Text style={styles.optionSub}>Accessible à tous</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.optionCard,
                  newVisibility === 'PRIVATE' && styles.activeOptionCard,
                ]}
                onPress={() => setNewVisibility('PRIVATE')}
              >
                <Ionicons
                  name="lock-closed"
                  size={20}
                  color={newVisibility === 'PRIVATE' ? '#652edc' : '#888'}
                />
                <Text
                  style={[
                    styles.optionTitle,
                    newVisibility === 'PRIVATE' && styles.activeOptionTitle,
                  ]}
                >
                  Privée
                </Text>
                <Text style={styles.optionSub}>Code d'invitation</Text>
              </Pressable>
            </View>

            {/* Edit License Selector */}
            <Text style={styles.inputLabel}>Droits d'édition</Text>
            <View style={styles.optionRow}>
              <Pressable
                style={[
                  styles.optionCard,
                  newLicense === 'EVERYONE' && styles.activeOptionCard,
                ]}
                onPress={() => setNewLicense('EVERYONE')}
              >
                <Ionicons
                  name="people-outline"
                  size={20}
                  color={newLicense === 'EVERYONE' ? '#652edc' : '#888'}
                />
                <Text
                  style={[
                    styles.optionTitle,
                    newLicense === 'EVERYONE' && styles.activeOptionTitle,
                  ]}
                >
                  Tout le monde
                </Text>
                <Text style={styles.optionSub}>Édition ouverte</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.optionCard,
                  newLicense === 'INVITED_ONLY' && styles.activeOptionCard,
                ]}
                onPress={() => setNewLicense('INVITED_ONLY')}
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={20}
                  color={newLicense === 'INVITED_ONLY' ? '#652edc' : '#888'}
                />
                <Text
                  style={[
                    styles.optionTitle,
                    newLicense === 'INVITED_ONLY' && styles.activeOptionTitle,
                  ]}
                >
                  Invités seuls
                </Text>
                <Text style={styles.optionSub}>Édition restreinte</Text>
              </Pressable>
            </View>

            {/* Submit Button */}
            <Pressable
              style={[styles.submitButton, creating && { opacity: 0.6 }]}
              onPress={handleCreatePlaylist}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Créer la playlist</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* JOIN BY CODE MODAL */}
      <Modal
        visible={joinModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rejoindre une playlist</Text>
              <Pressable
                onPress={() => setJoinModalVisible(false)}
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color="#aaa" />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>Code d'invitation (6 caractères)</Text>
            <TextInput
              style={[styles.modalInput, styles.codeInput]}
              placeholder="Ex: A1B2C3"
              placeholderTextColor="#666"
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              maxLength={6}
              autoCapitalize="characters"
              autoFocus
            />

            <Pressable
              style={[styles.submitButton, joining && { opacity: 0.6 }]}
              onPress={handleJoinByCode}
              disabled={joining}
            >
              {joining ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Rejoindre</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  createButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#652edc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  activeFilterChip: {
    backgroundColor: '#2b1b47',
    borderColor: '#652edc',
  },
  filterText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  activeFilterText: {
    color: '#fff',
  },
  listContent: {
    paddingBottom: 24,
  },
  playlistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#252525',
  },
  playlistCardPressed: {
    opacity: 0.8,
  },
  cardCover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#282828',
  },
  placeholderCover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#231c33',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#39255c',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  cardDescription: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#262626',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  publicBadge: {
    backgroundColor: '#0d281e',
  },
  privateBadge: {
    backgroundColor: '#2d1f05',
  },
  licenseBadge: {
    backgroundColor: '#211339',
  },
  badgeText: {
    color: '#999',
    fontSize: 10,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  primaryActionButton: {
    marginTop: 10,
    backgroundColor: '#652edc',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1c1c1c',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  inputLabel: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#383838',
  },
  codeInput: {
    textAlign: 'center',
    letterSpacing: 6,
    fontSize: 20,
    fontWeight: '700',
  },
  optionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  optionCard: {
    flex: 1,
    backgroundColor: '#242424',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    gap: 2,
  },
  activeOptionCard: {
    backgroundColor: '#251b3a',
    borderColor: '#652edc',
  },
  optionTitle: {
    color: '#bbb',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  activeOptionTitle: {
    color: '#fff',
  },
  optionSub: {
    color: '#666',
    fontSize: 10,
  },
  submitButton: {
    backgroundColor: '#652edc',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
