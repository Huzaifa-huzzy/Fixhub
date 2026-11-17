import { useCallback, useEffect, useState } from 'react';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Upload } from 'tus-js-client';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { colors, radius } from '../theme';

const reportBucket = 'report-evidence';
const configuredSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const configuredSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const maxImages = 2;
const maxVideos = 1;
const maxImageBytes = 5 * 1024 * 1024;
const maxVideoBytes = 25 * 1024 * 1024;
const reportCategories = [
  'Safety concern',
  'Fraud or scam',
  'Harassment or inappropriate behavior',
  'Service quality',
  'Account or sign-in issue',
  'Technical issue',
  'Other',
] as const;

type ReportMediaKind = 'image' | 'video';
type DraftMedia = {
  id: string;
  kind: ReportMediaKind;
  uri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
};
type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
type ExpoVideoModule = typeof import('expo-video');
type ReviewAttachment = {
  id: string;
  kind: ReportMediaKind;
  uri: string;
};
type ReportReview = {
  id: string;
  reporter: string;
  title: string;
  description: string;
  category: string;
  status: ReportStatus;
  createdAt: string;
  attachments: ReviewAttachment[];
};
type PendingDraft = { reportId: string; storagePaths: string[] };

function getAllowedMedia(asset: ImagePicker.ImagePickerAsset, kind: ReportMediaKind) {
  const fileName = asset.fileName || asset.uri.split('/').pop() || `report-${kind}`;
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeByExtension: Record<string, string> = kind === 'image'
    ? { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
    : { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
  const allowedTypes = new Set(Object.values(mimeByExtension));
  const declaredType = asset.mimeType?.toLowerCase().split(';')[0];
  const contentType = declaredType === 'image/jpg' ? 'image/jpeg' : declaredType;
  const extensionType = mimeByExtension[extension];

  if (!extensionType || !allowedTypes.has(extensionType)) return null;
  if (contentType && (!allowedTypes.has(contentType) || contentType !== extensionType)) return null;

  return {
    fileName,
    extension,
    contentType: contentType || extensionType,
  };
}

function formatSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VideoPreview({ uri, style }: { uri: string; style: StyleProp<ViewStyle> }) {
  const { t } = useLanguage();
  const [videoModule, setVideoModule] = useState<ExpoVideoModule | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    import('expo-video').then((module) => {
      if (active) setVideoModule(module);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!videoModule) {
    return (
      <View style={[style, styles.videoPreviewFallback]}>
        {loadFailed ? null : <ActivityIndicator color={colors.white} />}
        <Text style={styles.videoPreviewMessage}>
          {t(loadFailed
            ? 'Video preview requires a new app build with expo-video. Install the latest FixHub build.'
            : 'Loading video preview...')}
        </Text>
      </View>
    );
  }

  return <LoadedVideoPreview module={videoModule} uri={uri} style={style} />;
}

function LoadedVideoPreview({
  module,
  uri,
  style,
}: {
  module: ExpoVideoModule;
  uri: string;
  style: StyleProp<ViewStyle>;
}) {
  const { VideoView, useVideoPlayer } = module;
  const player = useVideoPlayer(uri);
  return <VideoView contentFit="contain" nativeControls player={player} style={style} />;
}

function getUploadEndpoint(projectUrl: string) {
  const url = new URL(projectUrl);
  const supabaseDomain = '.supabase.co';
  if (url.hostname.endsWith(supabaseDomain)) {
    url.hostname = `${url.hostname.slice(0, -supabaseDomain.length)}.storage.supabase.co`;
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

function uploadWithProgress(
  file: File,
  options: {
    endpoint: string;
    accessToken: string;
    apiKey: string;
    path: string;
    contentType: string;
    onProgress: (uploaded: number) => void;
  },
) {
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: options.endpoint,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        apikey: options.apiKey,
        'x-upsert': 'false',
      },
      metadata: {
        bucketName: reportBucket,
        objectName: options.path,
        contentType: options.contentType,
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: false,
      onProgress: (uploaded, total) => options.onProgress(total > 0 ? uploaded / total : 0),
      onError: reject,
      onSuccess: () => resolve(),
    });

    upload.start();
  });
}

export function ReportCenter({ reporterId, isAdmin }: { reporterId: string; isAdmin: boolean }) {
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <View style={styles.center}>
      <ReportSubmissionForm isAdmin={isAdmin} onSubmitted={() => setRefreshToken((current) => current + 1)} reporterId={reporterId} />
      {isAdmin ? <AdminReportReviewPanel refreshToken={refreshToken} /> : null}
    </View>
  );
}

