import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon } from '../components/AppIcon';
import { ReportCenter } from '../components/ReportCenter';
import { useAppSession } from '../context/AppSessionContext';
import { useLanguage } from '../context/LanguageContext';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { colors } from '../theme';

export function ReportScreen() {
  const { activeProfile, demoMode } = useAppSession();
  const { t, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }, getLayoutDirectionStyle(isRTL)]}>
        <Pressable accessibilityLabel={t('Back')} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <AppIcon color={colors.buttonText} name={isRTL ? 'arrowRight' : 'arrowLeft'} size={20} />
        </Pressable>
        <Text style={styles.title}>{t('Report')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {demoMode ? (
          <Text style={styles.notice}>{t('Report submissions are unavailable in demo mode.')}</Text>
        ) : activeProfile ? (
          <ReportCenter isAdmin={activeProfile.role === 'admin'} reporterId={activeProfile.id} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.green },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18, paddingBottom: 32 },
  notice: { color: colors.muted, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, fontSize: 12, lineHeight: 18 },
});
