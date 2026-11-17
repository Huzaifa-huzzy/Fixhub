import { MapScreen } from '../../src/screens/MapScreen';
import { useAppSession } from '../../src/context/AppSessionContext';

export default function MapRoute() {
  const { demoMode } = useAppSession();
  return (
    <MapScreen demoMode={demoMode} />
  );
}
