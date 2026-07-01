import { useState } from 'react';
import { 
  Text, 
  View, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  Platform,
  Alert 
} from 'react-native';
import { Button } from '@react-navigation/elements';
import { useAuth } from '../../context/authContext';

const Login = () => {
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

  const handleEmailLogin = async () => {
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
      const response = await fetch(`${backendUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();

      if (response.ok && data.token) {
        await login(data.token); 
        Alert.alert('Welcome!', 'Login successful.');
      } else {
        Alert.alert('Login Failed', data.message || 'Invalid email or password.');
      }
      
    } catch (error) {
      console.error("Login failed:", error);
      Alert.alert('Connection Error', 'Could not connect to the backend server.');
    }
  };

  const handleSocialLogin = async (provider: 'Google' | 'Facebook') => {
    console.log(`Triggering ${provider} OAuth Flow...`);
    try {
      // Once OAuth SDK yields a token and your backend verifies it:
      // const response = await backendSocialAuthExchange(oauthToken);
      // if (response.token) await login(response.token);
    } catch (error) {
      console.error(`${provider} login failed`, error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login to your Account</Text>

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

      <Button onPress={handleEmailLogin}>Login</Button>

      <TouchableOpacity onPress={() => console.log('Navigate to Forgot Password')}>
        <Text style={styles.linkText}>Forgot Password?</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      <Button onPress={() => handleSocialLogin('Google')}>Connect with Google</Button>
      <View style={{ height: 10 }} />
      <Button onPress={() => handleSocialLogin('Facebook')}>Connect with Facebook</Button>
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
  linkText: {
    color: '#0066cc',
    marginTop: 15,
    textDecorationLine: 'underline',
  },
  divider: {
    height: 1,
    width: '80%',
    backgroundColor: '#ccc',
    marginVertical: 20,
  },
});

export default Login;