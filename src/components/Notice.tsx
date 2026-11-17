import { StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { colors, radius } from '../theme';

export function Notice({ children }: { children: string }) {
  return (
    <View style={styles.notice}>
      <AppIcon color={colors.green} name="info" size={16} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderRadius: radius.card,
    backgroundColor: colors.mint,
    padding: 13,
  },
  text: { color: colors.muted, flex: 1, fontSize: 12, lineHeight: 18 },
});
