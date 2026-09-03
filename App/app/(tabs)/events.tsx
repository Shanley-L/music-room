import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  RefreshControl,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { getApiBaseUrl } from '../../lib/apiConfig';

type Visibility = 'PUBLIC' | 'PRIVATE';
type License = 'EVERYONE' | 'INVITED_ONLY' | 'GEO_RESTRICTED';

type Room = {
  id: string;
  name: string;
  visibility: Visibility;
  license: License;
  inviteCode: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusM: number | null;
  ownerId: string;
  createdAt: string;
  _count?: { tracks: number };
};

const LICENSE_LABELS: Record<License, string> = {
  EVERYONE: 'Tous',
  INVITED_ONLY: 'Invités seuls',
  GEO_RESTRICTED: 'Lieu restreint',
};

const LICENSE_ICONS: Record<License, 'people-outline' | 'shield-checkmark-outline' | 'location-outline'> = {
  EVERYONE: 'people-outline',
  INVITED_ONLY: 'shield-checkmark-outline',
  GEO_RESTRICTED: 'location-outline',
};

const DEV_USER_ID = 'anonymous_user';
const REQUEST_TIMEOUT = 10000;

export default function EventsScreen() {
  const router = useRouter();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  const joinLockRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const notify = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(message);
    } else {
      Alert.alert(title, message);
    }
  };

  const fetchRooms = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/rooms/public`, {
        headers: { 'x-dev-user-id': DEV_USER_ID },
        signal: controller.signal,
      });

      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error('Erreur serveur. Réessayez dans quelques instants.');
        }
        throw new Error(data.error || 'Impossible de charger les événements');
      }

      if (isMountedRef.current) {
        setRooms(Array.isArray(data) ? data : []);
        setError(null);
      }
    } catch (err: any) {
      console.log('Error loading events:', err);
      if (isMountedRef.current) {
        if (err?.name === 'AbortError') {
          setError('Le serveur ne répond pas. Vérifiez votre connexion et réessayez.');
        } else {
          setError(err?.message || 'Impossible de charger les événements. Vérifiez votre connexion.');
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchRooms();
    }, [fetchRooms])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchRooms();
  };

  const openJoinModal = () => {
    setJoinCode('');
    setJoinError(null);
    setJoinModalVisible(true);
  };

  const handleJoinRoom = async (roomId: string) => {
    if (joinLockRef.current) return;
    joinLockRef.current = true;
    setJoiningRoomId(roomId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-user-id': DEV_USER_ID,
        },
        signal: controller.signal,
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        if (res.status >= 500) {
          throw new Error('Erreur serveur. Réessayez dans quelques instants.');
        }
        throw new Error(data.error || 'Impossible de rejoindre la salle');
      }

      if (typeof data.id !== 'string' || !data.id) {
        throw new Error('Réponse invalide du serveur');
      }

      if (isMountedRef.current) router.push(`/room/${data.id}`);
    } catch (err: any) {
      if (isMountedRef.current) {
        if (err?.name === 'AbortError') {
          notify('Erreur', 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.');
        } else {
          notify('Erreur', err?.message || 'Impossible de rejoindre la salle');
        }
      }
    } finally {
      clearTimeout(timeoutId);
      joinLockRef.current = false;
      if (isMountedRef.current) setJoiningRoomId(null);
    }
  };

  const handleJoinByCode = async () => {
    if (joinLockRef.current) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Veuillez saisir un code d’invitation');
      return;
    }
    if (code.length !== 8) {
      setJoinError('Le code d’invitation comporte 8 caractères');
      return;
    }

    joinLockRef.current = true;
    setJoining(true);
    setJoinError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/rooms/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-user-id': DEV_USER_ID,
        },
        body: JSON.stringify({ inviteCode: code }),
        signal: controller.signal,
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        if (res.status >= 500) {
          throw new Error('Erreur serveur. Réessayez dans quelques instants.');
        }
        throw new Error(data.error || 'Code invalide ou introuvable');
      }

      if (typeof data.id !== 'string' || !data.id) {
        throw new Error('Réponse invalide du serveur');
      }

      if (isMountedRef.current) {
        setJoinModalVisible(false);
        setJoinCode('');
        router.push(`/room/${data.id}`);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        if (err?.name === 'AbortError') {
          setJoinError('Le serveur ne répond pas. Vérifiez votre connexion et réessayez.');
        } else {
          setJoinError(err?.message || 'Code invalide ou introuvable');
        }
      }
    } finally {
      clearTimeout(timeoutId);
      joinLockRef.current = false;
      if (isMountedRef.current) setJoining(false);
    }
  };

  const renderLicenseBadge = (room: Room) => (
    <View style={[styles.badge, styles.licenseBadge]}>
      <Ionicons
        name={LICENSE_ICONS[room.license]}
        size={10}
        color="#a77bf3"
        style={{ marginRight: 3 }}
      />
      <Text style={[styles.badgeText, { color: '#a77bf3' }]}>
        {LICENSE_LABELS[room.license]}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Événements</Text>
        <Pressable
          style={styles.headerIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Rejoindre un événement par code"
          onPress={openJoinModal}
        >
          <Ionicons name="key-outline" size={18} color="#aaa" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#652edc" />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Ionicons name="cloud-offline-outline" size={54} color="#333" />
          <Text style={styles.emptyTitle}>Impossible de charger les événements</Text>
          <Text style={styles.emptySubtext}>{error}</Text>
          <Pressable style={styles.primaryActionButton} onPress={fetchRooms}>
            <Text style={styles.primaryActionText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : rooms.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="calendar-outline" size={54} color="#333" />
          <Text style={styles.emptyTitle}>Aucun événement public</Text>
          <Text style={styles.emptySubtext}>
            Créez un événement depuis l’accueil ou rejoignez une salle privée avec son code
            d’invitation.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item.id}
          accessibilityRole="list"
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
                styles.roomCard,
                pressed && styles.roomCardPressed,
              ]}
              onPress={() => handleJoinRoom(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Rejoindre ${item.name}`}
              accessibilityState={{ busy: joiningRoomId === item.id }}
            >
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.name}
                </Text>

                <View style={styles.badgeRow}>
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
                          color: item.visibility === 'PRIVATE' ? '#f59e0b' : '#10b981',
                        },
                      ]}
                    >
                      {item.visibility === 'PRIVATE' ? 'Privée' : 'Publique'}
                    </Text>
                  </View>

                  {renderLicenseBadge(item)}

                  {item.license === 'GEO_RESTRICTED' && item.radiusM != null && (
                    <View style={[styles.badge, styles.geoBadge]}>
                      <Ionicons
                        name="location-outline"
                        size={10}
                        color="#f59e0b"
                        style={{ marginRight: 3 }}
                      />
                      <Text style={[styles.badgeText, { color: '#f59e0b' }]}>
                        Zone {item.radiusM} m
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {joiningRoomId === item.id ? (
                <ActivityIndicator size="small" color="#652edc" />
              ) : (
                <Ionicons name="chevron-forward" size={18} color="#555" />
              )}
            </Pressable>
          )}
        />
      )}

      {/* JOIN BY CODE MODAL */}
      <Modal
        visible={joinModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rejoindre un événement</Text>
              <Pressable
                onPress={() => setJoinModalVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
              >
                <Ionicons name="close" size={22} color="#aaa" />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>Code d’invitation (8 caractères)</Text>
            <TextInput
              style={[styles.modalInput, styles.codeInput]}
              placeholder="Ex: 3FA9C21D"
              placeholderTextColor="#666"
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              editable={!joining}
              onSubmitEditing={handleJoinByCode}
              returnKeyType="go"
            />

            {joinError && (
              <View style={styles.joinErrorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#f87171" />
                <Text style={styles.joinErrorText}>{joinError}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submitButton, joining && { opacity: 0.6 }]}
              onPress={handleJoinByCode}
              disabled={joining}
              accessibilityRole="button"
              accessibilityLabel={joining ? 'Rejoindre en cours' : 'Rejoindre avec ce code'}
              accessibilityState={{ disabled: joining }}
            >
              {joining ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Rejoindre</Text>
              )}
            </Pressable>
          </View>
          </KeyboardAvoidingView>
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
  listContent: {
    paddingBottom: 24,
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#252525',
  },
  roomCardPressed: {
    opacity: 0.8,
  },
  cardInfo: {
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
    flexWrap: 'wrap',
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
  geoBadge: {
    backgroundColor: '#2d1f05',
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
  joinErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  joinErrorText: {
    color: '#f87171',
    fontSize: 12,
    flex: 1,
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