import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';
import { NotificationBellButton } from './NotificationBellButton';

export function AppHeader() {
  const { language, toggleLanguage } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { height: 56 + insets.top, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <Image
            accessibilityLabel="Fixhub logo"
            source={require('../../assets/Gemini_Generated_Image_f2lm3nf2lm3nf2lm.jpg')}
            style={styles.logo}
          />
          <Text style={styles.title}>
            <Text style={styles.fixBrand}>Fix</Text>
            <Text style={styles.hubBrand}>hub</Text>
          </Text>
        </View>
        <View style={styles.actions}>
          <NotificationBellButton />
          <Pressable
            accessibilityLabel={language === 'en' ? 'Switch language to Urdu' : 'Switch language to English'}
            accessibilityRole="button"
            onPress={toggleLanguage}
            style={styles.languageButton}
          >
            <Text style={styles.languageButtonText}>{language === 'en' ? 'اردو' : 'English'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    direction: 'ltr',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 22,
  },
  brand: { flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 8 },
  logo: { width: 38, height: 38, borderRadius: 9 },
  title: { fontSize: 19, fontWeight: '900' },
  fixBrand: { color: '#B5AA91' },
  hubBrand: { color: '#7A283F' },
  actions: { flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 8 },
  languageButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 999, minHeight: 34, width: 76, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10 },
  languageButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
