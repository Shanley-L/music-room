import { useState } from 'react';
import { Text, View, StyleSheet, TextInput, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { Button } from '@react-navigation/elements';


const Register = () => {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');

	const handleSubmit = () => {
		console.log('Yo !', email, password);
	};

	return (
		// <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
			<View style={styles.container}>

				<Text>Register for an Account</Text>

				<TextInput
					style={styles.emailInput}
					placeholder="Email"
					keyboardType="email-address"
					onChangeText={setEmail}
					value={email}
				/>

				<TextInput
					style={styles.emailInput}
					placeholder="Password"
					onChangeText={setPassword}
					value={password}
					secureTextEntry
				/>

				<Button onPress={handleSubmit}>Register</Button>

			</View>
		// </TouchableWithoutFeedback>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
	emailInput: {
		width: '80%',
		marginBottom: 12,
		paddingHorizontal: 9,
		},
	buttonText: {
		color: '#f2f2f2',
	},
});

export default Register;