import { Tabs, useRouter, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAudio } from '../../contexts/AudioContext';
import { MediaController } from '../../components/mediaController';

export default function TabLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const { currentTrack, isPlaying, togglePlay } = useAudio();

  // Strict Auth Guard: redirect unauthenticated users to /login
  useEffect(() => {
    if (isLoading) return;
    if (pathname === '/loader' || pathname === '/') return;

    if (!user) {
      router.replace('/login');
    }
  }, [user, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#652edc" />
      </View>
    );
  }

  // Prevent rendering tabs content if unauthenticated
  if (!user && pathname !== '/loader' && pathname !== '/') {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#652edc" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: '#181818',
            borderTopColor: '#282828',
            borderTopWidth: 1,
            height: 56,
          },
          tabBarActiveTintColor: '#fff',
          tabBarInactiveTintColor: '#777',
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Accueil',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'home' : 'home-outline'}
                size={26}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'Recherche',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'search' : 'search-outline'}
                size={26}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="playlists"
          options={{
            title: 'Playlists',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'musical-notes' : 'musical-notes-outline'}
                size={26}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'person' : 'person-outline'}
                size={24}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="loader"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
      </Tabs>

      {/* Persistent Global Media Player floating above tab bar */}
      {currentTrack && (
        <MediaController
          track={currentTrack}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          bottom={68}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});


