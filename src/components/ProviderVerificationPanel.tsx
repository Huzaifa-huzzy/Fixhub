import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { FieldError } from './FieldError';
import { VerifiedBadge } from './VerifiedBadge';
import { useLanguage } from '../context/LanguageContext';
import { filterIntegerInput } from '../lib/inputValidation';
import { registerProviderPushToken } from '../lib/pushNotifications';
import { supabase } from '../lib/supabase';
import { colors, radius } from '../theme';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';

type VerificationStatus = 'pending' | 'verified' | 'rejected';
type VerificationDetails = {
  verification_status: VerificationStatus;
  cnic_number: string | null;
  cnic_front_url: string | null;
  cnic_back_url: string | null;
  cnic_selfie_url: string | null;
  rejection_reason: string | null;
};
type DocumentSide = 'front' | 'back' | 'selfie';
type DocumentSource = 'camera' | 'library';

const imageMimeTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function getImageType(asset: ImagePicker.ImagePickerAsset) {
  const extension = asset.fileName?.split('.').pop()?.toLowerCase();
  const mimeType = asset.mimeType ?? (extension ? imageMimeTypes[extension] : undefined);
  if (!mimeType || !Object.values(imageMimeTypes).includes(mimeType)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  return {
    mimeType,
    extension: mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg',
  };
}

export function ProviderVerificationPanel({
  profileId,
  providerProfileId,
  initialStatus,
  onRefreshApprovalStatus,
}: {
  profileId: string;
  providerProfileId: string;
  initialStatus: VerificationStatus;
  onRefreshApprovalStatus?: () => Promise<string | null>;
}) {
  const { t, isRTL } = useLanguage();
  const [status, setStatus] = useState(initialStatus);
  const [verificationLoaded, setVerificationLoaded] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [cnicNumber, setCnicNumber] = useState('');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [existingFrontPath, setExistingFrontPath] = useState<string | null>(null);
  const [existingBackPath, setExistingBackPath] = useState<string | null>(null);
  const [existingSelfiePath, setExistingSelfiePath] = useState<string | null>(null);
  const [frontAsset, setFrontAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [backAsset, setBackAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [selfieAsset, setSelfieAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cnicError, setCnicError] = useState('');

  const fetchVerification = useCallback(async () => {
    if (!supabase) throw new Error(t('Supabase is not configured.'));
    const { data, error: loadError } = await supabase.rpc('get_provider_verification', {
      p_profile_id: profileId,
    });
    if (loadError) throw loadError;
    const details = (data?.[0] ?? null) as VerificationDetails | null;
    if (!details) throw new Error(t('Unable to load your CNIC status.'));
    return details;
  }, [profileId, t]);

  const applyVerification = useCallback((details: VerificationDetails) => {
    setStatus(details.verification_status);
    setCnicNumber(details.cnic_number ?? '');
    setExistingFrontPath(details.cnic_front_url);
    setExistingBackPath(details.cnic_back_url);
    setExistingSelfiePath(details.cnic_selfie_url);
    setRejectionReason(details.rejection_reason);
    setVerificationLoaded(true);
    setVerificationLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    setVerificationLoaded(false);
    setVerificationLoading(true);
    setError('');
    void fetchVerification().then((details) => {
      if (active) applyVerification(details);
    }).catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : t('Unable to load your CNIC status.'));
        setVerificationLoading(false);
      }
    });
    return () => { active = false; };
  }, [applyVerification, fetchVerification, t]));

  async function checkApprovalStatus() {
    setCheckingStatus(true);
    setVerificationLoading(true);
    setError('');
    setMessage('');
    try {
      const details = await fetchVerification();
      applyVerification(details);
      const profileError = await onRefreshApprovalStatus?.();
      if (profileError) throw new Error(profileError);
      setMessage(t(details.verification_status === 'verified'
        ? 'Your account is checked. You can now show when you are ready for work.'
        : details.verification_status === 'rejected'
          ? 'Your CNIC was not accepted.'
          : 'Your account is under review.'));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t('Unable to load your CNIC status.'));
    } finally {
      setVerificationLoading(false);
      setCheckingStatus(false);
    }
  }

  function chooseDocument(side: DocumentSide) {
    if (Platform.OS === 'web') {
      void pickDocument(side, 'library');
      return;
    }
    const showPicker = (source: DocumentSource) => {
      void pickDocument(side, source);
    };
    const options = [
      { text: t('Choose from photos'), onPress: () => showPicker('library') },
      { text: t('Take a photo'), onPress: () => showPicker('camera') },
      { text: t('Cancel'), style: 'cancel' as const },
    ];
    const label = side === 'front' ? 'CNIC front photo' : side === 'back' ? 'CNIC back photo' : 'Your selfie';
    Alert.alert(t(label), '', options);
  }

  async function pickDocument(side: DocumentSide, source: DocumentSource) {
    setError('');
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError(t('Allow camera access to take a CNIC photo.'));
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.85,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError(t('Allow photo access to choose a CNIC photo.'));
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.85,
        });
      }
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('No photo was chosen. Please try again.');
      if (asset.fileSize != null && asset.fileSize > 5 * 1024 * 1024) {
        throw new Error('Choose a photo smaller than 5 MB.');
      }
      getImageType(asset);
      if (side === 'front') setFrontAsset(asset);
      else if (side === 'back') setBackAsset(asset);
      else setSelfieAsset(asset);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? t(pickerError.message) : t('Unable to choose this photo.'));
    }
  }

  async function uploadDocument(asset: ImagePicker.ImagePickerAsset, side: DocumentSide) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { mimeType, extension } = getImageType(asset);
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error('Unable to read the chosen photo.');
    const imageData = await response.arrayBuffer();
    const storagePath = `${profileId}/cnic-${Date.now()}-${side}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from('cnic-documents')
      .upload(storagePath, imageData, { contentType: mimeType, upsert: false });
    if (uploadError) throw uploadError;
    return storagePath;
  }

  async function submitDocuments() {
    if (!supabase) {
      setError(t('Supabase is not configured.'));
      return;
    }
    const normalizedCnic = filterIntegerInput(cnicNumber);
    setCnicError('');
    setError('');
    setMessage('');
    if (!/^\d{13}$/.test(normalizedCnic)) {
      setCnicError(t('Enter all 13 digits of your CNIC.'));
      return;
    }
    if (!frontAsset || !backAsset) {
      setError(t('Choose a new photo of both sides of your CNIC.'));
      return;
    }
    if (!selfieAsset) {
      setError(t('Add a clear selfie so we can match you to your CNIC.'));
      return;
    }

    setBusy(true);
    const uploadedPaths: string[] = [];
    try {
      const frontPath = await uploadDocument(frontAsset, 'front');
      uploadedPaths.push(frontPath);
      const backPath = await uploadDocument(backAsset, 'back');
      uploadedPaths.push(backPath);
      const selfiePath = await uploadDocument(selfieAsset, 'selfie');
      uploadedPaths.push(selfiePath);

      const { error: updateError } = await supabase
        .from('provider_profiles')
        .update({
          cnic_number: normalizedCnic,
          cnic_front_url: frontPath,
          cnic_back_url: backPath,
          cnic_selfie_url: selfiePath,
          verification_status: 'pending',
        })
        .eq('id', providerProfileId);
      if (updateError) throw updateError;

      setStatus('pending');
      setCnicNumber(normalizedCnic);
      setExistingFrontPath(frontPath);
      setExistingBackPath(backPath);
      setExistingSelfiePath(selfiePath);
      setRejectionReason(null);
      setFrontAsset(null);
      setBackAsset(null);
      setSelfieAsset(null);

      const oldPaths = [existingFrontPath, existingBackPath, existingSelfiePath]
        .filter((path): path is string => Boolean(path && path !== frontPath && path !== backPath && path !== selfiePath));
      if (oldPaths.length) {
        const { error: cleanupError } = await supabase.storage.from('cnic-documents').remove(oldPaths);
        if (cleanupError) {
          setMessage(t('Your CNIC was sent, but old photos could not be removed.'));
          setError(cleanupError.message);
          return;
        }
      }
      setMessage(t('Your CNIC was sent. We will check it soon.'));
    } catch (submitError) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage.from('cnic-documents').remove(uploadedPaths);
        if (cleanupError) {
          setError(`${submitError instanceof Error ? submitError.message : t('Unable to send your CNIC.')} ${t('New photos could not be removed:')} ${cleanupError.message}`);
          return;
        }
      }
      setError(submitError instanceof Error ? t(submitError.message) : t('Unable to send your CNIC.'));
    } finally {
      setBusy(false);
    }
  }

  async function enableNotifications() {
    setPushBusy(true);
    setError('');
    setMessage('');
    try {
      const enabled = await registerProviderPushToken(profileId);
      setMessage(enabled
        ? t('Notifications are ready. We will tell you when your CNIC is checked.')
        : t('Notifications are off. Turn them on in your phone settings.'));
    } catch (pushError) {
      setError(pushError instanceof Error ? t(pushError.message) : t('Could not turn on notifications.'));
    } finally {
      setPushBusy(false);
    }
  }

  const hasSubmittedDocuments = Boolean(
    cnicNumber && existingFrontPath && existingBackPath && existingSelfiePath,
  );
  const showSubmissionForm = verificationLoaded
    && status !== 'verified'
    && (status === 'rejected' || !hasSubmittedDocuments);

  return (
    <View style={[styles.panel, getLayoutDirectionStyle(isRTL)]}>
      <Text style={[styles.title, isRTL && styles.rtlText]}>
        {t(status === 'pending' && hasSubmittedDocuments ? 'Check approval status' : 'CNIC check')}
      </Text>
      {verificationLoading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
      {verificationLoaded ? (
        <Text style={[
          styles.verificationStatus,
          status === 'verified' && styles.approvedStatus,
          status === 'rejected' && styles.rejectedStatus,
          isRTL && styles.rtlText,
        ]}>
          {t(status === 'verified'
            ? 'Verification status: Approved'
            : status === 'rejected'
              ? 'Verification status: Rejected'
              : hasSubmittedDocuments
                ? 'Verification status: Pending'
                : 'Verification status: Not submitted')}
        </Text>
      ) : null}
      {status === 'verified' ? (
        <View style={styles.statusRow}>
          <VerifiedBadge />
          <Text style={[styles.help, isRTL && styles.rtlText]}>{t('Your account is checked. You can now show when you are ready for work.')}</Text>
        </View>
      ) : status === 'rejected' ? (
        <>
          <Text style={[styles.statusText, isRTL && styles.rtlText]}>{t('Your CNIC was not accepted.')}</Text>
          {rejectionReason ? <Text style={[styles.rejectionReason, isRTL && styles.rtlText]}>{rejectionReason}</Text> : null}
          <Text style={[styles.help, isRTL && styles.rtlText]}>{t('Fix the problem and send clear CNIC photos and a selfie again.')}</Text>
        </>
      ) : existingFrontPath && existingBackPath && existingSelfiePath ? (
        <Text style={[styles.help, isRTL && styles.rtlText]}>
          {t('Your CNIC and selfie are waiting for admin approval. Fixhub access will open after approval.')}
        </Text>
      ) : (
        <Text style={[styles.help, isRTL && styles.rtlText]}>
          {t('Submit your CNIC, both document photos, and a selfie to start admin review.')}
        </Text>
      )}

      {showSubmissionForm ? (
        <>
          <Text style={[styles.help, isRTL && styles.rtlText]}>{t('Write the 13 digits on your CNIC. Other people cannot see your CNIC or photos.')}</Text>
          <TextInput
            accessibilityLabel={t('CNIC number')}
            keyboardType="number-pad"
            maxLength={13}
            onChangeText={(value) => {
              setCnicNumber(filterIntegerInput(value).slice(0, 13));
              setCnicError('');
            }}
            placeholder="00000-0000000-0"
            placeholderTextColor={colors.muted}
            style={[styles.input, isRTL && styles.rtlInput]}
            value={cnicNumber}
          />
          <FieldError message={cnicError} />
          <Text style={[styles.help, isRTL && styles.rtlText]}>{t('Send clear photos of both sides of your CNIC and a selfie of your face.')}</Text>
          <View style={[styles.documentRow, getLayoutDirectionStyle(isRTL)]}>
            <Pressable disabled={busy} onPress={() => chooseDocument('front')} style={styles.photoButton}>
              {frontAsset ? <Image source={{ uri: frontAsset.uri }} style={styles.preview} /> : null}
              <Text style={styles.photoButtonText}>{t(frontAsset ? 'Change front photo' : 'Add front photo')}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => chooseDocument('back')} style={styles.photoButton}>
              {backAsset ? <Image source={{ uri: backAsset.uri }} style={styles.preview} /> : null}
              <Text style={styles.photoButtonText}>{t(backAsset ? 'Change back photo' : 'Add back photo')}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => chooseDocument('selfie')} style={styles.photoButton}>
              {selfieAsset ? <Image source={{ uri: selfieAsset.uri }} style={styles.preview} /> : null}
              <Text style={styles.photoButtonText}>{t(selfieAsset ? 'Change selfie' : 'Add selfie')}</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busy || !supabase}
            onPress={() => void submitDocuments()}
            style={[styles.submitButton, (busy || !supabase) && styles.disabled]}
          >
            {busy
              ? <ActivityIndicator color={colors.buttonText} />
              : <Text style={styles.submitText}>{t(status === 'rejected' ? 'Send CNIC again' : 'Send CNIC for checking')}</Text>}
          </Pressable>
        </>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={checkingStatus || busy}
        onPress={() => void checkApprovalStatus()}
        style={[styles.statusButton, (checkingStatus || busy) && styles.disabled]}
      >
        {checkingStatus
          ? <ActivityIndicator color={colors.buttonText} />
          : <Text style={styles.statusButtonText}>{t('Check approval status')}</Text>}
      </Pressable>

      {Platform.OS !== 'web' ? (
        <Pressable
          accessibilityRole="button"
          disabled={pushBusy || !supabase}
          onPress={() => void enableNotifications()}
          style={[styles.notificationButton, (pushBusy || !supabase) && styles.disabled]}
        >
          {pushBusy
            ? <ActivityIndicator color={colors.buttonText} />
            : <Text style={styles.notificationText}>{t('Turn on notifications')}</Text>}
        </Pressable>
      ) : null}
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
  title: { color: colors.ink, fontWeight: '900', fontSize: 16, marginBottom: 8 },
  loader: { marginVertical: 12 },
  approvedStatus: { color: colors.greenDark },
  rtlText: { textAlign: 'right' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  verificationStatus: { color: colors.ink, fontWeight: '800', fontSize: 13, marginBottom: 8 },
  statusText: { color: colors.coral, fontWeight: '800', fontSize: 13, marginBottom: 5 },
  rejectedStatus: { color: colors.coral },
  rejectionReason: { color: colors.ink, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  input: { height: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, color: colors.ink, fontSize: 15, marginBottom: 2 },
  rtlInput: { textAlign: 'right' },
  documentRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  photoButton: { flex: 1, minHeight: 70, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 8 },
  preview: { width: '100%', height: 76, borderRadius: 8, marginBottom: 6 },
  photoButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12, textAlign: 'center' },
  submitButton: { minHeight: 46, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 12 },
  submitText: { color: colors.buttonText, fontWeight: '800', fontSize: 13 },
  statusButton: { minHeight: 42, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 12 },
  statusButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  notificationButton: { minHeight: 42, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  notificationText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  disabled: { opacity: 0.5 },
  error: { color: colors.coral, fontSize: 12, lineHeight: 18, marginTop: 9 },
  success: { color: colors.greenDark, fontSize: 12, lineHeight: 18, marginTop: 9 },
});
