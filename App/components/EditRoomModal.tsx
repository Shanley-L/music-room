import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useAuthedFetch } from '../hooks/use-authed-fetch';
import { errorMessage, notify } from '../utils/feedback';
import { LICENSE_LABELS, Room, RoomLicense, RoomVisibility } from '../types/room';

type Props = {
  visible: boolean;
  room: Room;
  onClose: () => void;
  onSaved: () => void;
};

/** Owner-only form behind `PATCH /api/rooms/:id` (name, visibility, license, vote radius). */
export function EditRoomModal({ visible, room, onClose, onSaved }: Props) {
  const apiFetch = useAuthedFetch();
  const [name, setName] = useState(room.name);
  const [visibility, setVisibility] = useState<RoomVisibility>(room.visibility);
  const [license, setLicense] = useState<RoomLicense>(room.license);
  const [radius, setRadius] = useState(room.radiusM != null ? String(room.radiusM) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(room.name);
    setVisibility(room.visibility);
    setLicense(room.license);
    setRadius(room.radiusM != null ? String(room.radiusM) : '');
  }, [visible, room]);

  const hasZone = room.latitude != null && room.longitude != null && room.radiusM != null;
  const hasWindow = room.voteStartAt != null || room.voteEndAt != null;
  // The geo license needs a zone or a time window, which this form does not create.
  const licenses = (Object.keys(LICENSE_LABELS) as RoomLicense[]).filter(
    (l) => l !== 'GEO_TIME_RESTRICTED' || hasZone || hasWindow
  );

  const save = async () => {
    const body: Record<string, unknown> = {};
    if (name.trim() !== room.name) body.name = name.trim();
    if (visibility !== room.visibility) body.visibility = visibility;
    if (license !== room.license) body.license = license;
    if (hasZone && radius.trim() !== String(room.radiusM)) {
      const value = Number(radius);
      if (!Number.isInteger(value) || value <= 0) {
        notify('Rayon invalide', 'Le rayon doit être un nombre entier de mètres.');
        return;
      }
      body.radiusM = value;
    }
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify('Modification impossible', errorMessage(data, "Impossible de modifier l'événement"));
        return;
      }
      onSaved();
      onClose();
    } catch (err: any) {
      notify('Modification impossible', err?.message || "Impossible de modifier l'événement");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>Paramètres de l'événement</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nom</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              maxLength={100}
              placeholderTextColor="#666"
            />

            <Text style={styles.label}>Visibilité</Text>
            <View style={styles.options}>
              {(['PUBLIC', 'PRIVATE'] as RoomVisibility[]).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setVisibility(v)}
                  style={[styles.option, visibility === v && styles.optionActive]}
                  accessibilityRole="button"
                >
                  <Text style={styles.optionText}>{v === 'PUBLIC' ? 'Public' : 'Privé'}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Qui peut voter</Text>
            <View style={styles.options}>
              {licenses.map((l) => (
                <Pressable
                  key={l}
                  onPress={() => setLicense(l)}
                  style={[styles.option, license === l && styles.optionActive]}
                  accessibilityRole="button"
                >
                  <Text style={styles.optionText}>{LICENSE_LABELS[l]}</Text>
                </Pressable>
              ))}
            </View>

            {hasZone && license === 'GEO_TIME_RESTRICTED' ? (
              <>
                <Text style={styles.label}>Rayon de vote (m)</Text>
                <TextInput
                  style={styles.input}
                  value={radius}
                  onChangeText={setRadius}
                  keyboardType="number-pad"
                  placeholderTextColor="#666"
                />
              </>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.cancel]} onPress={onClose} disabled={saving}>
              <Text style={styles.btnText}>Annuler</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, (saving || !name.trim()) && { opacity: 0.5 }]}
              onPress={save}
              disabled={saving || !name.trim()}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Enregistrer</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    maxHeight: '85%',
  },
  heading: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  label: { color: '#aaa', fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: '#262626',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    backgroundColor: '#262626',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#262626',
  },
  optionActive: { borderColor: '#652edc', backgroundColor: '#241a3a' },
  optionText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  btn: {
    backgroundColor: '#652edc',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  cancel: { backgroundColor: '#333' },
  btnText: { color: '#fff', fontWeight: '700' },
});
