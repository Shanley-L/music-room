import { useCallback, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { useAuth } from '../../contexts/AuthContext';
import { errorMessage, notify } from '../../utils/feedback';
import { LoadError } from '../../components/LoadError';
import { LICENSE_LABELS, Room } from '../../types/room';

export default function EventsScreen() {
  const router = useRouter();
  const apiFetch = useAuthedFetch();
  const { user } = useAuth();

  const [mine, setMine] = useState<Room[]>([]);
  const [publicRooms, setPublicRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const fetchRooms = useCallback(async () => {
    try {
      const [mineRes, publicRes] = await Promise.all([
        apiFetch('/api/rooms/mine'),
        apiFetch('/api/rooms/public'),
      ]);
      const [mineData, publicData] = await Promise.all([
        mineRes.json().catch(() => ({})),
        publicRes.json().catch(() => ({})),
      ]);
      if (!mineRes.ok) throw new Error(errorMessage(mineData, 'Impossible de charger vos événements'));
      if (!publicRes.ok) throw new Error(errorMessage(publicData, 'Impossible de charger les événements'));
      setMine(Array.isArray(mineData) ? mineData : []);
      setPublicRooms(Array.isArray(publicData) ? publicData : []);
      setLoadError(null);
    } catch (err: any) {
      console.log('Error loading rooms:', err);
      setLoadError(err?.message || 'Impossible de charger les événements');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  useFocusEffect(
    useCallback(() => {
      fetchRooms();
    }, [fetchRooms])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchRooms();
  };

  const handleJoinByCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      notify('Erreur', "Veuillez saisir un code d'invitation");
      return;
    }
    setJoining(true);
    try {
      const res = await apiFetch('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, 'Code invalide'));
      setJoinModalVisible(false);
      setJoinCode('');
      fetchRooms();
      if (data?.id) router.push(`/event/${data.id}`);
    } catch (err: any) {
      notify('Erreur', err.message || 'Code invalide');
    } finally {
      setJoining(false);
    }
  };

  // Public rooms I already have in "mine" are listed once.
  const mineIds = new Set(mine.map((r) => r.id));
  const sections = [
    { title: 'Mes événements', key: 'mine', data: mine },
    { title: 'Événements publics', key: 'public', data: publicRooms.filter((r) => !mineIds.has(r.id)) },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Événements</Text>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.joinButton}
            onPress={() => setJoinModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Rejoindre avec un code"
          >
            <Ionicons name="key-outline" size={18} color="#aaa" />
          </Pressable>
          <Pressable
            style={styles.createButton}
            onPress={() => router.push('/event/new')}
            accessibilityRole="button"
            accessibilityLabel="Créer un événement"
          >
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#652edc" />
        </View>
      ) : loadError && mine.length === 0 && publicRooms.length === 0 ? (
        <LoadError
          message={loadError}
          onRetry={() => {
            setLoading(true);
            fetchRooms();
          }}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#652edc" />
          }
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <Text style={styles.sectionEmpty}>
                {section.key === 'mine'
                  ? 'Créez un événement ou rejoignez-en un avec un code.'
                  : 'Aucun événement public pour le moment.'}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
              onPress={() => router.push(`/event/${item.id}`)}
            >
              <View style={styles.cardIcon}>
                <Ionicons name="radio-outline" size={24} color="#652edc" />
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.badgeRow}>
                  <View
                    style={[
                      styles.badge,
                      item.visibility === 'PRIVATE' ? styles.privateBadge : styles.publicBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        { color: item.visibility === 'PRIVATE' ? '#f59e0b' : '#10b981' },
                      ]}
                    >
                      {item.visibility === 'PRIVATE' ? 'Privé' : 'Public'}
                    </Text>
                  </View>
                  <View style={[styles.badge, styles.licenseBadge]}>
                    <Text style={[styles.badgeText, { color: '#a77bf3' }]}>
                      {LICENSE_LABELS[item.license]}
                    </Text>
                  </View>
                  {item.ownerId === user?.id && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Organisateur</Text>
                    </View>
                  )}
                  {typeof item._count?.tracks === 'number' && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {item._count.tracks} {item._count.tracks > 1 ? 'titres' : 'titre'}
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

      <Modal
        visible={joinModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rejoindre un événement privé</Text>
              <Pressable
                onPress={() => setJoinModalVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
              >
                <Ionicons name="close" size={22} color="#aaa" />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>Code d&apos;invitation</Text>
            <TextInput
              style={[styles.modalInput, styles.codeInput]}
              placeholder="Ex: A1B2C3D4"
              placeholderTextColor="#666"
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              maxLength={16}
              autoCapitalize="characters"
              autoCorrect={false}
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
    marginBottom: 8,
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
  joinButton: {
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
  listContent: {
    paddingBottom: 90,
  },
  sectionTitle: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionEmpty: {
    color: '#666',
    fontSize: 13,
    marginBottom: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#252525',
  },
  cardIcon: {
    width: 48,
    height: 48,
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
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  badge: {
    backgroundColor: '#262626',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  publicBadge: { backgroundColor: '#0d281e' },
  privateBadge: { backgroundColor: '#2d1f05' },
  licenseBadge: { backgroundColor: '#211339' },
  badgeText: {
    color: '#999',
    fontSize: 10,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    letterSpacing: 4,
    fontSize: 20,
    fontWeight: '700',
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
