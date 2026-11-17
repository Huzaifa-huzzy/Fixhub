import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppIcon } from './AppIcon';
import { useLanguage } from '../context/LanguageContext';
import { useNotificationCenter } from '../context/NotificationContext';
import { colors } from '../theme';

export function NotificationBellButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useLanguage();
  const { unreadCount } = useNotificationCenter();

  return (
    <Pressable
      accessibilityLabel={unreadCount ? `${t('Notifications')}, ${unreadCount} unread` : t('Notifications')}
      accessibilityRole="button"
      onPress={() => router.push('/notifications')}
      style={[styles.button, style]}
    >
      <AppIcon color={colors.buttonText} name="bell" size={21} />
      {unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 12 },
  badge: { position: 'absolute', top: 1, right: 0, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: colors.white, fontSize: 9, fontWeight: '900' },
});
