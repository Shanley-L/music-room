import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { useSocket } from '../../contexts/SocketContext';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { errorMessage } from '../../utils/feedback';
import { RIGHT_LABELS, type DelegationRights, type ReceivedDelegation } from '../../types/device';

const RIGHTS = Object.keys(RIGHT_LABELS) as (keyof DelegationRights)[];

/**
 * Devices friends let me control (`GET /api/delegations/received`). Reloaded when a
 * delegation is granted, changed or revoked (`delegation:updated`, `device:revoked`)
 * and after every reconnection.
 */
export default function SharedWithMeScreen() {
  const router = useRouter();
  const apiFetch = useAuthedFetch();
  const { status, addListener } = useSocket();

  const [items, setItems] = useState<ReceivedDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/delegations/received');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, 'Impossible de charger les appareils partagés'));
      setItems(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Impossible de charger les appareils partagés');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(
    () =>
      addListener((event) => {
        if (event === 'delegation:updated' || event === 'device:revoked') load();
      }),
    [addListener, load]
  );

  // Events may have been missed while disconnected.
  useEffect(() => {
    if (status === 'connected') load();
  }, [status, load]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Partagés avec moi" fallback="/devices" />
      <ConnectionBanner />

      {loading ? (
        <ActivityIndicator size="large" color="#652edc" style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor="#652edc"
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          ListHeaderComponent={error ? <Text style={styles.errorText}>{error}</Text> : null}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="game-controller-outline" size={44} color="#333" />
              <Text style={styles.emptyTitle}>Aucun appareil partagé</Text>
              <Text style={styles.emptySub}>
                Quand un ami vous donne le contrôle d&apos;un de ses appareils, il apparaît ici.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/remote/[id]', params: { id: item.deviceId } })}
            >
              <Ionicons name="phone-portrait-outline" size={22} color="#a77bf3" />
              <View style={styles.center}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.device.name}
                </Text>
                <Text style={styles.owner}>de {item.owner.name}</Text>
                <View style={styles.rights}>
                  {RIGHTS.filter((r) => item[r]).map((r) => (
                    <View key={r} style={styles.badge}>
                      <Text style={styles.badgeText}>{RIGHT_LABELS[r]}</Text>
                    </View>
                  ))}
                  {RIGHTS.every((r) => !item[r]) ? (
                    <Text style={styles.owner}>Aucun droit pour le moment</Text>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#555" />
            </Pressable>
          )}
        />
      )}
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
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    marginBottom: 8,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySub: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  center: {
    flex: 1,
  },
  name: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  owner: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  rights: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  badge: {
    backgroundColor: '#211339',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    color: '#a77bf3',
    fontSize: 10,
    fontWeight: '600',
  },
});
