import { useState } from 'react';
import { Text, View, StyleSheet, TextInput, Platform } from 'react-native';
import { Button } from '@react-navigation/elements';
import { useRouter, Link } from 'expo-router';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
  
  // 1. Add a dedicated error state
  const [errorMsg, setErrorMsg] = useState(''); 

  const handleEmailLogin = async () => {
    // 2. Clear previous errors on new attempt
    setErrorMsg(''); 

    if (!email || !password) {
      setErrorMsg('Please fill in all fields.');
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/auth/login`, {
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

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        setErrorMsg('Critical server error (500).');
        return;
      }

      if (response.ok && data.accessToken) {
        if (Platform.OS === 'web') {
          localStorage.setItem('music_room_token', data.accessToken);
        }
        router.replace('/home');
      } else {
        setErrorMsg('Invalid email or password.');
      }
    } catch (error) {
      console.error('Connection error:', error);
      setErrorMsg('Network Error: Could not connect to the backend API.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Music Room Login</Text>

      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

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
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button onPress={handleEmailLogin}>Login</Button>

      <Link href="/register" style={styles.link}>
        <Text style={styles.linkText}>Don't have an account? Register here</Text>
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
  errorText: {
    color: '#ff3333',
    backgroundColor: '#ffe6e6',
    padding: 10,
    borderRadius: 6,
    width: '80%',
    maxWidth: 400,
    textAlign: 'center',
    marginBottom: 15,
    overflow: 'hidden',
    fontWeight: 'bold',
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