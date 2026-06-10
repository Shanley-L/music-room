import { Text, View,  StyleSheet } from 'react-native';
import Loader from '@/components/loader';

import { useState } from 'react';

export default function Index() {
  const [loader, setLoader] = useState(true)

  return (
    <View style={styles.container}>
      <Loader></Loader>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
  },
});
