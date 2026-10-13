import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useApiConfig } from '../contexts/ApiConfigContext';
import { GoogleAuth, useDevOAuthAvailable } from '../components/GoogleAuth';

export default function LoginScreen() {
  const router = useRouter();
  const { login, googleLogin, devOAuthLogin, forgotPassword, verifyEmail } = useAuth();
  const { backendUrl, setBackendUrl } = useApiConfig();
  const devOAuthAvailable = useDevOAuthAvailable();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Email verification modal (if user didn't verify yet)
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');

  // Server address modal
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [newBackendUrl, setNewBackendUrl] = useState(backendUrl);

  // Forgot password modal
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCodeSent, setResetCodeSent] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Veuillez renseigner votre email et mot de passe.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    const res = await login(email.trim(), password);
    setIsLoading(false);

    if (res.success) {
      router.replace('/home');
    } else {
      if (res.emailVerificationRequired) {
        setUnverifiedEmail(res.email || email.trim());
        setVerifyModalVisible(true);
      } else {
        setErrorMessage(res.error || 'Erreur lors de la connexion.');
      }
    }
  };

  const handleConfirmVerification = async () => {
    if (!verifyCode.trim()) {
      if (Platform.OS === 'web') {
        window.alert('Veuillez saisir votre code de validation.');
      } else {
        Alert.alert('Erreur', 'Veuillez saisir votre code de validation.');
      }
      return;
    }

    setIsLoading(true);
    const res = await verifyEmail(verifyCode.trim(), unverifiedEmail);
    setIsLoading(false);

    if (res.success) {
      setVerifyModalVisible(false);
      // Auto login
      await login(unverifiedEmail, password);
      router.replace('/home');
    } else {
      if (Platform.OS === 'web') {
        window.alert(res.error || 'Code invalide.');
      } else {
        Alert.alert('Erreur', res.error || 'Code invalide.');
      }
    }
  };

  const handleGoogleIdToken = async (idToken: string) => {
    setIsLoading(true);
    setErrorMessage('');
    const res = await googleLogin(idToken);
    setIsLoading(false);

    if (res.success) {
      router.replace('/home');
    } else {
      setErrorMessage(res.error || 'Erreur de connexion Google sur le serveur.');
    }
  };

  const handleDevOAuth = async () => {
    setIsLoading(true);
    setErrorMessage('');
    const res = await devOAuthLogin();
    setIsLoading(false);

    if (res.success) {
      router.replace('/home');
    } else {
      setErrorMessage(res.error || 'Connexion Google simulée indisponible.');
    }
  };

  const handleSaveServerUrl = async () => {
    await setBackendUrl(newBackendUrl);
    setServerModalVisible(false);
    Alert.alert('Succès', `Nouvelle adresse du backend enregistrée :\n${newBackendUrl}`);
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir votre adresse email.');
      return;
    }

    const res = await forgotPassword(forgotEmail.trim());
    if (res.success) {
      if (Platform.OS === 'web') {
        window.alert('Si le compte existe, un email contenant votre code de réinitialisation vient de vous être envoyé.');
      } else {
        Alert.alert('Email envoyé', 'Si le compte existe, un email contenant votre code de réinitialisation vient de vous être envoyé.');
      }
      setForgotModalVisible(false);
    } else {
      if (Platform.OS === 'web') {
        window.alert(res.error || 'Une erreur est survenue.');
      } else {
        Alert.alert('Erreur', res.error || 'Une erreur est survenue.');
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header toolbar with server config */}
        <View style={styles.topToolbar}>
          <TouchableOpacity
            style={styles.serverButton}
            onPress={() => {
              setNewBackendUrl(backendUrl);
              setServerModalVisible(true);
            }}
          >
            <Ionicons name="server-outline" size={18} color="#aaa" />
            <Text style={styles.serverButtonText} numberOfLines={1}>
              API: {backendUrl}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Title & Logo */}
        <View style={styles.header}>
          <Ionicons name="musical-notes" size={54} color="#1DB954" />
          <Text style={styles.title}>Music Room</Text>
          <Text style={styles.subtitle}>Connectez-vous pour rejoindre l’expérience</Text>
        </View>

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color="#ff5555" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="exemple@email.com"
            placeholderTextColor="#666"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#666"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity
            style={styles.forgotButton}
            onPress={() => {
              setForgotEmail(email);
              setForgotModalVisible(true);
            }}
          >
            <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.loginButton, isLoading && styles.disabledButton]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>Se connecter</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Social / OAuth divider */}
        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OU VIA UN RÉSEAU SOCIAL</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.oauthContainer}>
          <GoogleAuth onIdToken={handleGoogleIdToken} onError={setErrorMessage}>
            {({ prompt, ready }) => (
              <TouchableOpacity
                style={[styles.oauthButton, styles.googleButton, (!ready || isLoading) && styles.disabledButton]}
                onPress={prompt}
                disabled={!ready || isLoading}
              >
                <Ionicons name="logo-google" size={20} color="#EA4335" />
                <Text style={styles.oauthText}>Continuer avec Google</Text>
              </TouchableOpacity>
            )}
          </GoogleAuth>

          {devOAuthAvailable && (
            <TouchableOpacity
              style={[styles.oauthButton, isLoading && styles.disabledButton]}
              onPress={handleDevOAuth}
              disabled={isLoading}
            >
              <Ionicons name="construct-outline" size={20} color="#aaa" />
              <Text style={styles.oauthText}>Google simulé (dev)</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Switch to Register */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Pas encore de compte ?</Text>
          <TouchableOpacity onPress={() => router.push('/register')}>
            <Text style={styles.registerLink}>Créer un compte</Text>
          </TouchableOpacity>
        </View>

        {/* Server URL Config Modal */}
        <Modal
          visible={serverModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setServerModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Configuration Backend</Text>
              <Text style={styles.modalDesc}>
                Configurez l'adresse IP et le port du serveur backend (exigence du sujet pour les tests).
              </Text>

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
                  style={[styles.modalBtn, styles.saveBtn]}
                  onPress={handleSaveServerUrl}
                >
                  <Text style={[styles.modalBtnText, { color: '#000', fontWeight: 'bold' }]}>
                    Enregistrer
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Forgot password Modal */}
        <Modal
          visible={forgotModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setForgotModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Réinitialisation</Text>
              <Text style={styles.modalDesc}>
                Entrez votre adresse email pour recevoir un code de réinitialisation.
              </Text>

              <TextInput
                style={styles.modalInput}
                value={forgotEmail}
                onChangeText={setForgotEmail}
                placeholder="exemple@email.com"
                placeholderTextColor="#666"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {resetCodeSent && (
                <Text style={{ color: '#1DB954', marginTop: 10, textAlign: 'center' }}>
                  Code généré : {resetCodeSent}
                </Text>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.cancelBtn]}
                  onPress={() => {
                    setForgotModalVisible(false);
                    setResetCodeSent(null);
                  }}
                >
                  <Text style={styles.modalBtnText}>Fermer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, styles.saveBtn]}
                  onPress={handleForgotPassword}
                >
                  <Text style={[styles.modalBtnText, { color: '#000', fontWeight: 'bold' }]}>
                    Envoyer
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Unverified Email Modal */}
        <Modal
          visible={verifyModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setVerifyModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Ionicons name="mail-unread-outline" size={40} color="#1DB954" style={{ alignSelf: 'center', marginBottom: 12 }} />
              <Text style={styles.modalTitle}>Validation requise</Text>
              <Text style={styles.modalDesc}>
                Votre compte n'est pas encore activé. Veuillez saisir le code à 6 chiffres reçu à l'adresse :
              </Text>
              <Text style={{ color: '#1DB954', fontWeight: 'bold', textAlign: 'center', marginBottom: 14 }}>
                {unverifiedEmail}
              </Text>

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
                  style={[styles.modalBtn, styles.saveBtn]}
                  onPress={handleConfirmVerification}
                >
                  <Text style={[styles.modalBtnText, { color: '#000', fontWeight: 'bold' }]}>
                    Valider le code
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  scrollContent: {
    padding: 24,
    justifyContent: 'center',
    minHeight: '100%',
  },
  topToolbar: {
    alignItems: 'flex-end',
    marginBottom: 20,
  },
  serverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333',
    maxWidth: '90%',
  },
  serverButtonText: {
    color: '#888',
    fontSize: 12,
    marginLeft: 6,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 6,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 85, 85, 0.15)',
    borderColor: '#ff5555',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff7777',
    fontSize: 13,
    marginLeft: 8,
    flex: 1,
  },
  form: {
    marginBottom: 24,
  },
  label: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#1e1e1e',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 10,
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginBottom: 16,
  },
  forgotText: {
    color: '#1DB954',
    fontSize: 13,
  },
  loginButton: {
    backgroundColor: '#1DB954',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2a2a2a',
  },
  dividerText: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700',
    marginHorizontal: 10,
  },
  oauthContainer: {
    gap: 12,
    marginBottom: 24,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e1e',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 12,
  },
  googleButton: {},
  facebookButton: {},
  oauthText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  footerText: {
    color: '#888',
    fontSize: 14,
  },
  registerLink: {
    color: '#1DB954',
    fontSize: 14,
    fontWeight: 'bold',
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
    lineHeight: 18,
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
  saveBtn: {
    backgroundColor: '#1DB954',
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
