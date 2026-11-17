import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  PanResponder,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon, type AppIconName } from './AppIcon';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';

const tabs = [
  { name: 'search', label: 'Search', icon: 'search', href: '/(tabs)/search' as const },
  { name: 'map', label: 'Map', icon: 'mapPin', href: '/(tabs)/map' as const },
  { name: 'chat', label: 'Chats', icon: 'messageCircle', href: '/(tabs)/chat' as const },
  { name: 'profile', label: 'Profile', icon: 'user', href: '/(tabs)/profile' as const },
] satisfies { name: string; label: string; icon: AppIconName; href: `/(tabs)/${string}` }[];

const highlightHeight = 48;
const holdDuration = 280;

export function AnimatedTabBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const orderedTabs = tabs;
  const activeTabName = pathname.split('/').pop();
  const activeIndex = Math.max(0, orderedTabs.findIndex((tab) => tab.name === activeTabName));
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const [indicatorX] = useState(() => new Animated.Value(0));
  const [iconScales] = useState(() => tabs.map(() => new Animated.Value(1)));
  const barLeft = insets.left + 12;
  const touchStartX = useRef(0);
  const touchIndex = useRef(0);
  const highlightIndexRef = useRef(activeIndex);
  const dragging = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const indicatorOffset = useCallback((index: number) => {
    const slotWidth = barWidth / tabs.length;
    return slotWidth * index + 4;
  }, [barWidth]);

  const animateHighlight = useCallback((index: number) => {
    if (highlightIndexRef.current === index && dragging.current) return;
    highlightIndexRef.current = index;
    Animated.spring(indicatorX, {
      toValue: indicatorOffset(index),
      useNativeDriver: true,
      stiffness: 360,
      damping: 25,
      mass: 0.8,
    }).start();
    Animated.parallel(iconScales.map((scale, tabIndex) => Animated.spring(scale, {
      toValue: orderedTabs[tabIndex]?.name === orderedTabs[index]?.name ? 1.24 : 1,
      useNativeDriver: true,
      stiffness: 380,
      damping: 23,
      mass: 0.65,
    }))).start();
  }, [indicatorOffset, indicatorX, iconScales, orderedTabs]);

  const navigateToIndex = useCallback((index: number) => {
    const tab = orderedTabs[index];
    if (tab) router.navigate(tab.href);
  }, [orderedTabs]);

  useEffect(() => {
    if (!dragging.current) {
      Animated.spring(indicatorX, {
        toValue: indicatorOffset(activeIndex),
        useNativeDriver: true,
        stiffness: 360,
        damping: 25,
        mass: 0.8,
      }).start();
      Animated.parallel(iconScales.map((scale, tabIndex) => Animated.spring(scale, {
        toValue: orderedTabs[tabIndex]?.name === orderedTabs[activeIndex]?.name ? 1.16 : 1,
        useNativeDriver: true,
        stiffness: 380,
        damping: 23,
        mass: 0.65,
      }))).start();
    }
  }, [activeIndex, iconScales, indicatorOffset, indicatorX, orderedTabs]);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const getIndexAtX = useCallback((screenX: number) => {
    const width = barWidth;
    if (width <= 0) return activeIndex;
    const localX = Math.max(0, Math.min(width - 1, screenX - barLeft));
    return Math.min(tabs.length - 1, Math.floor(localX / (width / tabs.length)));
  }, [activeIndex, barLeft, barWidth]);

  // PanResponder callbacks run on touch events; their ref reads must stay deferred until then.
  // eslint-disable-next-line react-hooks/refs
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_event, gestureState) => {
      touchStartX.current = gestureState.x0;
      touchIndex.current = getIndexAtX(gestureState.x0);
      dragging.current = false;
      holdTimer.current = setTimeout(() => {
        dragging.current = true;
        const index = getIndexAtX(touchStartX.current);
        touchIndex.current = index;
        animateHighlight(index);
      }, holdDuration);
    },
    onPanResponderMove: (_event, gestureState) => {
      if (!dragging.current) {
        if (Math.abs(gestureState.moveX - touchStartX.current) > 10 && holdTimer.current) {
          clearTimeout(holdTimer.current);
          holdTimer.current = null;
        }
        return;
      }
      const index = getIndexAtX(gestureState.moveX);
      touchIndex.current = index;
      animateHighlight(index);
    },
    onPanResponderRelease: () => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      const index = touchIndex.current;
      dragging.current = false;
      navigateToIndex(index);
    },
    onPanResponderTerminate: () => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      dragging.current = false;
      highlightIndexRef.current = activeIndex;
      Animated.spring(indicatorX, {
        toValue: indicatorOffset(activeIndex),
        useNativeDriver: true,
        stiffness: 360,
        damping: 25,
        mass: 0.8,
      }).start();
      Animated.parallel(iconScales.map((scale, index) => Animated.spring(scale, {
        toValue: orderedTabs[index]?.name === orderedTabs[activeIndex]?.name ? 1.16 : 1,
        useNativeDriver: true,
        stiffness: 380,
        damping: 23,
        mass: 0.65,
      }))).start();
    },
  }), [
    activeIndex,
    animateHighlight,
    getIndexAtX,
    iconScales,
    indicatorOffset,
    indicatorX,
    navigateToIndex,
    orderedTabs,
  ]);

  function onLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    setBarWidth(width);
  }

  if (keyboardVisible) return null;

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          paddingLeft: insets.left + 12,
          paddingRight: insets.right + 12,
        },
      ]}
    >
      <View
        onLayout={onLayout}
        style={styles.row}
        {...panResponder.panHandlers}
      >
        {barWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.highlight,
              { width: Math.max(0, barWidth / tabs.length - 8), transform: [{ translateX: indicatorX }] },
            ]}
          />
        ) : null}
        {orderedTabs.map((tab, index) => {
          const tabScale = iconScales[index];
          return (
            <Pressable
              accessibilityLabel={t(tab.label)}
              accessibilityRole="button"
              key={tab.name}
              onPress={() => navigateToIndex(index)}
              style={styles.tab}
            >
              <Animated.View
                style={[
                  styles.icon,
                  { transform: [{ scale: tabScale }] },
                ]}
              >
                <AppIcon color={colors.green} name={tab.icon} size={21} />
              </Animated.View>
              <Text style={styles.label}>{t(tab.label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 10,
  },
  row: {
    height: 58,
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    position: 'relative',
  },
  highlight: {
    position: 'absolute',
    left: 0,
    top: 5,
    height: highlightHeight,
    borderRadius: 17,
    backgroundColor: '#FFEFCC',
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  icon: {
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
    letterSpacing: 0.1,
  },
});
