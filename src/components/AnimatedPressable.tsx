import { useState } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
} from 'react-native';

const NativeAnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function AnimatedPressable({ onPressIn, onPressOut, style, ...props }: PressableProps) {
  const [scale] = useState(() => new Animated.Value(1));
  const animatedStyle: PressableProps['style'] = (state) => [
    typeof style === 'function' ? style(state) : style,
    { transform: [{ scale }] },
  ];

  return (
    <NativeAnimatedPressable
      {...props}
      onPressIn={(event) => {
        Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, stiffness: 420, damping: 24, mass: 0.6 }).start();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, stiffness: 420, damping: 24, mass: 0.6 }).start();
        onPressOut?.(event);
      }}
      style={animatedStyle}
    />
  );
}
