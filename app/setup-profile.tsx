import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { RoleSetupScreen } from '../src/screens/RoleSetupScreen';
import { useAppSession } from '../src/context/AppSessionContext';
import { colors } from '../src/theme';

export default function SetupProfileRoute() {
  const router = useRouter();
  const {
    session,
    profile,
    providerProfileReady,
    authLoading,
    profileLoading,
    loadProfile,
  } = useAppSession();
  if (authLoading || profileLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.paper, justifyContent: 'center' }}><ActivityIndicator color={colors.green} /></View>;
  }
  if (!session) return <Redirect href="/auth" />;
  if (profile?.role && profile.role !== 'provider') {
    return <Redirect href="/(tabs)/search" />;
  }
  if (profile?.role === 'provider' && providerProfileReady) {
    return <Redirect href={profile.providerVerificationStatus === 'verified' ? '/(tabs)/search' : '/provider-verification'} />;
  }
  return (
    <RoleSetupScreen
      initialName={profile?.name
        ?? (typeof session.user.user_metadata.name === 'string' ? session.user.user_metadata.name : '')}
      usernameAccount={typeof session.user.user_metadata.username === 'string'}
      initialRole={profile?.role === 'provider' ? 'provider' : undefined}
      userId={session.user.id}
      onComplete={async (role) => {
        const error = await loadProfile();
        if (!error) router.replace(role === 'provider' ? '/provider-verification' : '/(tabs)/search');
        return error;
      }}
    />
  );
}
