import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Switch,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { useDevicePlayer } from '../../contexts/DevicePlayerContext';
import { ScreenHeader } from '../../components/ScreenHeader';
import { LoadError } from '../../components/LoadError';
import { confirmAction, errorMessage, notify } from '../../utils/feedback';
import {
  RIGHT_LABELS,
  type Delegation,
  type DelegationRights,
  type Device,
  type PublicUser,
} from '../../types/device';

const RIGHTS = Object.keys(RIGHT_LABELS) as (keyof DelegationRights)[];

/**
 * One of my devices: rename, delete, and its control delegations (per-device license):
 * grant control to a friend, toggle each right, revoke.
 * REST: /api/devices, /api/devices/:id/delegations, /api/friends.
 */
export default function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const apiFetch = useAuthedFetch();
  const { deviceId: thisDeviceId, forgetDevice } = useDevicePlayer();

  const [device, setDevice] = useState<Device | null>(null);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const leave = useCallback(
    (message: string) => {
      notify('Appareil', message, () => router.replace('/devices'));
    },
    [router]
  );

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [devicesRes, delegationsRes, friendsRes] = await Promise.all([
        apiFetch('/api/devices'),
        apiFetch(`/api/devices/${id}/delegations`),
        apiFetch('/api/friends'),
      ]);
      const delegationsData = await delegationsRes.json().catch(() => ({}));
      if (delegationsRes.status === 403 || delegationsRes.status === 404) {
        leave(errorMessage(delegationsData, 'Appareil introuvable.'));
        return;
      }
      const devicesData = await devicesRes.json().catch(() => []);
      const friendsData = await friendsRes.json().catch(() => []);
      if (!devicesRes.ok || !delegationsRes.ok || !friendsRes.ok) {
        throw new Error(errorMessage(delegationsData, "Impossible de charger l'appareil"));
      }
      const found = Array.isArray(devicesData)
        ? (devicesData as Device[]).find((d) => d.id === id)
        : undefined;
      if (!found) {
        leave('Appareil introuvable.');
        return;
      }
      setDevice(found);
      setName((current) => current || found.name);
      setDelegations(Array.isArray(delegationsData) ? delegationsData : []);
      setFriends(Array.isArray(friendsData) ? friendsData : []);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || "Impossible de charger l'appareil");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, apiFetch, leave]);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs a write; returns the parsed body, or null after showing the error. */
  const write = async (key: string, path: string, init: RequestInit, fallback: string) => {
    setBusy(key);
    try {
      const res = await apiFetch(path, init);
      const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, fallback));
      return data;
    } catch (err: any) {
      notify('Appareil', err.message || fallback);
      load(); // the server state is the reference
      return null;
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const trimmed = name.trim();
    if (!device || !trimmed || trimmed === device.name) return;
    const data = await write(
      'rename',
      `/api/devices/${device.id}`,
      { method: 'PATCH', body: JSON.stringify({ name: trimmed }) },
      "Impossible de renommer l'appareil"
    );
    if (data) setDevice(data as Device);
  };

  const remove = () => {
    if (!device) return;
    confirmAction(
      "Supprimer l'appareil",
      `Supprimer "${device.name}" ? Les amis qui le contrôlent perdront l'accès.`,
      'Supprimer',
      async () => {
        const data = await write(
          'delete',
          `/api/devices/${device.id}`,
          { method: 'DELETE' },
          "Impossible de supprimer l'appareil"
        );
        if (!data) return;
        if (device.id === thisDeviceId) forgetDevice();
        router.replace('/devices');
      }
    );
  };

  const grant = async (friend: PublicUser) => {
    if (!device) return;
    const data = await write(
      `grant:${friend.id}`,
      `/api/devices/${device.id}/delegations`,
      { method: 'POST', body: JSON.stringify({ userId: friend.id }) },
      'Impossible de déléguer le contrôle'
    );
    if (data) load();
  };

  const toggleRight = async (delegation: Delegation, right: keyof DelegationRights, value: boolean) => {
    if (!device) return;
    // Optimistic, then replaced by the server's answer.
    setDelegations((prev) => prev.map((d) => (d.id === delegation.id ? { ...d, [right]: value } : d)));
    const data = await write(
      `rights:${delegation.id}`,
      `/api/devices/${device.id}/delegations/${delegation.delegate.id}`,
      { method: 'PATCH', body: JSON.stringify({ [right]: value }) },
      'Impossible de modifier les droits'
    );
    if (data) {
      setDelegations((prev) => prev.map((d) => (d.id === delegation.id ? (data as Delegation) : d)));
    }
  };

  const revoke = (delegation: Delegation) => {
    if (!device) return;
    confirmAction(
      'Retirer le contrôle',
      `${delegation.delegate.name} ne pourra plus contrôler "${device.name}".`,
      'Retirer',
      async () => {
        const data = await write(
          `revoke:${delegation.id}`,
          `/api/devices/${device.id}/delegations/${delegation.delegate.id}`,
          { method: 'DELETE' },
          'Impossible de retirer le contrôle'
        );
        if (data) load();
      }
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#652edc" />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Appareil" fallback="/devices" />
        {loadError ? (
          <LoadError
            message={loadError}
            onRetry={() => {
              setLoading(true);
              load();
            }}
          />
        ) : (
          <Text style={styles.empty}>Appareil introuvable.</Text>
        )}
      </View>
    );
  }

  const delegatedIds = new Set(delegations.map((d) => d.delegate.id));
  const available = friends.filter((f) => !delegatedIds.has(f.id));

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={device.name}
        fallback="/devices"
        right={
          <Pressable
            onPress={remove}
            hitSlop={10}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Supprimer l'appareil"
          >
            <Ionicons name="trash-outline" size={20} color="#e11d48" />
          </Pressable>
        }
      />

      {loadError ? <Text style={styles.loadErrorText}>{loadError}</Text> : null}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
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
          <Text style={styles.label}>Nom de l&apos;appareil</Text>
          <View style={styles.renameRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={100}
              style={styles.input}
              placeholder="Nom"
              placeholderTextColor="#777"
            />
            <Pressable
              style={[styles.smallBtn, (busy !== null || name.trim() === device.name) && { opacity: 0.5 }]}
              onPress={rename}
              disabled={busy !== null || !name.trim() || name.trim() === device.name}
            >
              {busy === 'rename' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.smallBtnText}>Renommer</Text>
              )}
            </Pressable>
          </View>
          <Text style={styles.hint}>
            {device.platform}
            {device.id === thisDeviceId ? ' · cet appareil' : ''}
          </Text>
        </View>

        <Pressable
          style={styles.remoteBtn}
          onPress={() => router.push({ pathname: '/remote/[id]', params: { id: device.id } })}
        >
          <Ionicons name="game-controller-outline" size={18} color="#fff" />
          <Text style={styles.remoteBtnText}>Télécommande</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Amis autorisés ({delegations.length})</Text>
        <Text style={styles.sectionHint}>
          La délégation ne vaut que pour cet appareil : vos autres appareils ne sont pas concernés.
        </Text>
        {delegations.length === 0 ? (
          <Text style={styles.empty}>Personne ne contrôle cet appareil.</Text>
        ) : (
          delegations.map((d) => (
            <View key={d.id} style={styles.delegationCard}>
              <View style={styles.delegationHeader}>
                <Ionicons name="person-circle-outline" size={22} color="#a77bf3" />
                <Text style={styles.delegateName} numberOfLines={1}>
                  {d.delegate.name}
                </Text>
                <Pressable onPress={() => revoke(d)} disabled={busy !== null} hitSlop={6}>
                  <Text style={styles.revokeText}>Retirer</Text>
                </Pressable>
              </View>
              {RIGHTS.map((right) => (
                <View key={right} style={styles.rightRow}>
                  <Text style={styles.rightLabel}>{RIGHT_LABELS[right]}</Text>
                  <Switch
                    value={d[right]}
                    onValueChange={(value) => toggleRight(d, right, value)}
                    disabled={busy !== null}
                    trackColor={{ false: '#333', true: '#652edc' }}
                    thumbColor="#fff"
                  />
                </View>
              ))}
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Donner le contrôle à un ami</Text>
        {friends.length === 0 ? (
          <View>
            <Text style={styles.empty}>Seuls vos amis peuvent recevoir le contrôle.</Text>
            <Pressable style={styles.linkBtn} onPress={() => router.push('/friends')}>
              <Text style={styles.linkBtnText}>Gérer mes amis</Text>
            </Pressable>
          </View>
        ) : available.length === 0 ? (
          <Text style={styles.empty}>Tous vos amis contrôlent déjà cet appareil.</Text>
        ) : (
          available.map((f) => (
            <View key={f.id} style={styles.friendRow}>
              <Ionicons name="person-outline" size={18} color="#a77bf3" />
              <Text style={styles.friendName} numberOfLines={1}>
                {f.name}
              </Text>
              <Pressable
                style={[styles.smallBtn, busy !== null && { opacity: 0.5 }]}
                onPress={() => grant(f)}
                disabled={busy !== null}
              >
                {busy === `grant:${f.id}` ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.smallBtnText}>Autoriser</Text>
                )}
              </Pressable>
            </View>
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
  centerContainer: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  label: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  input: {
    flex: 1,
    backgroundColor: '#202020',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#303030',
    color: '#fff',
    paddingHorizontal: 10,
    height: 40,
  },
  hint: {
    color: '#888',
    fontSize: 12,
    marginTop: 6,
  },
  smallBtn: {
    backgroundColor: '#652edc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  smallBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  remoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#241a3a',
    borderColor: '#652edc',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
  },
  remoteBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 4,
  },
  sectionHint: {
    color: '#666',
    fontSize: 12,
    marginBottom: 8,
  },
  empty: {
    color: '#777',
    textAlign: 'center',
    marginVertical: 12,
  },
  delegationCard: {
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  delegationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  delegateName: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  revokeText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '600',
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  rightLabel: {
    color: '#ccc',
    fontSize: 13,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 10,
  },
  friendName: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  linkBtn: {
    alignSelf: 'center',
    backgroundColor: '#262626',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  loadErrorText: {
    color: '#fca5a5',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  linkBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
});
