import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../context/LanguageContext';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { privacyPolicyContent, termsConditionsContent } from '../data/legalPolicies';
import { colors } from '../theme';

type LegalPolicyKind = 'terms' | 'privacy';

export function LegalPolicyScreen({ kind }: { kind: LegalPolicyKind }) {
  const { language, isRTL, t, toggleLanguage } = useLanguage();
  const insets = useSafeAreaInsets();
  const title = kind === 'terms' ? t('Terms and Conditions') : t('Privacy Policy');
  const content = kind === 'terms'
    ? termsConditionsContent[language]
    : privacyPolicyContent[language];
  const headingsToSeparate = language === 'ur'
    ? kind === 'terms'
      ? ['3. اہلیت اور صارف اکاؤنٹس', '6. بزنس لسٹنگز', '8. ریٹنگز، ریویوز اور رپورٹنگ']
      : ['2. ہم کیا معلومات جمع کرتے ہیں', '5. لوکیشن ڈیٹا', '6. ڈیٹا اسٹوریج اور سیکیورٹی']
    : [];
  const formattedContent = headingsToSeparate.reduce(
    (text, heading) => text.replace(`${heading} `, `${heading}\n\n`),
    content,
  );
  const paragraphs = formattedContent.split('\n\n').filter(Boolean);

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
        getLayoutDirectionStyle(isRTL),
      ]}
    >
      <View style={[styles.header, isRTL && styles.headerRtl]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/auth')}
          style={styles.backButton}
        >
          <Text style={styles.backText}>{isRTL ? '›' : '‹'}</Text>
          <Text style={styles.backLabel}>{t('Back to sign in')}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={language === 'en' ? 'Switch language to Urdu' : 'Switch language to English'}
          accessibilityRole="button"
          onPress={toggleLanguage}
          style={styles.languageButton}
        >
          <Text style={styles.languageButtonText}>{language === 'en' ? 'اردو' : 'English'}</Text>
        </Pressable>
      </View>
      <Text style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        {paragraphs.map((paragraph, index) => {
          const isHeading = /^\d{1,2}\. /.test(paragraph) || paragraph.startsWith('حصہ ');
          const isNotice = paragraph.startsWith('وضاحت:');
          return (
            <Text
              key={`${index}-${paragraph.slice(0, 20)}`}
              style={[
                styles.paragraph,
                isRTL && styles.rtlText,
                isHeading && styles.sectionHeading,
                isNotice && styles.notice,
              ]}
            >
              {paragraph}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerRtl: { flexDirection: 'row-reverse' },
  backButton: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 5, backgroundColor: colors.green, borderRadius: 10, paddingHorizontal: 10 },
  backText: { color: colors.buttonText, fontSize: 28, lineHeight: 32 },
  backLabel: { color: colors.buttonText, fontSize: 12, fontWeight: '700' },
  languageButton: {
    minWidth: 68,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  languageButtonText: { color: colors.buttonText, fontSize: 12, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 23, fontWeight: '900', paddingHorizontal: 20, marginVertical: 8 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36 },
  paragraph: { color: colors.ink, fontSize: 13, lineHeight: 21, marginBottom: 12 },
  rtlText: { textAlign: 'right' },
  sectionHeading: { fontSize: 15, fontWeight: '900', marginTop: 10, marginBottom: 6 },
  notice: {
    color: colors.muted,
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    lineHeight: 20,
  },
});
