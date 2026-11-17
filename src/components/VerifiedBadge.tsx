import { StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';

export function VerifiedBadge() {
  const { t } = useLanguage();

  return (
    <View accessibilityLabel={t('Verified')} accessibilityRole="text" style={styles.badge}>
      <AppIcon color={colors.green} name="badgeCheck" size={13} />
      <Text style={styles.label}>{t('Verified')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: '#E8F7EF',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: { color: colors.green, fontWeight: '800', fontSize: 10 },
});
