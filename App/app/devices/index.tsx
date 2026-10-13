import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Switch,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { useDevicePlayer } from '../../contexts/DevicePlayerContext';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { errorMessage } from '../../utils/feedback';
import type { Device, PlayerCommand } from '../../types/device';

const COMMAND_LABELS: Record<PlayerCommand, string> = {
  play: 'lecture',
  pause: 'pause',
  next: 'titre suivant',
  previous: 'titre précédent',
  setVolume: 'volume',
};

function platformIcon(platform: string): keyof typeof Ionicons.glyphMap {
  if (platform === 'ios' || platform === 'android') return 'phone-portrait-outline';
  if (platform === 'web') return 'globe-outline';
  return 'hardware-chip-outline';
}

/**
 * My devices (`GET /api/devices`): this installation (registered automatically) with
 * its player mode, and every device of the account; a device opens its delegations.
 */
export default function DevicesScreen() {
  const router = useRouter();
  const apiFetch = useAuthedFetch();
  const {
    deviceId,
    registering,
    registerError,
    registerDevice,
    playerMode,
    setPlayerMode,
    playerStatus,
    playerError,
    lastCommand,
  } = useDevicePlayer();

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/devices');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, 'Impossible de charger vos appareils'));
      setDevices(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Impossible de charger vos appareils');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  // Reload when coming back (a device may have been renamed or deleted)...
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ...and once this installation is (re)registered.
  useEffect(() => {
    if (deviceId) load();
  }, [deviceId, load]);

  const playerLabel =
    playerStatus === 'ready'
      ? 'En ligne : vos amis autorisés peuvent contrôler la musique de cet appareil.'
      : playerStatus === 'connecting'
        ? 'Connexion du lecteur…'
        : playerStatus === 'error'
          ? playerError
          : 'Désactivé : cet appareil ne reçoit pas de commandes.';

  return (
    <View style={styles.container}>
      <ScreenHeader title="Mes appareils" fallback="/(tabs)/profile" />
      <ConnectionBanner />

      <ScrollView
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
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cet appareil</Text>
          {registering ? (
            <ActivityIndicator color="#652edc" style={{ alignSelf: 'flex-start', marginTop: 8 }} />
          ) : !deviceId ? (
            <>
              <Text style={styles.errorText}>
                {registerError || "Cet appareil n'est pas enregistré sur votre compte."}
              </Text>
              <Pressable style={styles.primaryBtn} onPress={registerDevice}>
                <Text style={styles.primaryBtnText}>Enregistrer cet appareil</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Utiliser comme lecteur</Text>
                  <Text
                    style={[
                      styles.hint,
                      playerStatus === 'ready' && { color: '#10b981' },
                      playerStatus === 'error' && { color: '#fca5a5' },
                    ]}
                  >
                    {playerLabel}
                  </Text>
                </View>
                <Switch
                  value={playerMode}
                  onValueChange={setPlayerMode}
                  trackColor={{ false: '#333', true: '#652edc' }}
                  thumbColor="#fff"
                />
              </View>
              {playerMode && lastCommand ? (
                <Text style={styles.hint}>
                  Dernière commande : {COMMAND_LABELS[lastCommand.command] ?? lastCommand.command} par{' '}
                  {lastCommand.from}
                </Text>
              ) : null}
            </>
          )}
        </View>

        <Pressable style={styles.linkRow} onPress={() => router.push('/remote')}>
          <Ionicons name="game-controller-outline" size={20} color="#a77bf3" />
          <Text style={styles.linkText}>Appareils partagés avec moi</Text>
          <Ionicons name="chevron-forward" size={18} color="#555" />
        </Pressable>
        <Pressable style={styles.linkRow} onPress={() => router.push('/friends')}>
          <Ionicons name="people-outline" size={20} color="#a77bf3" />
          <Text style={styles.linkText}>Amis</Text>
          <Ionicons name="chevron-forward" size={18} color="#555" />
        </Pressable>

        <Text style={styles.sectionTitle}>Appareils du compte</Text>
        {loading ? (
          <ActivityIndicator size="large" color="#652edc" style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : devices.length === 0 ? (
          <Text style={styles.empty}>Aucun appareil enregistré.</Text>
        ) : (
          devices.map((d) => (
            <Pressable
              key={d.id}
              style={styles.deviceRow}
              onPress={() => router.push({ pathname: '/devices/[id]', params: { id: d.id } })}
            >
              <Ionicons name={platformIcon(d.platform)} size={22} color="#a77bf3" />
              <View style={styles.deviceCenter}>
                <Text style={styles.deviceName} numberOfLines={1}>
                  {d.name}
                </Text>
                <Text style={styles.hint}>{d.platform}</Text>
              </View>
              {d.id === deviceId ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Cet appareil</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color="#555" />
            </Pressable>
          ))
        )}
      </ScrollView>
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
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 10,
  },
  switchLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    color: '#888',
    fontSize: 12,
    marginTop: 3,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    marginTop: 8,
  },
  primaryBtn: {
    backgroundColor: '#652edc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  linkText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  empty: {
    color: '#777',
    textAlign: 'center',
    marginVertical: 12,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  deviceCenter: {
    flex: 1,
  },
  deviceName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#211339',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: '#a77bf3',
    fontSize: 11,
    fontWeight: '600',
  },
});
