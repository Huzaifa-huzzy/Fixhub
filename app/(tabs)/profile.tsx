import { Alert } from 'react-native';
import { router } from 'expo-router';
import { ProfileScreen } from '../../src/screens/ProfileScreen';
import { savedAccountSignInRequired, useAppSession } from '../../src/context/AppSessionContext';

export default function ProfileRoute() {
  const {
    activeProfile,
    demoMode,
    loadProfile,
    setDemoRole,
    signOut,
    savedAccounts,
    accountsLoading,
    accountsError,
    addAccount,
    switchAccount,
  } = useAppSession();
  if (!activeProfile) return null;
  return (
    <ProfileScreen
      accountsError={accountsError}
      accountsLoading={accountsLoading}
      demoMode={demoMode}
      onAddAccount={async () => {
        const error = await addAccount();
        if (error) return error;
        router.replace({ pathname: '/auth', params: { selectAccount: 'true' } });
        return null;
      }}
      onDemoRoleChange={setDemoRole}
      onRefreshApprovalStatus={loadProfile}
      onSwitchAccount={async (id) => {
        const error = await switchAccount(id);
        if (error === savedAccountSignInRequired) {
          router.replace({ pathname: '/auth', params: { selectAccount: 'true' } });
          return null;
        }
        return error;
      }}
      onSignOut={() => {
        void signOut().then((error) => {
          if (error) {
            Alert.alert('Unable to sign out', error);
            return;
          }
          router.replace('/auth');
        });
      }}
      profile={activeProfile}
      savedAccounts={savedAccounts}
    />
  );
}
