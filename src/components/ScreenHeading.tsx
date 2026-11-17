import type { PropsWithChildren } from 'react';
import { View, type ViewProps } from 'react-native';

export function ScreenHeading({ children, ...viewProps }: PropsWithChildren<ViewProps>) {
  return <View {...viewProps}>{children}</View>;
}