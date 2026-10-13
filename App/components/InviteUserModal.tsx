import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthedFetch } from '../hooks/use-authed-fetch';
import { confirmAction, errorMessage, notify } from '../utils/feedback';

type PublicUser = { id: string; name: string };

/**
 * Searches users by name (`GET /api/users/search`) and invites one with
 * `POST <invitePath> { userId }` (owner only, idempotent on the server).
 * With `revokePath`, current invitees are listed (empty search) and can be removed
 * with `DELETE revokePath(userId)`. `onInvited` runs after every change.
 */
export function InviteUserModal({
  visible,
  invitePath,
  invitedIds,
  revokePath,
  onClose,
  onInvited,
}: {
  visible: boolean;
  invitePath: string;
  invitedIds: string[];
  revokePath?: (userId: string) => string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const apiFetch = useAuthedFetch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Names of invitees (invites only carry user ids), resolved with `GET /api/users/:id`.
  const [names, setNames] = useState<Record<string, string>>({});
  const invitedKey = invitedIds.join(',');

  useEffect(() => {
    if (!visible || !revokePath) return;
    const missing = invitedKey.split(',').filter((uid) => uid && !names[uid]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (uid) => {
        try {
          const res = await apiFetch(`/api/users/${uid}`);
          const data = await res.json().catch(() => ({}));
          return [uid, res.ok && data.name ? String(data.name) : 'Utilisateur'] as const;
        } catch {
          return [uid, 'Utilisateur'] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [visible, revokePath, invitedKey, names, apiFetch]);

  // Only the latest search may apply its response (bumped by each search, clear and close).
  const searchSeq = useRef(0);

  const search = async (term: string) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const res = await apiFetch(`/api/users/search?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(errorMessage(data, 'Recherche impossible'));
      if (seq === searchSeq.current) setResults(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.log('User search error:', err);
      if (seq === searchSeq.current) setResults([]);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const handleChange = (text: string) => {
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

  const close = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    searchSeq.current += 1;
    setSearching(false);
    setQuery('');
    setResults([]);
    onClose();
  };

  const invite = async (user: PublicUser) => {
    setInvitingId(user.id);
    try {
      const res = await apiFetch(invitePath, {
        method: 'POST',
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, "Impossible d'inviter cet utilisateur"));
      onInvited();
    } catch (err: any) {
      notify('Invitation', err.message || "Impossible d'inviter cet utilisateur");
    } finally {
      setInvitingId(null);
    }
  };

  const revoke = (user: PublicUser) => {
    if (!revokePath) return;
    confirmAction('Retirer l\'invitation', `Retirer l'accès de ${user.name} ?`, 'Retirer', async () => {
      setInvitingId(user.id);
      try {
        const res = await apiFetch(revokePath(user.id), { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(errorMessage(data, "Impossible de retirer l'invitation"));
        }
        onInvited();
      } catch (err: any) {
        notify('Invitation', err.message || "Impossible de retirer l'invitation");
      } finally {
        setInvitingId(null);
      }
    });
  };

  const showInvitees = !!revokePath && query.trim().length < 2;
  const listData: PublicUser[] = showInvitees
    ? invitedIds.map((uid) => ({ id: uid, name: names[uid] || '…' }))
    : results;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        <View style={styles.nav}>
          <Text style={styles.heading}>Inviter un utilisateur</Text>
          <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="person-add-outline" size={18} color="#888" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Nom de l'utilisateur (2 caractères min.)"
            placeholderTextColor="#777"
            value={query}
            onChangeText={handleChange}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>

        {searching ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#652edc" />
          </View>
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              showInvitees && invitedIds.length > 0 ? (
                <Text style={styles.sectionTitle}>Invités</Text>
              ) : null
            }
            ListEmptyComponent={
              query.trim().length >= 2 ? (
                <Text style={styles.empty}>Aucun utilisateur trouvé</Text>
              ) : showInvitees ? (
                <Text style={styles.empty}>Aucun invité pour le moment</Text>
              ) : null
            }
            renderItem={({ item }) => {
              const invited = invitedIds.includes(item.id);
              return (
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={16} color="#a77bf3" />
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {invited && revokePath ? (
                    <Pressable
                      style={[styles.revokeBtn, invitingId !== null && { opacity: 0.5 }]}
                      onPress={() => revoke(item)}
                      disabled={invitingId !== null}
                    >
                      {invitingId === item.id ? (
                        <ActivityIndicator size="small" color="#fca5a5" />
                      ) : (
                        <Text style={styles.revokeText}>Retirer</Text>
                      )}
                    </Pressable>
                  ) : invited ? (
                    <View style={styles.invitedBadge}>
                      <Ionicons name="checkmark" size={14} color="#10b981" />
                      <Text style={styles.invitedText}>Invité</Text>
                    </View>
                  ) : (
                    <Pressable
                      style={[styles.inviteBtn, invitingId !== null && { opacity: 0.5 }]}
                      onPress={() => invite(item)}
                      disabled={invitingId !== null}
                    >
                      {invitingId === item.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.inviteText}>Inviter</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#141414',
    paddingTop: 20,
  },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  heading: {
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
  empty: {
    color: '#777',
    textAlign: 'center',
    marginTop: 24,
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
  name: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginHorizontal: 10,
  },
  inviteBtn: {
    backgroundColor: '#652edc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  inviteText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  invitedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  invitedText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '600',
  },
  revokeBtn: {
    borderColor: '#7f1d1d',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  revokeText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
});
