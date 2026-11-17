import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAppSession } from '../../src/context/AppSessionContext';
import { useLanguage } from '../../src/context/LanguageContext';
import { colors } from '../../src/theme';
import { AnimatedTabBar } from '../../src/components/AnimatedTabBar';
import { AppHeader } from '../../src/components/AppHeader';

export default function TabsLayout() {
  const { session, profile, providerProfileReady, demoMode, authLoading, profileLoading } = useAppSession();
  const { t } = useLanguage();
  if (authLoading || profileLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.paper, justifyContent: 'center' }}><ActivityIndicator color={colors.green} /></View>;
  }
  if (!session && !demoMode) return <Redirect href="/auth" />;
  if (session && (!profile?.role || (profile.role === 'provider' && !providerProfileReady))) {
    return <Redirect href="/setup-profile" />;
  }
  if (session && profile?.role === 'provider' && profile.providerVerificationStatus !== 'verified') {
    return <Redirect href="/provider-verification" />;
  }

  return (
    <Tabs
      tabBar={() => <AnimatedTabBar />}
      screenOptions={{
        headerShown: true,
        header: () => <AppHeader />,
      }}
    >
      <Tabs.Screen
        name="search"
        options={{ title: t('Search'), tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19, fontWeight: '800' }}>⌕</Text> }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: t('Map'), tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19, fontWeight: '800' }}>⌖</Text> }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: t('Chats'), tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19, fontWeight: '800' }}>▤</Text> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('Profile'), tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19, fontWeight: '800' }}>◉</Text> }}
      />
    </Tabs>
  );
}
