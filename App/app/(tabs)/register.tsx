import { useState } from 'react';
import { 
  Text, 
  View, 
  StyleSheet, 
  TextInput, 
  Platform,
  Alert 
} from 'react-native';
import { Button } from '@react-navigation/elements';
import { useAuth } from '../../context/authContext';

const Register = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:3000'); 

  const getDeviceLogs = () => {
    return {
      platform: Platform.OS,
      device: Platform.Version.toString(),
      appVersion: '1.0.0',
    };
  };

  const handleEmailRegister = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    const payload = {
      email,
      password,
      metadata: getDeviceLogs()
    };

    try {
      const response = await fetch(`${backendUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        Alert.alert(
          'Registration Successful', 
          'A verification email has been sent. Please validate your email before logging in.'
        );
      } else {
        const errorData = await response.json().catch(() => ({}));
        Alert.alert('Registration Failed', errorData.message || 'An error occurred during account creation.');
      }
    } catch (error) {
      console.error('Registration API Error:', error);
      Alert.alert('Connection Error', 'Could not connect to the backend server.');
    }
  };

  const handleSocialRegister = async (provider: 'Google' | 'Facebook') => {
    console.log(`Initiating ${provider} Registration Flow...`);
    try {
      // Social registration flows bypass explicit verification emails
      // const token = await executeSocialOAuth(provider);
      // if (token) await login(token);
    } catch (error) {
      console.error(`${provider} registration error`, error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Register for an Account</Text>

      <TextInput
        style={styles.configInput}
        placeholder="Backend Base URL"
        onChangeText={setBackendUrl}
        value={backendUrl}
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        onChangeText={setEmail}
        value={email}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        onChangeText={setPassword}
        value={password}
        secureTextEntry
      />

      <Button onPress={handleEmailRegister}>Register</Button>

      <View style={styles.divider} />

      <Button onPress={() => handleSocialRegister('Google')}>Register with Google</Button>
      <View style={{ height: 10 }} />
      <Button onPress={() => handleSocialRegister('Facebook')}>Register with Facebook</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    marginBottom: 20,
    fontWeight: 'bold',
  },
  input: {
    width: '80%',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 5,
  },
  configInput: {
    width: '80%',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#ff9900',
    padding: 10,
    borderRadius: 5,
    backgroundColor: '#fff9e6',
  },
  divider: {
    height: 1,
    width: '80%',
    backgroundColor: '#ccc',
    marginVertical: 20,
  },
});

export default Register;