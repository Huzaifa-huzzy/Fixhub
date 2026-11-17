import * as Haptics from 'expo-haptics';

export function triggerSelectionHaptic() {
  void Haptics.selectionAsync().catch((error: unknown) => {
    console.warn('Unable to trigger selection haptic:', error);
  });
}
