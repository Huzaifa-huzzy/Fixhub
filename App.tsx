import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen } from './src/screens/AuthScreen';
import { MapScreen } from './src/screens/MapScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { RoleSetupScreen } from './src/screens/RoleSetupScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { isSupabaseConfigured, supabase } from './src/lib/supabase';
import { colors } from './src/theme';
import type { Profile, RootTabParamList, UserRole } from './src/types';

const Tabs = createBottomTabNavigator<RootTabParamList>();

function AppTabs({
  profile,
  demoMode,
  onSignOut,
  onDemoRoleChange,
}: {
  profile: Profile;
  demoMode: boolean;
  onSignOut: () => void;
  onDemoRoleChange: (role: UserRole) => void;
}) {
  return (
    <NavigationContainer>
      <Tabs.Navigator
        initialRouteName={profile.role === 'provider' ? 'Profile' : 'Search'}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.green,
          tabBarInactiveTintColor: '#8B9891',
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700', marginBottom: 3 },
          tabBarStyle: {
            backgroundColor: colors.white,
            borderTopColor: colors.line,
            height: 62,
            paddingTop: 6,
          },
        }}
      >
        <Tabs.Screen
          name="Search"
          options={{
            tabBarLabel: profile.role === 'provider' ? 'Explore' : 'Search',
            tabBarIcon: ({ color }) => <Text style={[styles.tabIcon, { color }]}>⌕</Text>,
          }}
        >
          {() => <SearchScreen demoMode={demoMode} currentProfileId={profile.id} isProvider={profile.role === 'provider'} />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Map"
          options={{ tabBarLabel: 'Map', tabBarIcon: ({ color }) => <Text style={[styles.tabIcon, { color }]}>⌖</Text> }}
        >
          {() => <MapScreen demoMode={demoMode} />}
        </Tabs.Screen>
        <Tabs.Screen
          name="Profile"
          options={{ tabBarLabel: 'Profile', tabBarIcon: ({ color }) => <Text style={[styles.tabIcon, { color }]}>◉</Text> }}
        >
          {() => (
            <ProfileScreen
              demoMode={demoMode}
              onDemoRoleChange={onDemoRoleChange}
              onSignOut={onSignOut}
              profile={profile}
            />
          )}
        </Tabs.Screen>
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoRole, setDemoRole] = useState<UserRole>('taker');
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setAuthLoading(false);
        setProfileError('');
      }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setProfileError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!session || !supabase) return;
    setProfileLoading(true);
    setProfileError('');
    const { data, error } = await supabase
      .from('profiles')
      .select('id,role,name,avatar_url')
      .eq('id', session.user.id)
      .maybeSingle();
    setProfileLoading(false);
    if (error) {
      setProfileError(error.message);
      return;
    }
    if (!data) {
      setProfileError('Your account profile was not created. Apply the Supabase database migration, then try again.');
      return;
    }
    const role = data.role === 'provider' || data.role === 'taker' || data.role === 'business_owner'
      ? data.role
      : null;
    setProfile({ id: data.id, role, name: data.name, avatar_url: data.avatar_url });
  }, [session]);

  useEffect(() => {
    if (session) void loadProfile();
    else {
      setProfile(null);
      setProfileLoading(false);
    }
  }, [loadProfile, session]);

  const signOut = useCallback(async () => {
    if (demoMode) {
      setDemoMode(false);
      setProfile(null);
      return;
    }
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setProfileError(error.message);
  }, [demoMode]);

  if (authLoading || profileLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} size="large" />
        <Text style={styles.loadingText}>Getting things ready…</Text>
      </View>
    );
  }

  if (profileError && session && !profile) {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorTitle}>We could not load your profile</Text>
        <Text style={styles.errorText}>{profileError}</Text>
        <Text onPress={() => void loadProfile()} style={styles.retry}>Try again</Text>
      </View>
    );
  }

  if (isSupabaseConfigured && !session && !demoMode) {
    return (
      <>
        <StatusBar style="dark" />
        <AuthScreen />
      </>
    );
  }

  if (!demoMode && session && profile?.role == null) {
    return (
      <>
        <StatusBar style="dark" />
        <RoleSetupScreen onComplete={loadProfile} userId={session.user.id} />
      </>
    );
  }

  if (!demoMode && !session) {
    return (
      <>
        <StatusBar style="dark" />
        <AuthScreen />
      </>
    );
  }

  const activeProfile: Profile = demoMode
    ? { id: 'demo-current-user', role: demoRole, name: 'Demo User' }
    : profile!;

  return (
    <>
      <StatusBar style="dark" />
      <AppTabs
        demoMode={demoMode}
        onDemoRoleChange={setDemoRole}
        onSignOut={() => void signOut()}
        profile={activeProfile}
      />
    </>
  );
}

const styles = StyleSheet.create({
  tabIcon: { fontSize: 19, textAlign: 'center', fontWeight: '800' },
  loading: { flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: 28 },
  loadingText: { color: colors.muted, fontSize: 12, marginTop: 13 },
  errorTitle: { color: colors.ink, fontWeight: '900', fontSize: 17, textAlign: 'center' },
  errorText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 9 },
  retry: { color: colors.green, fontWeight: '800', marginTop: 16 },
});
