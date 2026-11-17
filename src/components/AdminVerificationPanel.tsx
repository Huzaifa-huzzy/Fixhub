import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { colors, radius } from '../theme';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';

type PendingVerification = {
  profile_id: string;
  provider_profile_id: string;
  provider_name: string | null;
  category: string;
  verification_status: 'pending';
  cnic_number: string;
  cnic_front_url: string;
  cnic_back_url: string;
  cnic_selfie_url: string;
};
type ReviewItem = PendingVerification & {
  frontSignedUrl: string;
  backSignedUrl: string;
  selfieSignedUrl: string;
};

export function AdminVerificationPanel() {
  const { t, isRTL } = useLanguage();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchPending = useCallback(async () => {
    const client = supabase;
    if (!client) throw new Error(t('Supabase is not configured.'));
    const { data, error: loadError } = await client.rpc('get_pending_provider_verifications');
    if (loadError) throw loadError;
    const rows = (data ?? []) as PendingVerification[];
    return Promise.all(rows.map(async (row) => {
      const [front, back, selfie] = await Promise.all([
        client.storage.from('cnic-documents').createSignedUrl(row.cnic_front_url, 120),
        client.storage.from('cnic-documents').createSignedUrl(row.cnic_back_url, 120),
        client.storage.from('cnic-documents').createSignedUrl(row.cnic_selfie_url, 120),
      ]);
      if (front.error) throw front.error;
      if (back.error) throw back.error;
      if (selfie.error) throw selfie.error;
      return {
        ...row,
        frontSignedUrl: front.data.signedUrl,
        backSignedUrl: back.data.signedUrl,
        selfieSignedUrl: selfie.data.signedUrl,
      };
    }));
  }, [t]);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await fetchPending());
      setReasons({});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('Unable to load provider documents.'));
    } finally {
      setLoading(false);
    }
  }, [fetchPending, t]);

  useEffect(() => {
    let active = true;
    void fetchPending().then((nextItems) => {
      if (active) {
        setItems(nextItems);
        setLoading(false);
      }
    }).catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : t('Unable to load provider documents.'));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [fetchPending, t]);

  async function review(item: ReviewItem, status: 'verified' | 'rejected') {
    if (!supabase) return;
    const reason = reasons[item.provider_profile_id]?.trim() ?? '';
    if (status === 'rejected' && reason.length < 3) {
      setError(t('Write a short reason before rejecting.'));
      return;
    }

    setBusyId(item.provider_profile_id);
    setError('');
    setMessage('');
    const { data, error: updateError } = await supabase
      .from('provider_profiles')
      .update({
        verification_status: status,
        rejection_reason: status === 'rejected' ? reason : null,
      })
      .eq('id', item.provider_profile_id)
      .eq('verification_status', 'pending')
      .select('id')
      .maybeSingle();
    if (updateError) {
      setBusyId('');
      setError(updateError.message);
      return;
    }
    if (!data) {
      setBusyId('');
      setError(t('This provider was already reviewed. Refresh the list.'));
      return;
    }

    setItems((current) => current.filter((entry) => entry.provider_profile_id !== item.provider_profile_id));
    setBusyId('');
    setMessage(t(status === 'verified' ? 'Provider approved. Notifications are queued.' : 'Provider rejected. Notifications are queued.'));
  }

  return (
    <View style={[styles.panel, getLayoutDirectionStyle(isRTL)]}>
      <View style={[styles.headingRow, getLayoutDirectionStyle(isRTL)]}>
        <Text style={[styles.title, isRTL && styles.rtlText]}>{t('CNIC reviews')}</Text>
        <Pressable disabled={loading} onPress={() => void loadPending()} style={styles.refreshButton}>
          <Text style={styles.refreshText}>{t('Refresh')}</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
      {!loading && items.length === 0 ? <Text style={[styles.help, isRTL && styles.rtlText]}>{t('No CNICs are waiting to be checked.')}</Text> : null}
      {items.map((item) => (
        <View key={item.provider_profile_id} style={styles.reviewCard}>
          <Text style={[styles.name, isRTL && styles.rtlText]}>{item.provider_name || t('Provider')}</Text>
          <Text style={[styles.help, isRTL && styles.rtlText]}>{t(item.category)}</Text>
          <Text style={styles.cnicNumber}>{item.cnic_number}</Text>
          <View style={[styles.images, getLayoutDirectionStyle(isRTL)]}>
            <Image accessibilityLabel={t('CNIC front photo')} source={{ uri: item.frontSignedUrl }} style={styles.documentImage} />
            <Image accessibilityLabel={t('CNIC back photo')} source={{ uri: item.backSignedUrl }} style={styles.documentImage} />
            <Image accessibilityLabel={t('Provider selfie')} source={{ uri: item.selfieSignedUrl }} style={styles.documentImage} />
          </View>
          <TextInput
            accessibilityLabel={t('Reason for rejection')}
            maxLength={500}
            multiline
            onChangeText={(value) => setReasons((current) => ({ ...current, [item.provider_profile_id]: value }))}
            placeholder={t('Reason for rejection')}
            placeholderTextColor={colors.muted}
            style={[styles.input, isRTL && styles.rtlInput]}
            value={reasons[item.provider_profile_id] ?? ''}
          />
          <View style={[styles.actions, getLayoutDirectionStyle(isRTL)]}>
            <Pressable
              disabled={Boolean(busyId)}
              onPress={() => void review(item, 'verified')}
              style={[styles.approveButton, Boolean(busyId) && styles.disabled]}
            >
              <Text style={styles.actionText}>{busyId === item.provider_profile_id ? t('Saving…') : t('Approve')}</Text>
            </Pressable>
            <Pressable
              disabled={Boolean(busyId)}
              onPress={() => void review(item, 'rejected')}
              style={[styles.rejectButton, Boolean(busyId) && styles.disabled]}
            >
              <Text style={styles.actionText}>{t('Reject')}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 13,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.ink, fontWeight: '900', fontSize: 16 },
  rtlText: { textAlign: 'right' },
  refreshButton: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.green, borderRadius: 10 },
  refreshText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  loader: { marginVertical: 16 },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  reviewCard: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, marginTop: 12 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  cnicNumber: { color: colors.ink, fontSize: 14, fontWeight: '800', textAlign: 'center', marginVertical: 8 },
  images: { flexDirection: 'row', gap: 8 },
  documentImage: { flex: 1, height: 130, borderRadius: 8, backgroundColor: colors.paper },
  input: { minHeight: 46, maxHeight: 100, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: colors.ink, marginTop: 10 },
  rtlInput: { textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  approveButton: { flex: 1, minHeight: 42, borderRadius: 10, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  rejectButton: { flex: 1, minHeight: 42, borderRadius: 10, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  disabled: { opacity: 0.5 },
  error: { color: colors.coral, fontSize: 12, lineHeight: 18, marginTop: 10 },
  success: { color: colors.greenDark, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
