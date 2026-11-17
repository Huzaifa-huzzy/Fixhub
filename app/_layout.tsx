import { Redirect, Stack, usePathname } from 'expo-router';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { AppSessionProvider, useAppSession } from '../src/context/AppSessionContext';
import { NotificationProvider } from '../src/context/NotificationContext';
import { LanguageProvider, useLanguage } from '../src/context/LanguageContext';
import { colors } from '../src/theme';
import { getLayoutDirectionStyle } from '../src/lib/layoutDirection';
import { SafeAreaProvider } from 'react-native-safe-area-context';

function RootStack() {
  const { isRTL } = useLanguage();
  const {
    session,
    profile,
    providerProfileReady,
    authLoading,
    profileLoading,
    profileError,
  } = useAppSession();
  const pathname = usePathname();

  if (!authLoading && !profileLoading && session
    && pathname !== '/auth'
    && pathname !== '/terms'
    && pathname !== '/privacy'
    && pathname !== '/my-reviews'
    && pathname !== '/report') {
    if (profileError && pathname !== '/') return <Redirect href="/" />;
    if (!profile?.role
      && pathname !== '/'
      && pathname !== '/setup-profile') {
      return <Redirect href="/setup-profile" />;
    }
    if (profile?.role === 'provider') {
      if (!providerProfileReady && pathname !== '/setup-profile') {
        return <Redirect href="/setup-profile" />;
      }
      if (providerProfileReady
        && profile.providerVerificationStatus !== 'verified'
        && pathname !== '/provider-verification'
        && pathname !== '/notifications') {
        return <Redirect href="/provider-verification" />;
      }
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[{ flex: 1 }, getLayoutDirectionStyle(isRTL)]}
    >
      <NotificationProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: [{ backgroundColor: colors.paper }, getLayoutDirectionStyle(isRTL)],
          }}
        />
      </NotificationProvider>
    </KeyboardAvoidingView>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <AppSessionProvider>
          <RootStack />
        </AppSessionProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
