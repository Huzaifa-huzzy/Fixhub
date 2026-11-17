import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAppSession } from '../src/context/AppSessionContext';
import { useLanguage } from '../src/context/LanguageContext';
import { colors } from '../src/theme';
import { ScreenHeading } from '../src/components/ScreenHeading';

function GettingThingsReady() {
  const { t } = useLanguage();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const logoScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const logoRotation = progress.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] });
  const ringScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.35] });
  const ringOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View style={styles.center}>
      <View style={styles.logoStage}>
        <Animated.View
          accessible={false}
          style={[
            styles.pulseRing,
            { opacity: ringOpacity, transform: [{ scale: ringScale }] },
          ]}
        />
        <Animated.Image
          accessibilityLabel="Fixhub logo"
          source={require('../assets/Gemini_Generated_Image_f2lm3nf2lm3nf2lm.jpg')}
          style={[
            styles.logo,
            { transform: [{ scale: logoScale }, { rotate: logoRotation }] },
          ]}
        />
      </View>
      <Text style={styles.helper}>{t('Getting things ready…')}</Text>
    </View>
  );
}

export default function IndexRoute() {
  const {
    session,
    profile,
    providerProfileReady,
    demoMode,
    authLoading,
    profileLoading,
    profileError,
    loadProfile,
  } = useAppSession();

  if (authLoading || profileLoading) {
    return <GettingThingsReady />;
  }
  if (session && profileError && !profile) {
    return (
      <View style={styles.center}>
        <ScreenHeading style={styles.errorHeading}>
          <Text style={styles.title}>We could not load your profile</Text>
        </ScreenHeading>
        <Text style={styles.helper}>{profileError}</Text>
        <Pressable onPress={() => void loadProfile()} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!session && !demoMode) return <Redirect href="/auth" />;
  if (session && (profile?.role == null || (profile.role === 'provider' && !providerProfileReady))) {
    return <Redirect href="/setup-profile" />;
  }
  if (session && profile?.role === 'provider' && profile.providerVerificationStatus !== 'verified') {
    return <Redirect href="/provider-verification" />;
  }
  return <Redirect href="/(tabs)/search" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: 28 },
  errorHeading: { width: '100%', maxWidth: 420 },
  logoStage: { width: 184, height: 184, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderColor: colors.line,
  },
  logo: { width: 144, height: 144 },
  title: { color: colors.ink, fontWeight: '900', fontSize: 17, textAlign: 'center' },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  button: { backgroundColor: colors.green, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, marginTop: 16 },
  buttonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
});
