import { navigate } from 'expo-router/build/global-state/routing';
import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, withSpring, withDelay, ZoomIn} from 'react-native-reanimated';

import { useFonts, Oi_400Regular } from '@expo-google-fonts/oi';

export default function Loader() {

  const [fontsLoaded] = useFonts({
    Oi_400Regular,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Animated.View entering={ZoomIn} style={styles.container}>
        <Text style={styles.text}>Music</Text>
        <Text style={styles.text}>Room</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#652edc',
  },
  text: {
    color: '#fff',
    fontSize: 30,
    fontFamily: 'Oi_400Regular'
  },
});