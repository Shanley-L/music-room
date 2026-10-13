import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useApiConfig } from '../../contexts/ApiConfigContext';
import { GoogleAuth, useDevOAuthAvailable } from '../../components/GoogleAuth';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, updateProfile, linkGoogle, devLinkOAuth, logout, verifyEmail } = useAuth();
  const devOAuthAvailable = useDevOAuthAvailable();
  const { backendUrl, setBackendUrl } = useApiConfig();

  // Profile editable fields
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [friendsInfo, setFriendsInfo] = useState('');
  const [privateInfo, setPrivateInfo] = useState('');
  const [musicPreferences, setMusicPreferences] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  // Email verification modal
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');

  // Backend config modal
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [newBackendUrl, setNewBackendUrl] = useState(backendUrl);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setBio(user.bio || '');
      setFriendsInfo(user.friendsInfo || '');
      setPrivateInfo(user.privateInfo || '');
      setMusicPreferences(user.musicPreferences || '');
    }
  }, [user]);

  const handleSave = async () => {
    setIsSaving(true);
    const res = await updateProfile({
      name,
      bio,
      friendsInfo,
      privateInfo,
      musicPreferences,
    });
    setIsSaving(false);

    if (res.success) {
      Alert.alert('Succès', 'Votre profil a été mis à jour.');
    } else {
      Alert.alert('Erreur', res.error || 'Impossible de mettre à jour le profil.');
    }
  };

  const showLinkResult = (res: { success: boolean; error?: string }) => {
    if (res.success) {
      Alert.alert('Compte lié', 'Votre compte Google a été associé avec succès !');
    } else {
      Alert.alert('Erreur', res.error || 'Impossible de lier ce compte.');
    }
  };

  const handleLinkGoogle = async (idToken: string) => {
    showLinkResult(await linkGoogle(idToken));
  };

  const handleGoogleError = (message: string) => {
    Alert.alert('Google', message);
  };

  const handleDevLink = async () => {
    showLinkResult(await devLinkOAuth());
  };

  const handleVerifyEmail = async () => {
    if (!verifyCode.trim()) return;
    const res = await verifyEmail(verifyCode.trim());
    if (res.success) {
      setVerifyModalVisible(false);
      Alert.alert('Email validé', 'Votre adresse email est désormais confirmée.');
    } else {
      Alert.alert('Erreur', res.error || 'Code invalide.');
    }
  };

  const handleLogout = async () => {
    const performLogout = async () => {
      await logout();
      router.replace('/login');
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
        await performLogout();
      }
      return;
    }

    Alert.alert('Déconnexion', 'Êtes-vous sûr de vouloir vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion',
        style: 'destructive',
        onPress: performLogout,
      },
    ]);
  };

  if (!user) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.notLoggedInText}>Vous n'êtes pas connecté.</Text>
        <TouchableOpacity style={styles.loginBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.loginBtnText}>Se connecter</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header Profile */}
      <View style={styles.avatarSection}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarInitial}>{user.name ? user.name[0].toUpperCase() : 'U'}</Text>
        </View>
        <Text style={styles.userName}>{user.name}</Text>
        <Text style={styles.userEmail}>{user.email}</Text>

        <View style={styles.statusRow}>
          {user.isEmailVerified ? (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#1DB954" />
              <Text style={styles.verifiedText}>Email vérifié</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.unverifiedBadge}
              onPress={() => setVerifyModalVisible(true)}
            >
              <Ionicons name="warning-outline" size={14} color="#ffaa00" />
              <Text style={styles.unverifiedText}>Valider mon email</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Form sections */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Informations Publiques</Text>
        <Text style={styles.sectionDesc}>Visibles par tous les utilisateurs de Music Room.</Text>

        <Text style={styles.label}>Nom d'utilisateur</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Votre pseudo"
          placeholderTextColor="#666"
        />

        <Text style={styles.label}>Biographie / Présentation</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={bio}
          onChangeText={setBio}
          placeholder="Présentez-vous en quelques mots..."
          placeholderTextColor="#666"
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Préférences Musicales</Text>
        <Text style={styles.sectionDesc}>Genres préférés, artistes favoris, ambiances...</Text>

        <TextInput
          style={[styles.input, styles.textArea]}
          value={musicPreferences}
          onChangeText={setMusicPreferences}
          placeholder="Ex: Électro, Hip-Hop, Rock 70s, Daft Punk..."
          placeholderTextColor="#666"
          multiline
          numberOfLines={2}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Informations Amis & Privées</Text>

        <Text style={styles.label}>Visible uniquement par vos amis</Text>
        <TextInput
          style={styles.input}
          value={friendsInfo}
          onChangeText={setFriendsInfo}
          placeholder="Ex: @instagram, dispo le weekend..."
          placeholderTextColor="#666"
        />

        <Text style={styles.label}>Informations Privées (vous seul)</Text>
        <TextInput
          style={styles.input}
          value={privateInfo}
          onChangeText={setPrivateInfo}
          placeholder="Notes personnelles, ville..."
          placeholderTextColor="#666"
        />
      </View>

      {/* Save Button */}
      <TouchableOpacity
        style={[styles.saveButton, isSaving && styles.disabledButton]}
        onPress={handleSave}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.saveButtonText}>Enregistrer les modifications</Text>
        )}
      </TouchableOpacity>

      {/* Music Control Delegation */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Amis et appareils</Text>
        <Text style={styles.sectionDesc}>
          Donnez à vos amis le contrôle de la musique de vos appareils, ou contrôlez les leurs.
        </Text>
        {(
          [
            { icon: 'people-outline', label: 'Amis', href: '/friends' },
            { icon: 'phone-portrait-outline', label: 'Mes appareils', href: '/devices' },
            { icon: 'game-controller-outline', label: 'Partagés avec moi', href: '/remote' },
          ] as const
        ).map((link) => (
          <TouchableOpacity key={link.href} style={styles.navRow} onPress={() => router.push(link.href)}>
            <Ionicons name={link.icon} size={20} color="#a77bf3" />
            <Text style={styles.navRowText}>{link.label}</Text>
            <Ionicons name="chevron-forward" size={18} color="#555" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Social Networks Link */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Comptes Réseaux Sociaux</Text>
        <Text style={styles.sectionDesc}>Associez vos réseaux pour vous connecter en 1 clic.</Text>

        <View style={styles.oauthRow}>
          <View style={styles.oauthInfo}>
            <Ionicons name="logo-google" size={22} color="#EA4335" />
            <Text style={styles.oauthLabel}>Google</Text>
          </View>
          {user.googleId ? (
            <View style={styles.linkedBadge}>
              <Text style={styles.linkedText}>Lié</Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {devOAuthAvailable && (
                <TouchableOpacity style={styles.linkActionBtn} onPress={handleDevLink}>
                  <Text style={styles.linkActionText}>Lier (dev)</Text>
                </TouchableOpacity>
              )}
              <GoogleAuth onIdToken={handleLinkGoogle} onError={handleGoogleError}>
                {({ prompt, ready }) => (
                  <TouchableOpacity
                    style={[styles.linkActionBtn, !ready && { opacity: 0.6 }]}
                    onPress={prompt}
                    disabled={!ready}
                  >
                    <Text style={styles.linkActionText}>Lier</Text>
                  </TouchableOpacity>
                )}
              </GoogleAuth>
            </View>
          )}
        </View>
      </View>

      {/* Backend Settings (Subject Requirement) */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Configuration Système</Text>
        <Text style={styles.sectionDesc}>Adresse du backend (exigence du sujet pour les tests).</Text>

        <TouchableOpacity
          style={styles.serverRow}
          onPress={() => {
            setNewBackendUrl(backendUrl);
            setServerModalVisible(true);
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.serverLabel}>Adresse actuelle</Text>
            <Text style={styles.serverVal} numberOfLines={1}>{backendUrl}</Text>
          </View>
          <Ionicons name="create-outline" size={20} color="#1DB954" />
        </TouchableOpacity>
      </View>

      {/* Logout button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color="#ff5555" />
        <Text style={styles.logoutButtonText}>Déconnexion</Text>
      </TouchableOpacity>

      <View style={{ height: 100 }} />

      {/* Backend Modal */}
      <Modal visible={serverModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Modifier l'URL du Backend</Text>
            <TextInput
              style={styles.modalInput}
              value={newBackendUrl}
              onChangeText={setNewBackendUrl}
              placeholder="http://192.168.1.X:3000"
              placeholderTextColor="#666"
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setServerModalVisible(false)}
              >
                <Text style={styles.modalBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveModalBtn]}
                onPress={async () => {
                  await setBackendUrl(newBackendUrl);
                  setServerModalVisible(false);
                }}
              >
                <Text style={[styles.modalBtnText, { color: '#000', fontWeight: 'bold' }]}>
                  Enregistrer
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Email Verification Modal */}
      <Modal visible={verifyModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Valider votre email</Text>
            <Text style={styles.modalDesc}>Entrez le code à 6 chiffres pour confirmer votre compte.</Text>
            <TextInput
              style={[styles.modalInput, { textAlign: 'center', fontSize: 20, letterSpacing: 4 }]}
              value={verifyCode}
              onChangeText={setVerifyCode}
              placeholder="123456"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              maxLength={6}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setVerifyModalVisible(false)}
              >
                <Text style={styles.modalBtnText}>Fermer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveModalBtn]}
                onPress={handleVerifyEmail}
              >
                <Text style={[styles.modalBtnText, { color: '#000', fontWeight: 'bold' }]}>
                  Valider
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  scrollContent: {
    padding: 16,
    paddingTop: 48,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  notLoggedInText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  loginBtn: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  loginBtnText: {
    color: '#000',
    fontWeight: 'bold',
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarInitial: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#000',
  },
  userName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  userEmail: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  statusRow: {
    marginTop: 8,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(29, 185, 84, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  verifiedText: {
    color: '#1DB954',
    fontSize: 12,
    fontWeight: '600',
  },
  unverifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 170, 0, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  unverifiedText: {
    color: '#ffaa00',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262626',
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#262626',
  },
  navRowText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionDesc: {
    fontSize: 12,
    color: '#777',
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: '#1DB954',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  disabledButton: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 15,
  },
  oauthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#252525',
  },
  oauthInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  oauthLabel: {
    color: '#ddd',
    fontSize: 15,
    fontWeight: '500',
  },
  linkedBadge: {
    backgroundColor: '#262626',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  linkedText: {
    color: '#1DB954',
    fontSize: 12,
    fontWeight: 'bold',
  },
  linkActionBtn: {
    backgroundColor: '#333',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  linkActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#121212',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  serverLabel: {
    color: '#777',
    fontSize: 11,
  },
  serverVal: {
    color: '#1DB954',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ff5555',
    backgroundColor: 'rgba(255, 85, 85, 0.08)',
  },
  logoutButtonText: {
    color: '#ff5555',
    fontSize: 15,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#202020',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalDesc: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#121212',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 8,
    color: '#fff',
    padding: 12,
    fontSize: 14,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  cancelBtn: {
    backgroundColor: '#333',
  },
  saveModalBtn: {
    backgroundColor: '#1DB954',
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
