import { StyleSheet, Text } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';

export function FieldError({ message }: { message?: string }) {
  const { t } = useLanguage();
  if (!message) return null;
  return <Text accessibilityRole="alert" style={styles.error}>{t(message)}</Text>;
}

const styles = StyleSheet.create({
  error: {
    color: colors.coral,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
    marginBottom: 10,
  },
});
