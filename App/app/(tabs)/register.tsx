import { useState } from 'react';
import { Text, View, StyleSheet, TextInput, Alert } from 'react-native';
import { Button } from '@react-navigation/elements';
import { useRouter, Link } from 'expo-router';

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');

  const handleRegister = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          metadata: {
            platform: 'web',
            device: 'browser',
            appVersion: '1.0.0',
          },
        }),
      });

      const data = await response.json();

      if (response.ok) {
        Alert.alert('Success', data.message || 'Registration successful! Please log in.');
        router.replace('/login');
      } else {
        Alert.alert('Registration Failed', data.message || data.error || 'Could not register');
      }
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Error', 'Could not connect to the backend server.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create an Account</Text>

      <TextInput
        style={styles.configInput}
        placeholder="Backend Base URL"
        value={backendUrl}
        onChangeText={setBackendUrl}
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Password (min 6 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button onPress={handleRegister}>Register</Button>

      <Link href="/login" style={styles.link}>
        <Text style={styles.linkText}>Already have an account? Login here</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    width: '80%',
    maxWidth: 400,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    borderRadius: 6,
  },
  configInput: {
    width: '80%',
    maxWidth: 400,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#ff9900',
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#fff9e6',
  },
  link: {
    marginTop: 20,
  },
  linkText: {
    color: '#0066cc',
    textDecorationLine: 'underline',
  },
});