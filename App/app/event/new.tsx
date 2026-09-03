import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
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
};

const RADIUS_MIN = 20;
const RADIUS_MAX = 500;
const RADIUS_DEFAULT = 100;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

const geoKeyboardType = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

export default function NewEventScreen() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [license, setLicense] = useState<License>('EVERYONE');
  const [radius, setRadius] = useState(String(RADIUS_DEFAULT));
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locating, setLocating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<Room | null>(null);
  const [copied, setCopied] = useState(false);

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

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home');
    }
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      notify('Erreur', 'Veuillez saisir un nom pour l’événement');
      return;
    }

    let radiusM: number | undefined;
    if (license === 'GEO_RESTRICTED') {
      const parsedRadius = Number(radius);
      if (
        !Number.isInteger(parsedRadius) ||
        parsedRadius < RADIUS_MIN ||
        parsedRadius > RADIUS_MAX
      ) {
        notify(
          'Erreur',
          `Le rayon doit être un nombre entier entre ${RADIUS_MIN} et ${RADIUS_MAX} m`
        );
        return;
      }
      radiusM = parsedRadius;
    }

    let lat: number | undefined;
    let lon: number | undefined;
    if (license === 'GEO_RESTRICTED') {
      const latStr = latitude.trim();
      const lonStr = longitude.trim();

      if (!DECIMAL_RE.test(latStr)) {
        notify('Erreur', 'La latitude doit être un nombre entre -90 et 90.');
        return;
      }
      const parsedLat = Number(latStr);
      if (parsedLat < -90 || parsedLat > 90) {
        notify('Erreur', 'La latitude doit être un nombre entre -90 et 90.');
        return;
      }

      if (!DECIMAL_RE.test(lonStr)) {
        notify('Erreur', 'La longitude doit être un nombre entre -180 et 180.');
        return;
      }
      const parsedLon = Number(lonStr);
      if (parsedLon < -180 || parsedLon > 180) {
        notify('Erreur', 'La longitude doit être un nombre entre -180 et 180.');
        return;
      }

      lat = parsedLat;
      lon = parsedLon;
    }

    setCreating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const body: Record<string, unknown> = {
        name: trimmedName,
        visibility,
        license,
      };
      if (license === 'GEO_RESTRICTED' && radiusM != null) {
        body.radiusM = radiusM;
      }
      if (license === 'GEO_RESTRICTED' && lat != null && lon != null) {
        body.latitude = lat;
        body.longitude = lon;
      }

      const res = await fetch(`${getApiBaseUrl()}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-user-id': 'anonymous_user',
        },
        body: JSON.stringify(body),
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
        throw new Error(data.error || 'Erreur lors de la création de la salle');
      }

      if (
        typeof data.id !== 'string' ||
        !data.id ||
        typeof data.name !== 'string' ||
        !data.name
      ) {
        throw new Error('Réponse invalide du serveur');
      }

      setCreatedRoom(data as Room);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        notify('Erreur', 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.');
      } else {
        notify('Erreur', err?.message || 'Impossible de créer la salle');
      }
    } finally {
      clearTimeout(timeoutId);
      setCreating(false);
    }
  };

  const handleLocate = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        notify(
          'Autorisation de localisation refusée',
          'Vous pouvez saisir manuellement la latitude et la longitude de la zone.'
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({});
      setLatitude(position.coords.latitude.toFixed(5));
      setLongitude(position.coords.longitude.toFixed(5));
    } catch {
      notify(
        'Erreur',
        'Impossible d’obtenir votre position. Saisissez la latitude et la longitude manuellement.'
      );
    } finally {
      setLocating(false);
    }
  };

  const handleShareInvite = async () => {
    if (!createdRoom?.inviteCode) return;
    const message = `Rejoins ma salle « ${createdRoom.name} » sur Music Room avec le code d’invitation : ${createdRoom.inviteCode}`;

    if (Platform.OS === 'web') {
      try {
        if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          navigator.clipboard.writeText
        ) {
          await navigator.clipboard.writeText(createdRoom.inviteCode);
          setCopied(true);
          setTimeout(() => {
            if (isMountedRef.current) setCopied(false);
          }, 2000);
        } else {
          notify('Code d’invitation', `Code : ${createdRoom.inviteCode}`);
        }
      } catch {
        notify('Code d’invitation', `Code : ${createdRoom.inviteCode}`);
      }
    } else {
      try {
        await Share.share({ message });
      } catch {
        notify('Erreur', 'Impossible de partager le code');
      }
    }
  };

  const resetForm = () => {
    setCreatedRoom(null);
    setName('');
    setVisibility('PUBLIC');
    setLicense('EVERYONE');
    setRadius(String(RADIUS_DEFAULT));
    setLatitude('');
    setLongitude('');
    setCopied(false);
  };

  if (createdRoom) {
    return (
      <View style={styles.container}>
        <View style={styles.navBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={10}
            style={styles.navIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Retour"
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.navTitle}>Salle créée</Text>
          <View style={styles.navSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.successScrollContent}>
          <View style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={48} color="#10b981" />
            <Text style={styles.successTitle}>{createdRoom.name}</Text>
            <Text style={styles.successSubtitle}>
              L’événement est prêt. Partagez l’accès et lancez les votes.
            </Text>

            {createdRoom.visibility === 'PRIVATE' ? (
              <View style={styles.inviteCard}>
                <Text style={styles.inviteLabel}>Code d’invitation</Text>
                {createdRoom.inviteCode ? (
                  <>
                    <Text style={styles.inviteCode}>{createdRoom.inviteCode}</Text>
                    <Pressable
                      style={[styles.shareButton, copied && styles.shareButtonCopied]}
                      onPress={handleShareInvite}
                      accessibilityRole="button"
                      accessibilityLabel="Partager le code d’invitation"
                    >
                      <Ionicons
                        name={copied ? 'checkmark' : 'share-outline'}
                        size={16}
                        color={copied ? '#10b981' : '#fff'}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.shareButtonText,
                          copied && { color: '#10b981' },
                        ]}
                      >
                        {copied ? 'Code copié !' : 'Partager le code'}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.inviteUnavailable}>Code indisponible</Text>
                )}
              </View>
            ) : (
              <View style={styles.visibilityNote}>
                <Ionicons name="globe-outline" size={14} color="#10b981" />
                <Text style={styles.visibilityNoteText}>
                  Salle publique — accessible à tous.
                </Text>
              </View>
            )}

            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push(`/room/${createdRoom.id}`)}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Aller à l’écran de vote</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={resetForm}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Créer une autre salle</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.navBar}>
        <Pressable
          onPress={handleBack}
          hitSlop={10}
          style={styles.navIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.navTitle}>Créer un événement</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.formCard}>
          <Text style={styles.inputLabel}>Nom de l’événement *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex : Apéro Alex, Concert live..."
            placeholderTextColor="#666"
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.inputLabel}>Visibilité</Text>
          <View style={styles.optionRow}>
            <Pressable
              style={[
                styles.optionCard,
                visibility === 'PUBLIC' && styles.activeOptionCard,
              ]}
              onPress={() => setVisibility('PUBLIC')}
              accessibilityRole="button"
              accessibilityState={{ selected: visibility === 'PUBLIC' }}
            >
              <Ionicons
                name="globe-outline"
                size={20}
                color={visibility === 'PUBLIC' ? '#652edc' : '#888'}
              />
              <Text
                style={[
                  styles.optionTitle,
                  visibility === 'PUBLIC' && styles.activeOptionTitle,
                ]}
              >
                Publique
              </Text>
              <Text style={styles.optionSub}>Accessible à tous</Text>
            </Pressable>

            <Pressable
              style={[
                styles.optionCard,
                visibility === 'PRIVATE' && styles.activeOptionCard,
              ]}
              onPress={() => setVisibility('PRIVATE')}
              accessibilityRole="button"
              accessibilityState={{ selected: visibility === 'PRIVATE' }}
            >
              <Ionicons
                name="lock-closed"
                size={20}
                color={visibility === 'PRIVATE' ? '#652edc' : '#888'}
              />
              <Text
                style={[
                  styles.optionTitle,
                  visibility === 'PRIVATE' && styles.activeOptionTitle,
                ]}
              >
                Privée
              </Text>
              <Text style={styles.optionSub}>Code d’invitation</Text>
            </Pressable>
          </View>

          <Text style={styles.inputLabel}>Licence de vote</Text>
          <View style={styles.licenseList}>
            <Pressable
              style={[
                styles.licenseOption,
                license === 'EVERYONE' && styles.activeLicenseOption,
              ]}
              onPress={() => setLicense('EVERYONE')}
              accessibilityRole="button"
              accessibilityState={{ selected: license === 'EVERYONE' }}
            >
              <Ionicons
                name="people-outline"
                size={20}
                color={license === 'EVERYONE' ? '#652edc' : '#888'}
              />
              <View style={styles.licenseTextBlock}>
                <Text
                  style={[
                    styles.licenseTitle,
                    license === 'EVERYONE' && styles.activeOptionTitle,
                  ]}
                >
                  Tous
                </Text>
                <Text style={styles.optionSub}>Tout le monde peut voter</Text>
              </View>
              {license === 'EVERYONE' && (
                <Ionicons name="checkmark-circle" size={18} color="#652edc" />
              )}
            </Pressable>

            <Pressable
              style={[
                styles.licenseOption,
                license === 'INVITED_ONLY' && styles.activeLicenseOption,
              ]}
              onPress={() => setLicense('INVITED_ONLY')}
              accessibilityRole="button"
              accessibilityState={{ selected: license === 'INVITED_ONLY' }}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={license === 'INVITED_ONLY' ? '#652edc' : '#888'}
              />
              <View style={styles.licenseTextBlock}>
                <Text
                  style={[
                    styles.licenseTitle,
                    license === 'INVITED_ONLY' && styles.activeOptionTitle,
                  ]}
                >
                  Invités seuls
                </Text>
                <Text style={styles.optionSub}>Vote réservé aux invités</Text>
              </View>
              {license === 'INVITED_ONLY' && (
                <Ionicons name="checkmark-circle" size={18} color="#652edc" />
              )}
            </Pressable>

            <Pressable
              style={[
                styles.licenseOption,
                license === 'GEO_RESTRICTED' && styles.activeLicenseOption,
              ]}
              onPress={() => setLicense('GEO_RESTRICTED')}
              accessibilityRole="button"
              accessibilityState={{ selected: license === 'GEO_RESTRICTED' }}
            >
              <Ionicons
                name="location-outline"
                size={20}
                color={license === 'GEO_RESTRICTED' ? '#652edc' : '#888'}
              />
              <View style={styles.licenseTextBlock}>
                <Text
                  style={[
                    styles.licenseTitle,
                    license === 'GEO_RESTRICTED' && styles.activeOptionTitle,
                  ]}
                >
                  Lieu restreint
                </Text>
                <Text style={styles.optionSub}>Vote limité à une zone</Text>
              </View>
              {license === 'GEO_RESTRICTED' && (
                <Ionicons name="checkmark-circle" size={18} color="#652edc" />
              )}
            </Pressable>
          </View>

          {license === 'GEO_RESTRICTED' && (
            <View style={styles.geoBlock}>
              <Pressable
                style={[styles.locateButton, locating && { opacity: 0.6 }]}
                onPress={handleLocate}
                disabled={locating}
                accessibilityRole="button"
                accessibilityLabel="Me localiser"
              >
                {locating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="locate-outline"
                      size={16}
                      color="#fff"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.locateButtonText}>Me localiser</Text>
                  </>
                )}
              </Pressable>

              <Text style={styles.inputLabel}>Rayon de la zone (m) *</Text>
              <TextInput
                style={styles.input}
                placeholder="100"
                placeholderTextColor="#666"
                value={radius}
                onChangeText={setRadius}
                keyboardType="number-pad"
              />

              <View style={styles.geoInputsRow}>
                <View style={styles.geoInputCol}>
                  <Text style={styles.inputLabel}>Latitude *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="48.85"
                    placeholderTextColor="#666"
                    value={latitude}
                    onChangeText={setLatitude}
                    keyboardType={geoKeyboardType}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.geoInputCol}>
                  <Text style={styles.inputLabel}>Longitude *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="2.35"
                    placeholderTextColor="#666"
                    value={longitude}
                    onChangeText={setLongitude}
                    keyboardType={geoKeyboardType}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <Text style={styles.geoNote}>
                La localisation sera demandée aux votants.
              </Text>
              <Text style={styles.geoHint}>
                Rayon paramétrable entre {RADIUS_MIN} et {RADIUS_MAX} m (défaut{' '}
                {RADIUS_DEFAULT} m). La position est pré-remplie via « Me
                localiser » ou saisie manuellement.
              </Text>
            </View>
          )}

          <Pressable
            style={[styles.submitButton, creating && { opacity: 0.6 }]}
            onPress={handleCreate}
            disabled={creating}
            accessibilityRole="button"
          >
            {creating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Créer la salle</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 20,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  successScrollContent: {
    paddingBottom: 24,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  navIconBtn: {
    padding: 6,
  },
  navTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  navSpacer: {
    width: 36,
  },
  formCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 16,
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
  input: {
    backgroundColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#383838',
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
  licenseList: {
    gap: 8,
  },
  licenseOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#242424',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
    gap: 10,
  },
  activeLicenseOption: {
    backgroundColor: '#251b3a',
    borderColor: '#652edc',
  },
  licenseTextBlock: {
    flex: 1,
    gap: 2,
  },
  licenseTitle: {
    color: '#bbb',
    fontSize: 14,
    fontWeight: '600',
  },
  geoBlock: {
    marginTop: 6,
    backgroundColor: '#1f1a2e',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#652edc',
  },
  locateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#652edc',
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 4,
  },
  locateButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  geoInputsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  geoInputCol: {
    flex: 1,
  },
  geoNote: {
    color: '#a77bf3',
    fontSize: 12,
    marginTop: 10,
  },
  geoHint: {
    color: '#777',
    fontSize: 11,
    marginTop: 4,
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
  successCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  successTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
  },
  successSubtitle: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  inviteCard: {
    alignSelf: 'stretch',
    backgroundColor: '#261b05',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#78350f',
  },
  inviteLabel: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inviteCode: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 6,
    marginVertical: 8,
  },
  inviteUnavailable: {
    color: '#f59e0b',
    fontSize: 13,
    marginVertical: 8,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#652edc',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  shareButtonCopied: {
    backgroundColor: '#0d281e',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  visibilityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
  },
  visibilityNoteText: {
    color: '#10b981',
    fontSize: 12,
  },
  primaryButton: {
    alignSelf: 'stretch',
    backgroundColor: '#652edc',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: '#a77bf3',
    fontSize: 13,
    fontWeight: '600',
  },
});