import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthedFetch } from '../hooks/use-authed-fetch';
import { ScreenHeader } from '../components/ScreenHeader';
import { confirmAction, errorMessage, notify } from '../utils/feedback';
import type { FriendRequest, PublicUser } from '../types/device';

/**
 * Friends (prerequisite of control delegation): search users and send requests,
 * accept / decline incoming requests, cancel outgoing ones, remove friends.
 * REST: /api/users/search, /api/friends, /api/friends/requests.
 */
export default function FriendsScreen() {
  const apiFetch = useAuthedFetch();

  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        apiFetch('/api/friends'),
        apiFetch('/api/friends/requests'),
      ]);
      const friendsData = await friendsRes.json().catch(() => ({}));
      const requestsData = await requestsRes.json().catch(() => ({}));
      if (!friendsRes.ok) throw new Error(errorMessage(friendsData, 'Impossible de charger vos amis'));
      if (!requestsRes.ok) throw new Error(errorMessage(requestsData, 'Impossible de charger les demandes'));
      setFriends(Array.isArray(friendsData) ? friendsData : []);
      setIncoming(requestsData.incoming ?? []);
      setOutgoing(requestsData.outgoing ?? []);
    } catch (err: any) {
      notify('Amis', err.message || 'Impossible de charger vos amis');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  // Only the latest search may apply its response (bumped by each search and clear).
  const searchSeq = useRef(0);

  const search = async (term: string) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const res = await apiFetch(`/api/users/search?q=${encodeURIComponent(term)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, 'Recherche impossible'));
      if (seq === searchSeq.current) setResults(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.log('User search error:', err);
      if (seq === searchSeq.current) setResults([]);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const handleQuery = (text: string) => {
    setQuery(text);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const term = text.trim();
    if (term.length < 2) {
      searchSeq.current += 1;
      setSearching(false);
      setResults([]);
      return;
    }
    timeoutRef.current = setTimeout(() => search(term), 400);
  };

  /** Runs a write, then reloads the lists (the server state is the reference). */
  const run = async (id: string, request: () => Promise<Response>, fallback: string) => {
    setBusyId(id);
    try {
      const res = await request();
      const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, fallback));
      return { status: res.status, data };
    } catch (err: any) {
      notify('Amis', err.message || fallback);
      return null;
    } finally {
      setBusyId(null);
      load();
    }
  };

  const sendRequest = async (user: PublicUser) => {
    const result = await run(
      user.id,
      () => apiFetch('/api/friends/requests', { method: 'POST', body: JSON.stringify({ userId: user.id }) }),
      "Impossible d'envoyer la demande"
    );
    if (!result) return;
    // 200: this user had already asked us, the request accepted theirs.
    notify(
      'Amis',
      result.status === 200
        ? `Vous êtes maintenant ami avec ${user.name}.`
        : `Demande envoyée à ${user.name}.`
    );
  };

  const accept = (request: FriendRequest) =>
    run(
      request.id,
      () => apiFetch(`/api/friends/requests/${request.id}/accept`, { method: 'POST' }),
      "Impossible d'accepter la demande"
    );

  const deleteRequest = (request: FriendRequest, busyKey = request.id) =>
    run(
      busyKey,
      () => apiFetch(`/api/friends/requests/${request.id}`, { method: 'DELETE' }),
      'Impossible de supprimer la demande'
    );

  const removeFriend = (friend: PublicUser) =>
    confirmAction(
      'Retirer cet ami',
      `Retirer ${friend.name} de vos amis ? Les délégations de contrôle entre vous seront supprimées.`,
      'Retirer',
      () => {
        run(
          friend.id,
          () => apiFetch(`/api/friends/${friend.id}`, { method: 'DELETE' }),
          'Impossible de retirer cet ami'
        );
      }
    );

  const relationOf = (userId: string) => {
    if (friends.some((f) => f.id === userId)) return 'Ami';
    if (outgoing.some((r) => r.user?.id === userId)) return 'Demande envoyée';
    return null;
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Amis" fallback="/(tabs)/profile" />

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
        <View style={styles.searchBar}>
          <Ionicons name="person-add-outline" size={18} color="#888" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Ajouter un ami (nom, 2 caractères min.)"
            placeholderTextColor="#777"
            value={query}
            onChangeText={handleQuery}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {searching ? <ActivityIndicator color="#652edc" style={{ marginVertical: 12 }} /> : null}
        {!searching && query.trim().length >= 2 ? (
          results.length === 0 ? (
            <Text style={styles.empty}>Aucun utilisateur trouvé</Text>
          ) : (
            results.map((u) => {
              const relation = relationOf(u.id);
              const pendingIncoming = incoming.find((r) => r.user?.id === u.id);
              return (
                <Row key={u.id} name={u.name} subtitle={relation ?? undefined}>
                  {relation ? null : (
                    <ActionButton
                      busyId={busyId}
                      id={u.id}
                      label={pendingIncoming ? 'Accepter' : 'Ajouter'}
                      onPress={() => sendRequest(u)}
                    />
                  )}
                </Row>
              );
            })
          )
        ) : null}

        {loading ? (
          <ActivityIndicator size="large" color="#652edc" style={{ marginTop: 32 }} />
        ) : (
          <>
            {incoming.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Demandes reçues</Text>
                {incoming.map((r) => (
                  <Row key={r.id} name={r.user?.name ?? 'Utilisateur'}>
                    <ActionButton busyId={busyId} id={r.id} label="Accepter" onPress={() => accept(r)} />
                    <ActionButton
                      busyId={busyId}
                      id={`${r.id}:decline`}
                      label="Refuser"
                      variant="danger"
                      onPress={() => deleteRequest(r, `${r.id}:decline`)}
                    />
                  </Row>
                ))}
              </>
            )}

            {outgoing.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Demandes envoyées</Text>
                {outgoing.map((r) => (
                  <Row key={r.id} name={r.user?.name ?? 'Utilisateur'} subtitle="En attente">
                    <ActionButton busyId={busyId} id={r.id} label="Annuler" variant="ghost" onPress={() => deleteRequest(r)} />
                  </Row>
                ))}
              </>
            )}

            <Text style={styles.sectionTitle}>Mes amis ({friends.length})</Text>
            {friends.length === 0 ? (
              <Text style={styles.empty}>
                Pas encore d&apos;amis. Recherchez un utilisateur pour lui envoyer une demande.
              </Text>
            ) : (
              friends.map((f) => (
                <Row key={f.id} name={f.name}>
                  <ActionButton busyId={busyId} id={f.id} label="Retirer" variant="danger" onPress={() => removeFriend(f)} />
                </Row>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({
  name,
  subtitle,
  children,
}: {
  name: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Ionicons name="person" size={16} color="#a77bf3" />
      </View>
      <View style={styles.rowCenter}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.rowActions}>{children}</View>
    </View>
  );
}

/** `busyId`: id of the write in flight (every button is disabled meanwhile). */
function ActionButton({
  id,
  busyId,
  label,
  onPress,
  variant = 'primary',
}: {
  id: string;
  busyId: string | null;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busyId !== null}
      style={[
        styles.actionBtn,
        variant === 'danger' && styles.dangerBtn,
        variant === 'ghost' && styles.ghostBtn,
        busyId !== null && { opacity: 0.5 },
      ]}
    >
      {busyId === id ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={[styles.actionText, variant === 'danger' && { color: '#fca5a5' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#202020',
    borderRadius: 10,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#231c33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCenter: {
    flex: 1,
    marginHorizontal: 10,
  },
  name: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionBtn: {
    backgroundColor: '#652edc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  dangerBtn: {
    backgroundColor: 'transparent',
    borderColor: '#7f1d1d',
    borderWidth: 1,
  },
  ghostBtn: {
    backgroundColor: '#262626',
  },
  actionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
