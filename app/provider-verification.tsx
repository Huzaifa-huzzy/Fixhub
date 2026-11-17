import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { AnimatedPressable as Pressable } from '../src/components/AnimatedPressable';
import { ProviderVerificationPanel } from '../src/components/ProviderVerificationPanel';
import { NotificationBellButton } from '../src/components/NotificationBellButton';
import { useAppSession } from '../src/context/AppSessionContext';
import { useLanguage } from '../src/context/LanguageContext';
import { supabase } from '../src/lib/supabase';
import { colors, radius } from '../src/theme';

export default function ProviderVerificationRoute() {
  const { session, profile, authLoading, profileLoading, loadProfile, signOut } = useAppSession();
  const { t, isRTL } = useLanguage();
  const [provider, setProvider] = useState<{ id: string; verification_status: 'pending' | 'verified' | 'rejected' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    if (!session || profile?.role !== 'provider' || !supabase) return;
    let active = true;
    setLoading(true);
    setProvider(null);
    setError('');
    void loadProfile().catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('Unable to load your provider profile.'));
    });
    async function loadProvider() {
      const { data, error: loadError } = await supabase!
        .from('provider_profiles')
        .select('id,verification_status')
        .eq('profile_id', session!.user.id)
        .maybeSingle();
      if (loadError) {
        if (active) {
          setError(loadError.code === '42703'
            ? t('Provider verification database setup is missing. Apply the CNIC verification migration, then reload this screen.')
            : loadError.message);
        }
      } else if (active && data) {
        setProvider(data);
      } else if (active) {
        setError(t('Your provider profile could not be found. Go back and finish your provider setup.'));
      }
      if (active) setLoading(false);
    }
    void loadProvider().catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : t('Unable to load your provider profile.'));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [loadProfile, profile?.role, session, t]));

  async function leaveApp() {
    setSigningOut(true);
    setError('');
    try {
      const signOutError = await signOut();
      if (signOutError) {
        setError(signOutError);
        setSigningOut(false);
        return;
      }
      router.replace({ pathname: '/auth', params: { selectAccount: 'true' } });
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : t('Unable to sign out.'));
      setSigningOut(false);
    }
  }

  const refreshApprovalStatus = useCallback(async () => {
    const profileError = await loadProfile();
    if (profileError) return profileError;
    if (!supabase || !session) return t('Unable to load your provider profile.');
    const { data, error: providerError } = await supabase
      .from('provider_profiles')
      .select('id,verification_status')
      .eq('profile_id', session.user.id)
      .maybeSingle();
    if (providerError) return providerError.message;
    if (!data) return t('Your provider profile could not be found. Go back and finish your provider setup.');
    setProvider(data);
    return null;
  }, [loadProfile, session, t]);

  if (authLoading || profileLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.green} /></View>;
  }
  if (!session) return <Redirect href="/auth" />;
  if (profile?.role !== 'provider') return <Redirect href="/(tabs)/search" />;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      <NotificationBellButton style={styles.notificationButton} />
      <View style={styles.panel}>
        <Text style={[styles.title, isRTL && styles.rtlText]}>{t('Provider verification')}</Text>
        <Text style={[styles.copy, isRTL && styles.rtlText]}>
          {t('Review your provider verification status below. If you have not submitted your CNIC and selfie, you can complete them here.')}
        </Text>
        {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
        {!loading && provider ? (
          <ProviderVerificationPanel
            key={`${session.user.id}:${provider.id}`}
            initialStatus={provider.verification_status}
            onRefreshApprovalStatus={refreshApprovalStatus}
            profileId={session.user.id}
            providerProfileId={provider.id}
          />
        ) : null}
        {provider?.verification_status === 'verified' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/(tabs)/search')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t('Continue to Fixhub')}</Text>
          </Pressable>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={signingOut}
          onPress={() => void leaveApp()}
          style={[styles.button, signingOut && styles.disabled]}
        >
          {signingOut
            ? <ActivityIndicator color={colors.buttonText} />
            : <Text style={styles.buttonText}>{t('Sign out')}</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', backgroundColor: colors.paper, padding: 20 },
  notificationButton: { alignSelf: 'flex-end', marginBottom: 8, backgroundColor: colors.green, borderRadius: 12, borderWidth: 1, borderColor: colors.green },
  center: { flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  panel: { width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, padding: 18 },
  title: { color: colors.ink, fontSize: 22, lineHeight: 28, fontWeight: '900' },
  copy: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 14 },
  loader: { marginVertical: 18 },
  rtlText: { textAlign: 'right' },
  error: { color: colors.coral, fontSize: 12, lineHeight: 18, marginTop: 10 },
  button: { minHeight: 46, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.green, borderRadius: 12, marginTop: 12, paddingHorizontal: 14 },
  buttonText: { color: colors.buttonText, fontWeight: '800', fontSize: 13 },
  disabled: { opacity: 0.6 },
});
