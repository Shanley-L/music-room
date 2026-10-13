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
import { GoogleAuth } from '../components/GoogleAuth';

export default function RegisterScreen() {
  const router = useRouter();
  const { register, verifyEmail, login, googleLogin } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Email verification modal
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setErrorMessage('Tous les champs sont obligatoires.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Les mots de passe ne correspondent pas.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Le mot de passe doit comporter au moins 6 caractères.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    const res = await register(email.trim(), password, name.trim());
    setIsLoading(false);

    if (res.success) {
      setVerifyModalVisible(true);
    } else {
      setErrorMessage(res.error || 'Erreur lors de l’inscription.');
    }
  };

  // Google sign-up: the API creates the account from the verified Google identity.
  const handleGoogleIdToken = async (idToken: string) => {
    setIsLoading(true);
    setErrorMessage('');
    const res = await googleLogin(idToken);
    setIsLoading(false);

    if (res.success) {
      router.replace('/home');
    } else {
      setErrorMessage(res.error || 'Erreur lors de l’inscription avec Google.');
    }
  };

  const handleConfirmVerification = async () => {
    if (!verificationCode.trim()) {
      if (Platform.OS === 'web') {
        window.alert('Veuillez saisir le code de validation reçu par email.');
      } else {
        Alert.alert('Erreur', 'Veuillez saisir le code de validation reçu par email.');
      }
      return;
    }

    setIsLoading(true);
    const res = await verifyEmail(verificationCode.trim(), email.trim());
    setIsLoading(false);

    if (res.success) {
      setVerifyModalVisible(false);
      // Auto login after verification
      await login(email.trim(), password);
      if (Platform.OS === 'web') {
        window.alert('Votre adresse email a été validée avec succès !');
        router.replace('/home');
      } else {
        Alert.alert('Succès', 'Votre adresse email a été validée avec succès !', [
          {
            text: 'Commencer',
            onPress: () => router.replace('/home'),
          },
        ]);
      }
    } else {
      if (Platform.OS === 'web') {
        window.alert(res.error || 'Code invalide.');
      } else {
        Alert.alert('Erreur', res.error || 'Code invalide.');
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Ionicons name="person-add-outline" size={48} color="#1DB954" />
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.subtitle}>Rejoignez Music Room en quelques secondes</Text>
        </View>

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color="#ff5555" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Nom complet / Pseudo</Text>
          <TextInput
            style={styles.input}
            placeholder="John Doe"
            placeholderTextColor="#666"
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.label}>Adresse Email</Text>
          <TextInput
            style={styles.input}
            placeholder="exemple@email.com"
            placeholderTextColor="#666"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Mot de passe (min. 6 caractères)</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#666"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Text style={styles.label}>Confirmer le mot de passe</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#666"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          <TouchableOpacity
            style={[styles.registerButton, isLoading && styles.disabledButton]}
            onPress={handleRegister}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.registerButtonText}>S'inscrire</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OU</Text>
          <View style={styles.dividerLine} />
        </View>

        <GoogleAuth onIdToken={handleGoogleIdToken} onError={setErrorMessage}>
          {({ prompt, ready }) => (
            <TouchableOpacity
              style={[styles.googleButton, (!ready || isLoading) && styles.disabledButton]}
              onPress={prompt}
              disabled={!ready || isLoading}
            >
              <Ionicons name="logo-google" size={20} color="#EA4335" />
              <Text style={styles.googleText}>S’inscrire avec Google</Text>
            </TouchableOpacity>
          )}
        </GoogleAuth>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Déjà un compte ?</Text>
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text style={styles.loginLink}>Se connecter</Text>
          </TouchableOpacity>
        </View>

        {/* Email Verification Modal */}
        <Modal
          visible={verifyModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {}}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Ionicons name="mail-unread-outline" size={40} color="#1DB954" style={{ alignSelf: 'center', marginBottom: 12 }} />
              <Text style={styles.modalTitle}>Validation de l'email</Text>
              <Text style={styles.modalDesc}>
                Un email contenant votre code de validation à 6 chiffres vient d'être envoyé à l'adresse :
              </Text>
              <Text style={{ color: '#1DB954', fontWeight: 'bold', textAlign: 'center', marginBottom: 14 }}>
                {email}
              </Text>

              <TextInput
                style={[styles.modalInput, { textAlign: 'center', fontSize: 20, letterSpacing: 4 }]}
                value={verificationCode}
                onChangeText={setVerificationCode}
                placeholder="123456"
                placeholderTextColor="#666"
                keyboardType="number-pad"
                maxLength={6}
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.laterBtn]}
                  onPress={() => {
                    setVerifyModalVisible(false);
                    router.replace('/login');
                  }}
                >
                  <Text style={styles.modalBtnText}>Annuler</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, styles.confirmBtn]}
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
  header: {
    alignItems: 'center',
    marginBottom: 24,
    position: 'relative',
  },
  backBtn: {
    position: 'absolute',
    left: 0,
    top: 0,
    padding: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 10,
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
    marginBottom: 20,
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
  registerButton: {
    backgroundColor: '#1DB954',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  disabledButton: {
    opacity: 0.6,
  },
  registerButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
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
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e1e',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 12,
    marginBottom: 16,
  },
  googleText: {
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
  },
  footerText: {
    color: '#888',
    fontSize: 14,
  },
  loginLink: {
    color: '#1DB954',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
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
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalDesc: {
    color: '#aaa',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  codeHintBox: {
    backgroundColor: '#181818',
    borderColor: '#1DB954',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  codeHintLabel: {
    color: '#aaa',
    fontSize: 12,
  },
  codeHintVal: {
    color: '#1DB954',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 3,
    marginTop: 4,
  },
  modalInput: {
    backgroundColor: '#121212',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 8,
    color: '#fff',
    padding: 12,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  laterBtn: {
    backgroundColor: '#333',
  },
  confirmBtn: {
    backgroundColor: '#1DB954',
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
