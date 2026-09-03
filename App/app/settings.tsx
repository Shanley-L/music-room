import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  getApiBaseUrl,
  getWsBaseUrl,
  setApiBaseUrl,
  resetApiBaseUrl,
} from '../lib/apiConfig';

export default function SettingsScreen() {
  const router = useRouter();
  const [url, setUrl] = useState(getApiBaseUrl());
  const [saving, setSaving] = useState(false);

  const notify = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(message);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSave = async () => {
    if (!url.trim()) {
      notify('Erreur', "L'adresse ne peut pas être vide");
      return;
    }

    setSaving(true);
    try {
      const saved = await setApiBaseUrl(url);
      setUrl(saved);
      notify('Enregistré', `Le backend pointe maintenant sur ${saved}`);
    } catch (err: any) {
      notify('Erreur', err?.message || "Impossible d'enregistrer l'adresse");
    } finally {
      setSaving(false);
    }
  };

  const confirmReset = () => {
    if (saving) return;

    const doReset = async () => {
      setSaving(true);
      try {
        await resetApiBaseUrl();
        setUrl(getApiBaseUrl());
        notify('Réinitialisé', `Adresse par défaut : ${getApiBaseUrl()}`);
      } catch (err: any) {
        notify('Erreur', err?.message || "Impossible de réinitialiser l'adresse");
      } finally {
        setSaving(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Revenir à l’adresse par défaut ?')) doReset();
    } else {
      Alert.alert('Réinitialiser', 'Revenir à l’adresse par défaut ?', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Réinitialiser', style: 'destructive', onPress: doReset },
      ]);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.navBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          hitSlop={10}
          style={styles.navIconBtn}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.navTitle}>Réglages</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Adresse du backend</Text>
        <Text style={styles.sectionHint}>
          Utilisée par tous les appels REST et, dès que le temps réel est actif
          (Story 2.4), par la connexion Socket.IO — une seule base, même port.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="http://localhost:3000"
          placeholderTextColor="#666"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>REST</Text>
          <Text style={styles.infoValue}>{getApiBaseUrl()}</Text>
          <Text style={styles.infoLabel}>Socket (temps réel)</Text>
          <Text style={styles.infoValue}>{getWsBaseUrl()}</Text>
        </View>

        <Pressable
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.resetButton, saving && { opacity: 0.6 }]}
          onPress={confirmReset}
          disabled={saving}
        >
          <Text style={styles.resetButtonText}>
            Réinitialiser à la valeur par défaut
          </Text>
        </Pressable>

        <Text style={styles.note}>
          La valeur est persistée sur l’appareil et relue au démarrage. Changer
          cette adresse ne requiert pas de recompiler l’app. La valeur par
          défaut provient de EXPO_PUBLIC_API_URL (ou localhost:3000).
        </Text>
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
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
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
  section: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 16,
  },
  sectionLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionHint: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
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
    marginBottom: 14,
  },
  infoCard: {
    backgroundColor: '#241a3a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#652edc',
  },
  infoLabel: {
    color: '#a77bf3',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  infoValue: {
    color: '#fff',
    fontSize: 13,
    marginTop: 2,
    marginBottom: 6,
  },
  saveButton: {
    backgroundColor: '#652edc',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  resetButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#a77bf3',
    fontSize: 13,
    fontWeight: '600',
  },
  note: {
    color: '#666',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});