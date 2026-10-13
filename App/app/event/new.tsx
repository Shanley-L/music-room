import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useAuthedFetch } from '../../hooks/use-authed-fetch';
import { errorMessage, notify } from '../../utils/feedback';
import { RoomLicense, RoomVisibility } from '../../types/room';

const pad = (n: number) => String(n).padStart(2, '0');

/** `JJ/MM/AAAA HH:MM` in local time. */
function formatDate(d: Date) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses `JJ/MM/AAAA HH:MM` (local time); null when invalid. */
function parseDate(text: string): Date | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, day, month, year, hours, minutes] = m.map(Number);
  const d = new Date(year, month - 1, day, hours, minutes);
  // Reject overflow such as 31/02.
  if (d.getMonth() !== month - 1 || d.getDate() !== day || hours > 23 || minutes > 59) return null;
  return d;
}

function parseNumber(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
}

export default function NewEventScreen() {
  const router = useRouter();
  const apiFetch = useAuthedFetch();

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<RoomVisibility>('PUBLIC');
  const [license, setLicense] = useState<RoomLicense>('EVERYONE');

  const [useZone, setUseZone] = useState(true);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('200');
  const [locating, setLocating] = useState(false);

  const [useWindow, setUseWindow] = useState(true);
  const [startAt, setStartAt] = useState(() => formatDate(new Date()));
  const [endAt, setEndAt] = useState(() => formatDate(new Date(Date.now() + 3 * 3600 * 1000)));

  const [creating, setCreating] = useState(false);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/events');
  };

  const fillMyPosition = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        notify('Localisation', "L'autorisation de localisation est nécessaire pour utiliser votre position.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLatitude(pos.coords.latitude.toFixed(6));
      setLongitude(pos.coords.longitude.toFixed(6));
    } catch (err) {
      console.log('Location error:', err);
      notify('Localisation', 'Impossible de récupérer votre position.');
    } finally {
      setLocating(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      notify('Erreur', "Veuillez saisir un nom d'événement");
      return;
    }

    const body: Record<string, unknown> = { name: name.trim(), visibility, license };

    if (license === 'GEO_TIME_RESTRICTED') {
      if (!useZone && !useWindow) {
        notify('Erreur', 'Choisissez une zone, une plage horaire, ou les deux.');
        return;
      }
      if (useZone) {
        const lat = parseNumber(latitude);
        const lng = parseNumber(longitude);
        const r = parseNumber(radius);
        if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          notify('Erreur', 'Position de la zone invalide.');
          return;
        }
        if (r === null || r <= 0 || !Number.isInteger(r)) {
          notify('Erreur', 'Le rayon doit être un nombre entier de mètres.');
          return;
        }
        Object.assign(body, { latitude: lat, longitude: lng, radiusM: r });
      }
      if (useWindow) {
        const start = parseDate(startAt);
        const end = parseDate(endAt);
        if (!start || !end) {
          notify('Erreur', 'Dates invalides (format JJ/MM/AAAA HH:MM).');
          return;
        }
        if (start >= end) {
          notify('Erreur', 'Le début doit précéder la fin.');
          return;
        }
        Object.assign(body, { voteStartAt: start.toISOString(), voteEndAt: end.toISOString() });
      }
    }

    setCreating(true);
    try {
      const res = await apiFetch('/api/rooms', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, "Impossible de créer l'événement"));
      router.replace(`/event/${data.id}`);
    } catch (err: any) {
      notify('Erreur', err.message || "Impossible de créer l'événement");
    } finally {
      setCreating(false);
    }
  };

  const option = <T extends string>(
    value: T,
    current: T,
    set: (v: T) => void,
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    sub: string
  ) => (
    <Pressable
      key={value}
      style={[styles.optionCard, current === value && styles.activeOptionCard]}
      onPress={() => set(value)}
    >
      <Ionicons name={icon} size={20} color={current === value ? '#652edc' : '#888'} />
      <Text style={[styles.optionTitle, current === value && styles.activeOptionTitle]}>{title}</Text>
      <Text style={styles.optionSub}>{sub}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={styles.navBar}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          style={styles.navIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.navTitle}>Nouvel événement</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.inputLabel}>Nom de l&apos;événement *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Soirée du vendredi"
          placeholderTextColor="#666"
          value={name}
          onChangeText={setName}
          maxLength={100}
        />

        <Text style={styles.inputLabel}>Visibilité</Text>
        <View style={styles.optionRow}>
          {option('PUBLIC', visibility, setVisibility, 'globe-outline', 'Public', 'Visible par tous')}
          {option('PRIVATE', visibility, setVisibility, 'lock-closed', 'Privé', "Code d'invitation")}
        </View>

        <Text style={styles.inputLabel}>Qui peut voter</Text>
        <View style={styles.optionRow}>
          {option('EVERYONE', license, setLicense, 'people-outline', 'Tout le monde', 'Vote ouvert')}
          {option('INVITED_ONLY', license, setLicense, 'shield-checkmark-outline', 'Invités', 'Vote restreint')}
          {option('GEO_TIME_RESTRICTED', license, setLicense, 'location-outline', 'Lieu / heure', 'Sur place')}
        </View>

        {license === 'GEO_TIME_RESTRICTED' && (
          <View style={styles.geoBox}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Zone géographique</Text>
              <Switch value={useZone} onValueChange={setUseZone} trackColor={{ true: '#652edc' }} />
            </View>
            {useZone && (
              <>
                <View style={styles.inlineRow}>
                  <TextInput
                    style={[styles.input, styles.inlineInput]}
                    placeholder="Latitude"
                    placeholderTextColor="#666"
                    value={latitude}
                    onChangeText={setLatitude}
                    keyboardType="numbers-and-punctuation"
                  />
                  <TextInput
                    style={[styles.input, styles.inlineInput]}
                    placeholder="Longitude"
                    placeholderTextColor="#666"
                    value={longitude}
                    onChangeText={setLongitude}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <Pressable style={styles.secondaryButton} onPress={fillMyPosition} disabled={locating}>
                  {locating ? (
                    <ActivityIndicator size="small" color="#a77bf3" />
                  ) : (
                    <>
                      <Ionicons name="navigate-outline" size={16} color="#a77bf3" />
                      <Text style={styles.secondaryButtonText}>Utiliser ma position</Text>
                    </>
                  )}
                </Pressable>
                <Text style={styles.smallLabel}>Rayon (mètres)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="200"
                  placeholderTextColor="#666"
                  value={radius}
                  onChangeText={setRadius}
                  keyboardType="number-pad"
                />
              </>
            )}

            <View style={[styles.switchRow, { marginTop: 14 }]}>
              <Text style={styles.switchLabel}>Plage horaire</Text>
              <Switch value={useWindow} onValueChange={setUseWindow} trackColor={{ true: '#652edc' }} />
            </View>
            {useWindow && (
              <>
                <Text style={styles.smallLabel}>Début (JJ/MM/AAAA HH:MM)</Text>
                <TextInput
                  style={styles.input}
                  value={startAt}
                  onChangeText={setStartAt}
                  placeholderTextColor="#666"
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.smallLabel}>Fin (JJ/MM/AAAA HH:MM)</Text>
                <TextInput
                  style={styles.input}
                  value={endAt}
                  onChangeText={setEndAt}
                  placeholderTextColor="#666"
                  keyboardType="numbers-and-punctuation"
                />
              </>
            )}
          </View>
        )}

        <Pressable
          style={[styles.submitButton, creating && { opacity: 0.6 }]}
          onPress={handleCreate}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.submitButtonText}>Créer l&apos;événement</Text>
          )}
        </Pressable>
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
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  navIconBtn: {
    padding: 6,
  },
  navTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  form: {
    paddingBottom: 40,
  },
  inputLabel: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  smallLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#383838',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  inlineInput: {
    flex: 1,
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
    textAlign: 'center',
  },
  activeOptionTitle: {
    color: '#fff',
  },
  optionSub: {
    color: '#666',
    fontSize: 10,
    textAlign: 'center',
  },
  geoBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#252525',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#652edc',
    borderRadius: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#a77bf3',
    fontSize: 13,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#652edc',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
