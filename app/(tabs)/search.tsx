import { SearchScreen } from '../../src/screens/SearchScreen';
import { useAppSession } from '../../src/context/AppSessionContext';

export default function SearchRoute() {
  const { demoMode, activeProfile } = useAppSession();
  if (!activeProfile) return null;
  return (
    <SearchScreen
      demoMode={demoMode}
      currentProfileId={activeProfile.id}
      isProvider={activeProfile.role === 'provider'}
    />
  );
}
