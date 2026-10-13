import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';

/** Back arrow + title, for screens outside the tab bar. `fallback` when there is no history. */
export function ScreenHeader({
  title,
  fallback,
  right,
}: {
  title: string;
  fallback: Href;
  right?: React.ReactNode;
}) {
  const router = useRouter();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };

  return (
    <View style={styles.navBar}>
      <Pressable
        onPress={goBack}
        hitSlop={10}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Retour"
      >
        <Ionicons name="arrow-back" size={24} color="#fff" />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtn: {
    padding: 6,
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
