import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { FieldError } from '../components/FieldError';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { filterDecimalInput, filterIntegerInput, filterTextInput, isValidDecimal, isValidText } from '../lib/inputValidation';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { colors, radius } from '../theme';

const roles: { id: 'taker' | 'provider'; title: string; detail: string; icon: AppIconName }[] = [
  { id: 'taker', title: 'I need a service', detail: 'Find and connect with nearby professionals.', icon: 'search' },
  { id: 'provider', title: 'I provide services', detail: 'Create a professional profile and offer your services.', icon: 'wrench' },
];

export function RoleSetupScreen({
  userId,
  initialName = '',
  usernameAccount = false,
  initialRole,
  onComplete,
}: {
  userId: string;
  initialName?: string;
  usernameAccount?: boolean;
  initialRole?: 'provider';
  onComplete: (role: 'taker' | 'provider') => Promise<string | null | void>;
}) {
  const { language, isRTL, t, toggleLanguage } = useLanguage();
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState<'taker' | 'provider' | null>(initialRole ?? null);
  const [category, setCategory] = useState('');
  const [bio, setBio] = useState('');
  const [experience, setExperience] = useState('0');
  const [serviceRadius, setServiceRadius] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  async function saveProfile() {
    setFieldError(null);
    setError('');
    if (!supabase) {
      setError(t('Supabase is not configured.'));
      return;
    }
    if (!role) {
      setError(t('Choose whether you need a service or provide services.'));
      return;
    }
    if (!isValidText(name, 2, 50)) {
      setFieldError({ field: 'name', message: t('Your name must be between 2 and 50 characters.') });
      return;
    }

    const years = Number(experience);
    const radiusKm = Number(serviceRadius);
    if (role === 'provider') {
      if (!isValidText(category, 2, 80)) {
        setFieldError({ field: 'category', message: t('Enter a service category between 2 and 80 characters.') });
        return;
      }
      if (bio.trim().length > 1000) {
        setFieldError({ field: 'bio', message: t('Your introduction must be 1000 characters or fewer.') });
        return;
      }
      if (!isValidDecimal(experience, 0, 70, 0) || !Number.isInteger(years)) {
        setFieldError({ field: 'experience', message: t('Experience must be a whole number between 0 and 70.') });
        return;
      }
      if (!isValidDecimal(serviceRadius, 0.01, 500)) {
        setFieldError({ field: 'serviceRadius', message: t('Service radius must be greater than 0 and no more than 500 km.') });
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ name: name.trim(), role })
        .eq('id', userId)
        .select('id')
        .single();
      if (updateError) {
        setError(updateError.message);
        return;
      }

      if (role === 'provider') {
        const { error: providerError } = await supabase
          .from('provider_profiles')
          .upsert({
            profile_id: userId,
            category: category.trim(),
            bio: bio.trim() || null,
            experience_years: years,
            service_radius_km: radiusKm,
          }, { onConflict: 'profile_id' });
        if (providerError) {
          setError(providerError.message);
          return;
        }
      }

      const completionError = await onComplete(role);
      if (completionError) setError(completionError);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save your profile.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={[styles.screen, getLayoutDirectionStyle(isRTL)]}
      contentContainerStyle={[styles.content, getLayoutDirectionStyle(isRTL)]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        accessibilityLabel={language === 'en' ? t('Switch language to Urdu') : t('Switch language to English')}
        accessibilityRole="button"
        onPress={toggleLanguage}
        style={[styles.languageButton, { alignSelf: isRTL ? 'flex-start' : 'flex-end' }]}
      >
        <Text style={styles.languageButtonText}>{language === 'en' ? 'اردو' : 'English'}</Text>
      </Pressable>
      <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{t(initialRole ? 'COMPLETE YOUR PROFILE' : 'WELCOME TO SERVICECONNECT')}</Text>
      <Text style={[styles.title, isRTL && styles.rtlText]}>
        {t(initialRole ? 'Finish your provider profile' : 'How will you use Fixhub?')}
      </Text>
      <Text style={[styles.subtitle, isRTL && styles.rtlText]}>
        {initialRole
          ? t('Add your professional details to continue.')
          : t('Choose the option that best describes what you need.')}
      </Text>

      {!initialRole ? roles.map((item) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: role === item.id }}
          key={item.id}
          onPress={() => {
            setRole(item.id);
            setError('');
          }}
          style={[styles.role, getLayoutDirectionStyle(isRTL), role === item.id && styles.roleSelected]}
        >
          <View style={[styles.roleIcon, role === item.id && styles.roleIconSelected]}>
            <AppIcon color={role === item.id ? colors.white : colors.green} name={item.icon} size={22} />
          </View>
          <View style={styles.roleCopy}>
            <Text style={[styles.roleTitle, isRTL && styles.rtlText]}>{t(item.title)}</Text>
            <Text style={[styles.roleDetail, isRTL && styles.rtlText]}>{t(item.detail)}</Text>
          </View>
          <View style={[styles.radio, role === item.id && styles.radioSelected]}>
            {role === item.id ? <View style={styles.radioDot} /> : null}
          </View>
        </Pressable>
      )) : null}

      <View style={[styles.form, getLayoutDirectionStyle(isRTL)]}>
        <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t(usernameAccount ? 'Login name' : 'Your name')}</Text>
        <TextInput
          accessibilityLabel={t('Your name')}
          autoCapitalize="words"
          maxLength={50}
          onChangeText={(value) => {
            setName(filterTextInput(value, 50));
            if (fieldError?.field === 'name') setFieldError(null);
          }}
          placeholder={t('Your name')}
          placeholderTextColor={colors.muted}
          style={[styles.input, isRTL && styles.rtlInput]}
          editable={!usernameAccount}
          value={name}
        />
        <FieldError message={fieldError?.field === 'name' ? fieldError.message : undefined} />
        {usernameAccount ? (
          <Text style={[styles.helper, isRTL && styles.rtlText]}>{t('This name is also your sign-in name and cannot be changed.')}</Text>
        ) : null}

        {role === 'provider' ? (
          <View style={styles.providerDetails}>
            <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('Provider profile details')}</Text>
            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('Main service category')}</Text>
            <TextInput
              maxLength={80}
              onChangeText={(value) => {
                setCategory(filterTextInput(value, 80));
                if (fieldError?.field === 'category') setFieldError(null);
              }}
              placeholder={t('e.g. Electrician')}
              placeholderTextColor={colors.muted}
              style={[styles.input, isRTL && styles.rtlInput]}
              value={category}
            />
            <FieldError message={fieldError?.field === 'category' ? fieldError.message : undefined} />
            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('About your work')} <Text style={styles.optional}>({t('optional')})</Text></Text>
            <TextInput
              multiline
              maxLength={1000}
              onChangeText={(value) => {
                setBio(filterTextInput(value, 1000, true));
                if (fieldError?.field === 'bio') setFieldError(null);
              }}
              placeholder={t('Tell customers about your skills and services')}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.multiline, isRTL && styles.rtlInput]}
              textAlignVertical="top"
              value={bio}
            />
            <FieldError message={fieldError?.field === 'bio' ? fieldError.message : undefined} />
            <View style={styles.fieldRow}>
              <View style={styles.halfField}>
                <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('Years of experience')}</Text>
                <TextInput
                  keyboardType="number-pad"
                  maxLength={2}
                  onChangeText={(value) => {
                    setExperience(filterIntegerInput(value));
                    if (fieldError?.field === 'experience') setFieldError(null);
                  }}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, isRTL && styles.rtlInput]}
                  value={experience}
                />
                <FieldError message={fieldError?.field === 'experience' ? fieldError.message : undefined} />
              </View>
              <View style={styles.halfField}>
                <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('Service radius (km)')}</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  maxLength={6}
                  onChangeText={(value) => {
                    setServiceRadius(filterDecimalInput(value));
                    if (fieldError?.field === 'serviceRadius') setFieldError(null);
                  }}
                  placeholder="10"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, isRTL && styles.rtlInput]}
                  value={serviceRadius}
                />
                <FieldError message={fieldError?.field === 'serviceRadius' ? fieldError.message : undefined} />
              </View>
            </View>
            <Text style={[styles.helper, isRTL && styles.rtlText]}>{t('You can add your service location and prices from your profile after setup.')}</Text>
          </View>
        ) : null}
      </View>

      {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{t(error)}</Text> : null}
      <Pressable disabled={busy || !role} onPress={() => void saveProfile()} style={[styles.button, (busy || !role) && styles.disabled]}>
        {busy ? <ActivityIndicator color={colors.buttonText} /> : <Text style={styles.buttonText}>{t('Continue to Fixhub')}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingVertical: 36 },
  languageButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: radius.pill, minHeight: 34, minWidth: 66, justifyContent: 'center', alignItems: 'center', marginBottom: 18, paddingHorizontal: 10 },
  languageButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  rtlText: { textAlign: 'right' },
  rtlInput: { textAlign: 'right' },
  eyebrow: { color: colors.green, fontWeight: '800', fontSize: 10, letterSpacing: 1.8 },
  title: { color: colors.ink, fontSize: 27, lineHeight: 34, fontWeight: '900', marginTop: 10 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 20 },
  role: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, padding: 13, marginBottom: 10 },
  roleSelected: { borderColor: colors.green, backgroundColor: colors.mint },
  roleIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  roleIconSelected: { backgroundColor: colors.mint },
  iconText: { fontSize: 21, color: colors.muted, fontWeight: '800' },
  iconTextSelected: { color: colors.green },
  roleCopy: { flex: 1, paddingHorizontal: 12 },
  roleTitle: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  roleDetail: { color: colors.muted, fontSize: 11, marginTop: 4 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.green },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green },
  form: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, padding: 16, marginTop: 4 },
  fieldLabel: { color: colors.ink, fontWeight: '700', fontSize: 11, marginTop: 10 },
  optional: { color: colors.muted, fontWeight: '400' },
  input: { minHeight: 46, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13, color: colors.ink, marginTop: 7 },
  providerDetails: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 16, paddingTop: 12 },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  multiline: { minHeight: 82, paddingTop: 12 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  helper: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 10 },
  error: { color: colors.coral, fontSize: 12, marginTop: 12 },
  button: { backgroundColor: colors.green, borderRadius: 14, minHeight: 52, justifyContent: 'center', alignItems: 'center', marginTop: 14 },
  buttonText: { color: colors.buttonText, fontWeight: '800', fontSize: 13 },
  disabled: { opacity: 0.55 },
});
