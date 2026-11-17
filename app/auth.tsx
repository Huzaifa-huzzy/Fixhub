import { useLocalSearchParams, useRouter } from 'expo-router';
import { AuthScreen } from '../src/screens/AuthScreen';

export default function AuthRoute() {
  const router = useRouter();
  const { selectAccount } = useLocalSearchParams<{ selectAccount?: string }>();
  return (
    <AuthScreen
      selectAccount={selectAccount === 'true'}
      onCancel={() => router.replace('/(tabs)/profile')}
      onSuccess={() => router.replace('/')}
    />
  );
}
