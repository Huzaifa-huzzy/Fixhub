import { Platform, type ViewStyle } from 'react-native';

export function getLayoutDirectionStyle(isRTL: boolean): Pick<ViewStyle, 'direction'> | undefined {
  if (Platform.OS === 'web') return undefined;
  return { direction: isRTL ? 'rtl' : 'ltr' };
}

/**
 * Pins a subtree to LTR. Yoga inherits `direction`, so without this an RTL root
 * (app/_layout.tsx) mirrors every row inside the screen.
 */
export function getPinnedLtrStyle(): Pick<ViewStyle, 'direction'> | undefined {
  if (Platform.OS === 'web') return undefined;
  return { direction: 'ltr' };
}
