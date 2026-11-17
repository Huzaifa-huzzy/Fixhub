import { Platform, type ViewStyle } from 'react-native';

export function getLayoutDirectionStyle(isRTL: boolean): Pick<ViewStyle, 'direction'> | undefined {
  if (Platform.OS === 'web') return undefined;
  return { direction: isRTL ? 'rtl' : 'ltr' };
}