function ReportSubmissionForm({
  reporterId,
  isAdmin,
  onSubmitted,
}: {
  reporterId: string;
  isAdmin: boolean;
  onSubmitted: () => void;
}) {
  const { t, isRTL } = useLanguage();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<(typeof reportCategories)[number]>('Other');
  const [images, setImages] = useState<DraftMedia[]>([]);
  const [video, setVideo] = useState<DraftMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; current: number; total: number } | null>(null);
  const media = [...images, ...(video ? [video] : [])];

  async function pickMedia(kind: ReportMediaKind, replaceIndex?: number) {
    if (busy) return;
    setError('');
    setMessage('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(t('Allow photo access to choose report attachments.'));
        return;
      }

      const remaining = kind === 'image'
        ? replaceIndex === undefined ? maxImages - images.length : 1
        : 1;
      if (remaining < 1) {
        setError(t('The maximum number of images has been reached.'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'image' ? ['images'] : ['videos'],
        allowsMultipleSelection: kind === 'image' && replaceIndex === undefined && remaining > 1,
        selectionLimit: remaining,
        quality: kind === 'image' ? 0.8 : 1,
      });
      if (result.canceled) return;

      const picked: DraftMedia[] = [];
      const invalidFiles: string[] = [];
      for (const asset of result.assets) {
        const allowed = getAllowedMedia(asset, kind);
        if (!allowed) {
          invalidFiles.push(asset.fileName || t(kind === 'image' ? 'Unsupported image format.' : 'Unsupported video format.'));
          continue;
        }

        const file = new File(asset.uri);
        const fileSize = file.size || asset.fileSize || 0;
        const sizeLimit = kind === 'image' ? maxImageBytes : maxVideoBytes;
        if (fileSize <= 0 || fileSize > sizeLimit) {
          invalidFiles.push(`${allowed.fileName} (${t('File size exceeds the limit of')} ${kind === 'image' ? '5 MB' : '25 MB'})`);
          continue;
        }
        picked.push({
          id: `${Date.now()}-${picked.length}-${Math.random().toString(36).slice(2, 8)}`,
          kind,
          uri: asset.uri,
          fileName: allowed.fileName,
          contentType: allowed.contentType,
          fileSize,
        });
      }

      if (kind === 'image') {
        setImages((current) => {
          if (replaceIndex !== undefined) {
            return current.map((item, index) => index === replaceIndex ? picked[0] ?? item : item);
          }
          return [...current, ...picked].slice(0, maxImages);
        });
      } else if (picked[0]) {
        setVideo(picked[0]);
      }

      if (invalidFiles.length) {
        setError(`${t('Some files could not be added:')} ${invalidFiles.join(', ')}`);
      }
    } catch (pickerError) {
      setError(`${t('Unable to choose report media:')} ${pickerError instanceof Error ? pickerError.message : String(pickerError)}`);
    }
  }

  async function clearPendingDraft(client: NonNullable<typeof supabase>, pending: PendingDraft) {
    if (pending.storagePaths.length) {
      const { error: removeError } = await client.storage.from(reportBucket).remove(pending.storagePaths);
      if (removeError) throw removeError;
    }
    const { error: discardError } = await client.rpc('discard_report_submission', {
      target_report_id: pending.reportId,
    });
    if (discardError) throw discardError;
  }

  async function submitReport() {
    const client = supabase;
    if (!client) {
      setError(t('Supabase is not configured.'));
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 160) {
      setError(t('Report title must be between 3 and 160 characters.'));
      return;
    }
    if (trimmedDescription.length < 10 || trimmedDescription.length > 1000) {
      setError(t('Report description must be between 10 and 1000 characters.'));
      return;
    }
    if (images.length > maxImages || (video ? 1 : 0) > maxVideos) {
      setError(t('A report can include at most 2 images and 1 video.'));
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    setUploadProgress(null);
    let activeDraft = pendingDraft;
    let uploadedPaths: string[] = [];
    try {
      if (activeDraft) {
        await clearPendingDraft(client, activeDraft);
        activeDraft = null;
        setPendingDraft(null);
      }

      const { data: reportIdData, error: createError } = await client.rpc('create_report_draft', {
        target_title: trimmedTitle,
        target_description: trimmedDescription,
        target_category: category,
      });
      if (createError) throw createError;
      if (typeof reportIdData !== 'string') throw new Error(t('Unable to create report.'));
      activeDraft = { reportId: reportIdData, storagePaths: [] };

      const indexedMedia = media.map((item, index) => {
        const mediaIndex = media.slice(0, index + 1).filter((entry) => entry.kind === item.kind).length;
        const storagePath = `${reporterId}/${reportIdData}/${item.kind}-${mediaIndex}.${item.fileName.split('.').pop()?.toLowerCase()}`;
        return { item, storagePath };
      });

      if (indexedMedia.length) {
        const { error: reserveError } = await client.from('report_attachments').insert(
          indexedMedia.map(({ item, storagePath }) => ({
            report_id: reportIdData,
            reporter_id: reporterId,
            kind: item.kind,
            storage_path: storagePath,
            content_type: item.contentType,
            file_size: item.fileSize,
          })),
        );
        if (reserveError) throw reserveError;
      }

      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error(t('Please sign in again before submitting a report.'));
      if (!configuredSupabaseUrl || !configuredSupabaseAnonKey) {
        throw new Error(t('Supabase is not configured.'));
      }
      const totalBytes = indexedMedia.reduce((total, entry) => total + entry.item.fileSize, 0);
      let completedBytes = 0;

      for (let index = 0; index < indexedMedia.length; index += 1) {
        const { item, storagePath } = indexedMedia[index];
        setUploadProgress({ percent: Math.round(completedBytes / Math.max(totalBytes, 1) * 100), current: index + 1, total: indexedMedia.length });
        await uploadWithProgress(new File(item.uri), {
          endpoint: getUploadEndpoint(configuredSupabaseUrl),
          accessToken: session.access_token,
          apiKey: configuredSupabaseAnonKey,
          path: storagePath,
          contentType: item.contentType,
          onProgress: (fraction) => {
            const percent = Math.round((completedBytes + item.fileSize * fraction) / Math.max(totalBytes, 1) * 100);
            setUploadProgress({ percent, current: index + 1, total: indexedMedia.length });
          },
        });
        uploadedPaths.push(storagePath);
        if (activeDraft) activeDraft.storagePaths = [...uploadedPaths];
        completedBytes += item.fileSize;
        setUploadProgress({ percent: Math.round(completedBytes / Math.max(totalBytes, 1) * 100), current: index + 1, total: indexedMedia.length });
      }

      const { error: finalizeError } = await client.rpc('finalize_report_submission', {
        target_report_id: reportIdData,
      });
      if (finalizeError) throw finalizeError;

      setTitle('');
      setDescription('');
      setCategory('Other');
      setImages([]);
      setVideo(null);
      setPendingDraft(null);
      setMessage(t('Your report has been submitted.'));
      if (isAdmin) onSubmitted();
    } catch (submitError) {
      let cleanupMessage = '';
      if (activeDraft) {
        const failedDraft = { ...activeDraft, storagePaths: [...uploadedPaths] };
        try {
          await clearPendingDraft(client, failedDraft);
          setPendingDraft(null);
        } catch (cleanupError) {
          cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          setPendingDraft(failedDraft);
        }
      }
      const originalMessage = submitError instanceof Error ? submitError.message : String(submitError);
      setError(cleanupMessage
        ? `${t('Unable to finish report submission:')} ${originalMessage}. ${t('Upload cleanup failed. Retry submitting to clean up the draft:')} ${cleanupMessage}`
        : `${t('Unable to submit report:')} ${originalMessage}`);
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  return (
    <View style={[styles.panel, getLayoutDirectionStyle(isRTL)]}>
      <Text style={[styles.panelTitle, isRTL && styles.rtlText]}>{t('Report a problem')}</Text>
      <Text style={[styles.helper, isRTL && styles.rtlText]}>{t('Send Fixhub a report about a safety, service, account, or app issue.')}</Text>
      <TextInput
        accessibilityLabel={t('Report title')}
        maxLength={160}
        onChangeText={setTitle}
        placeholder={t('Report title')}
        placeholderTextColor={colors.muted}
        style={[styles.input, isRTL && styles.rtlInput]}
        value={title}
      />
      <TextInput
        accessibilityLabel={t('Describe the issue')}
        maxLength={1000}
        multiline
        onChangeText={setDescription}
        placeholder={t('Describe the issue (10–1000 characters)')}
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.multiline, isRTL && styles.rtlInput]}
        textAlignVertical="top"
        value={description}
      />
      <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('Category')}</Text>
      <View style={[styles.categoryList, isRTL && styles.categoryListRtl]}>
        {reportCategories.map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: item === category }}
            key={item}
            onPress={() => setCategory(item)}
            style={[styles.categoryChip, item === category && styles.categoryChipSelected]}
          >
            <Text style={[styles.categoryText, item === category && styles.categoryTextSelected]}>
              {t(item)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('Attachments')}</Text>
      <Text style={[styles.helper, isRTL && styles.rtlText]}>
        {t('Up to 2 images (JPG, JPEG, PNG, WEBP; 5 MB each) and 1 video (MP4, MOV, WEBM; 25 MB). Documents are not accepted.')}
      </Text>
      <View style={[styles.pickerActions, isRTL && styles.pickerActionsRtl]}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || images.length >= maxImages}
          onPress={() => void pickMedia('image')}
          style={[styles.secondaryButton, (busy || images.length >= maxImages) && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{t('Add image')} ({images.length}/{maxImages})</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || Boolean(video)}
          onPress={() => void pickMedia('video')}
          style={[styles.secondaryButton, (busy || video) && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{t(video ? 'Replace video' : 'Add video')} ({video ? 1 : 0}/{maxVideos})</Text>
        </Pressable>
      </View>

      {images.map((item, index) => (
        <View key={item.id} style={styles.mediaCard}>
          <Image accessibilityLabel={t('Report image preview')} source={{ uri: item.uri }} style={styles.imagePreview} />
          <Text numberOfLines={1} style={styles.mediaName}>{item.fileName} · {formatSize(item.fileSize)}</Text>
          <View style={[styles.mediaActions, isRTL && styles.mediaActionsRtl]}>
            <Pressable disabled={busy} onPress={() => void pickMedia('image', index)} style={styles.mediaButton}>
              <Text style={styles.mediaButtonText}>{t('Replace')}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => setImages((current) => current.filter((entry) => entry.id !== item.id))}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>{t('Remove')}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {video ? (
        <View style={styles.mediaCard}>
          <VideoPreview uri={video.uri} style={styles.videoPreview} />
          <Text numberOfLines={1} style={styles.mediaName}>{video.fileName} · {formatSize(video.fileSize)}</Text>
          <View style={[styles.mediaActions, isRTL && styles.mediaActionsRtl]}>
            <Pressable disabled={busy} onPress={() => void pickMedia('video')} style={styles.mediaButton}>
              <Text style={styles.mediaButtonText}>{t('Replace')}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => setVideo(null)} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>{t('Remove')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
      {pendingDraft ? (
        <Text style={styles.error}>{t('An unfinished upload is saved securely. Retrying submission will clean it up first.')}</Text>
      ) : null}
      {uploadProgress ? (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: uploadProgress.percent }} style={styles.progressSection}>
          <Text style={styles.progressText}>
            {t('Uploading attachment')} {uploadProgress.current}/{uploadProgress.total} · {uploadProgress.percent}%
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${uploadProgress.percent}%` }]} />
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !supabase}
        onPress={() => void submitReport()}
        style={[styles.submitButton, (busy || !supabase) && styles.disabled]}
      >
        {busy
          ? <ActivityIndicator color={colors.buttonText} />
          : <Text style={styles.submitButtonText}>{t('Submit report')}</Text>}
      </Pressable>
    </View>
  );
}

function AdminReportReviewPanel({ refreshToken }: { refreshToken: number }) {
  const { t, isRTL } = useLanguage();
  const [reports, setReports] = useState<ReportReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const loadReports = useCallback(async () => {
    const client = supabase;
    setLoading(true);
    setError('');
    try {
      if (!client) throw new Error(t('Supabase is not configured.'));
      const { data, error: reportsError } = await client
        .from('reports')
        .select('id, reporter_id, title, reason, category, status, created_at')
        .eq('submitted', true)
        .order('created_at', { ascending: false })
        .limit(50);
      if (reportsError) throw reportsError;
      const rows = data ?? [];
      if (!rows.length) {
        setReports([]);
        return;
      }

      const reportIds = rows.map((row) => row.id);
      const reporterIds = [...new Set(rows.map((row) => row.reporter_id))];
      const [{ data: attachments, error: attachmentsError }, { data: reporters, error: reportersError }] = await Promise.all([
        client.from('report_attachments')
          .select('id, report_id, kind, storage_path')
          .in('report_id', reportIds)
          .eq('uploaded', true),
        client.from('profiles').select('id, name').in('id', reporterIds),
      ]);
      if (attachmentsError) throw attachmentsError;
      if (reportersError) throw reportersError;

      const reporterNames = new Map((reporters ?? []).map((reporter) => [reporter.id, reporter.name]));
      const signedAttachments = await Promise.all((attachments ?? []).map(async (attachment) => {
        const { data: signed, error: signedError } = await client.storage
          .from(reportBucket)
          .createSignedUrl(attachment.storage_path, 300);
        if (signedError) throw signedError;
        return {
          id: attachment.id,
          reportId: attachment.report_id,
          kind: attachment.kind as ReportMediaKind,
          uri: signed.signedUrl,
        };
      }));

      setReports(rows.map((row) => ({
        id: row.id,
        reporter: reporterNames.get(row.reporter_id) || row.reporter_id.slice(0, 8),
        title: row.title,
        description: row.reason,
        category: row.category,
        status: row.status as ReportStatus,
        createdAt: row.created_at,
        attachments: signedAttachments
          .filter((attachment) => attachment.reportId === row.id)
          .map(({ id, kind, uri }) => ({ id, kind, uri })),
      })));
    } catch (loadError) {
      setError(`${t('Unable to load reports:')} ${loadError instanceof Error ? loadError.message : String(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void Promise.resolve().then(loadReports);
  }, [loadReports, refreshToken]);

  async function updateStatus(reportId: string, status: ReportStatus) {
    if (!supabase) {
      setError(t('Supabase is not configured.'));
      return;
    }
    setBusyId(reportId);
    setError('');
    const { error: updateError } = await supabase
      .from('reports')
      .update({ status })
      .eq('id', reportId);
    setBusyId('');
    if (updateError) {
      setError(`${t('Unable to update report:')} ${updateError.message}`);
      return;
    }
    setReports((current) => current.map((report) => report.id === reportId ? { ...report, status } : report));
  }

  return (
    <View style={[styles.panel, getLayoutDirectionStyle(isRTL)]}>
      <View style={[styles.adminHeader, isRTL && styles.adminHeaderRtl]}>
        <Text style={[styles.panelTitle, isRTL && styles.rtlText]}>{t('Submitted reports')}</Text>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void loadReports()} style={styles.refreshButton}>
          <Text style={styles.refreshText}>{t('Refresh')}</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
      {!loading && !error && reports.length === 0 ? (
        <Text style={[styles.helper, isRTL && styles.rtlText]}>{t('No reports have been submitted.')}</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {reports.map((report) => (
        <View key={report.id} style={styles.reportCard}>
          <Text style={[styles.reportTitle, isRTL && styles.rtlText]}>{report.title}</Text>
          <Text style={[styles.helper, isRTL && styles.rtlText]}>
            {t('Reported by')} {report.reporter} · {t(report.category)} · {t(report.status)}
          </Text>
          <Text style={[styles.reportDescription, isRTL && styles.rtlText]}>{report.description}</Text>
          {report.attachments.map((attachment) => (
            <View key={attachment.id} style={styles.adminMedia}>
              {attachment.kind === 'image'
                ? <Image accessibilityLabel={t('Report image preview')} source={{ uri: attachment.uri }} style={styles.imagePreview} />
                : <VideoPreview uri={attachment.uri} style={styles.videoPreview} />}
            </View>
          ))}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusActions}>
            {(['reviewing', 'resolved', 'dismissed'] as const).map((status) => (
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busyId) || report.status === status}
                key={status}
                onPress={() => void updateStatus(report.id, status)}
                style={[styles.statusButton, report.status === status && styles.categoryChipSelected]}
              >
                {busyId === report.id && report.status !== status
                  ? <ActivityIndicator color={colors.buttonText} />
                  : <Text style={[styles.statusButtonText, report.status === status && styles.categoryTextSelected]}>{t(`Mark ${status}`)}</Text>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { width: '100%' },
  panel: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 12,
  },
  panelTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 6 },
  rtlText: { textAlign: 'right' },
  rtlInput: { textAlign: 'right' },
  input: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 45,
    paddingHorizontal: 12,
    fontSize: 12,
    color: colors.ink,
    marginTop: 10,
  },
  multiline: { minHeight: 104, paddingTop: 12 },
  fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: '800', marginTop: 14 },
  categoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  categoryListRtl: { flexDirection: 'row-reverse' },
  categoryChip: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 10 },
  categoryChipSelected: { backgroundColor: colors.green, borderColor: colors.green },
  categoryText: { color: colors.ink, fontSize: 10, fontWeight: '700' },
  categoryTextSelected: { color: colors.buttonText },
  pickerActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  pickerActionsRtl: { flexDirection: 'row-reverse' },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, minHeight: 42, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5 },
  secondaryText: { color: colors.buttonText, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  mediaCard: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 9, marginTop: 10 },
  imagePreview: { width: '100%', height: 190, borderRadius: 10, backgroundColor: colors.mint, resizeMode: 'cover' },
  videoPreview: { width: '100%', height: 190, borderRadius: 10, backgroundColor: '#111111' },
  videoPreviewFallback: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  videoPreviewMessage: { color: colors.white, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  mediaName: { color: colors.ink, fontSize: 10, marginTop: 7 },
  mediaActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  mediaActionsRtl: { flexDirection: 'row-reverse' },
  mediaButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12 },
  mediaButtonText: { color: colors.buttonText, fontSize: 11, fontWeight: '700' },
  removeButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12 },
  removeButtonText: { color: colors.buttonText, fontSize: 11, fontWeight: '700' },
  error: { color: colors.coral, fontSize: 11, lineHeight: 16, marginTop: 9 },
  success: { color: colors.green, fontWeight: '700', fontSize: 12, marginTop: 10 },
  progressSection: { marginTop: 12 },
  progressText: { color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  progressTrack: { height: 7, backgroundColor: colors.mint, borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.green, borderRadius: 5 },
  submitButton: { backgroundColor: colors.green, borderRadius: 12, minHeight: 46, justifyContent: 'center', alignItems: 'center', marginTop: 14 },
  submitButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  disabled: { opacity: 0.55 },
  adminHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  adminHeaderRtl: { flexDirection: 'row-reverse' },
  refreshButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.green },
  refreshText: { color: colors.buttonText, fontWeight: '800', fontSize: 11 },
  loader: { marginTop: 16 },
  reportCard: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, marginTop: 12 },
  reportTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  reportDescription: { color: colors.ink, fontSize: 12, lineHeight: 18, marginTop: 8 },
  adminMedia: { marginTop: 9 },
  statusActions: { flexDirection: 'row', gap: 7, marginTop: 10 },
  statusButton: { minHeight: 36, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 10, paddingHorizontal: 10 },
  statusButtonText: { color: colors.buttonText, fontSize: 10, fontWeight: '700' },
});
