import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function RoomVoteScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const roomId = typeof id === 'string' && id.trim() !== '' ? id.trim() : null;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.navBar}>
        <Pressable
          onPress={handleBack}
          hitSlop={10}
          style={styles.navIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.navTitle}>Salle</Text>
        <View style={styles.navSpacer} />
      </View>

      {roomId ? (
        <View style={styles.center}>
          <Ionicons name="musical-notes" size={48} color="#652edc" />
          <Text style={styles.title}>Écran de vote</Text>
          <Text style={styles.idText}>Salle : {roomId}</Text>
          <Text style={styles.note}>
            L’écran de vote en direct (file ordonnée, scores) sera implémenté
            dans la Story 2.5.
          </Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color="#f59e0b" />
          <Text style={styles.title}>Paramètre salle manquant</Text>
          <Text style={styles.note}>
            Ouvrez cette salle depuis la création ou la liste des événements.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 20,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  navIconBtn: {
    padding: 6,
  },
  navTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  navSpacer: {
    width: 36,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  idText: {
    color: '#a77bf3',
    fontSize: 13,
    fontWeight: '600',
  },
  note: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});