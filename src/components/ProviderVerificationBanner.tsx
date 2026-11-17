import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { colors, radius } from '../theme';
import { VerifiedBadge } from './VerifiedBadge';

type VerificationStatus = 'pending' | 'verified' | 'rejected';

export function ProviderVerificationBanner({
  status,
  rejectionReason,
  hasDocuments,
  showSuccessMessage = true,
  onManage,
}: {
  status: VerificationStatus;
  rejectionReason: string | null;
  hasDocuments: boolean;
  showSuccessMessage?: boolean;
  onManage: () => void;
}) {
  const { t, isRTL } = useLanguage();

  if (status === 'verified') {
    if (!showSuccessMessage) return null;
    return (
      <View style={[styles.banner, styles.verified, isRTL && styles.rtl]}>
        <VerifiedBadge />
        <Text style={[styles.copy, isRTL && styles.rtlText]}>{t('Your account is checked. You can now show when you are ready for work.')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, status === 'rejected' ? styles.rejected : styles.pending, isRTL && styles.rtl]}>
      <Text style={[styles.title, isRTL && styles.rtlText]}>
        {t(status === 'rejected' ? 'Your CNIC was not accepted.' : 'Your account is under review.')}
      </Text>
      {status === 'rejected' && rejectionReason ? (
        <Text style={[styles.copy, isRTL && styles.rtlText]}>{rejectionReason}</Text>
      ) : null}
      {status === 'pending' && !hasDocuments ? (
        <Text style={[styles.copy, isRTL && styles.rtlText]}>{t('Send your CNIC photos so we can check your account.')}</Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onManage} style={styles.button}>
        <Text style={styles.buttonText}>{t(status === 'rejected' ? 'Send CNIC again' : hasDocuments ? 'View CNIC status' : 'Send CNIC')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: radius.card, padding: 13, marginBottom: 14 },
  verified: { backgroundColor: '#F1FBF5', borderColor: '#B9E6CC', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pending: { backgroundColor: '#FFF9E8', borderColor: '#F2D58A' },
  rejected: { backgroundColor: '#FFF1EF', borderColor: '#F1B6AE' },
  rtl: { alignItems: 'flex-end' },
  rtlText: { textAlign: 'right' },
  title: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  copy: { color: colors.muted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  button: { alignSelf: 'flex-start', backgroundColor: colors.green, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  buttonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
});
