import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppIcon } from '../components/AppIcon';
import { useAppSession } from '../context/AppSessionContext';
import { useLanguage } from '../context/LanguageContext';
import { useNotificationCenter } from '../context/NotificationContext';
import { openNotificationDestination } from '../lib/notificationNavigation';
import { supabase } from '../lib/supabase';
import { isNotificationSchemaError, notificationSchemaSetupMessage } from '../lib/notificationErrors';
import { colors, radius } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type NotificationItem = {
  id: string;
  kind: 'chat' | 'report' | 'verification' | 'booking' | 'account' | 'platform';
  title: string;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

function formatNotificationDate(value: string, language: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function NotificationsScreen() {
  const { profile } = useAppSession();
  const { language, isRTL, t } = useLanguage();
  const insets = useSafeAreaInsets();
  const {
    unreadCount,
    pushEnabled,
    error: notificationError,
    schemaUnavailable: contextSchemaUnavailable,
    refreshUnreadCount,
    setPushEnabled,
  } = useNotificationCenter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [schemaUnavailable, setSchemaUnavailable] = useState(false);
  const backendUnavailable = schemaUnavailable || contextSchemaUnavailable;

  const loadNotifications = useCallback(async () => {
    if (!profile || !supabase) {
      setNotifications([]);
      setLoading(false);
      setError('');
      return;
    }
    const { data, error: loadError } = await supabase
      .from('notifications')
      .select('id,kind,title,body,data,created_at,read_at')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (loadError) {
      const schemaError = isNotificationSchemaError(loadError);
      setSchemaUnavailable(schemaError);
      setError(schemaError ? notificationSchemaSetupMessage : loadError.message);
    } else {
      setError('');
      setSchemaUnavailable(false);
      setNotifications((data ?? []) as NotificationItem[]);
    }
    setLoading(false);
  }, [profile]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void loadNotifications();
  }, [loadNotifications]));

  useEffect(() => {
    const client = supabase;
    if (!profile || !client) return;
    const channel = client
      .channel(`notification-list:${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${profile.id}`,
      }, () => {
        void loadNotifications();
        void refreshUnreadCount();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void loadNotifications();
          void refreshUnreadCount();
        }
      });
    return () => { void client.removeChannel(channel); };
  }, [loadNotifications, profile, refreshUnreadCount]);

  async function markAsRead(item: NotificationItem) {
    if (!profile || !supabase) return;
    if (!item.read_at) {
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('profile_id', profile.id)
        .is('read_at', null);
      if (updateError) {
        const schemaError = isNotificationSchemaError(updateError);
        setSchemaUnavailable(schemaError);
        setError(schemaError ? notificationSchemaSetupMessage : updateError.message);
        return;
      }
      setNotifications((current) => current.map((notification) => (
        notification.id === item.id
          ? { ...notification, read_at: new Date().toISOString() }
          : notification
      )));
      void refreshUnreadCount();
    }
    if (!openNotificationDestination(item.data)) setMessage(t('This notification has no linked screen.'));
  }

  async function markAllAsRead() {
    if (!profile || !supabase || busy || unreadCount === 0) return;
    setBusy(true);
    setError('');
    setMessage('');
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('profile_id', profile.id)
      .is('read_at', null);
    setBusy(false);
    if (updateError) {
      const schemaError = isNotificationSchemaError(updateError);
      setSchemaUnavailable(schemaError);
      setError(schemaError ? notificationSchemaSetupMessage : updateError.message);
      return;
    }
    setNotifications((current) => current.map((notification) => (
      notification.read_at ? notification : { ...notification, read_at: new Date().toISOString() }
    )));
    void refreshUnreadCount();
    setMessage(t('All notifications marked as read.'));
  }

  async function togglePush() {
    setMessage('');
    const result = await setPushEnabled(!pushEnabled);
    if (result) setMessage(t(pushEnabled ? 'Push notifications turned off.' : 'Push notifications are enabled.'));
  }

  async function refresh() {
    setRefreshing(true);
    await loadNotifications();
    await refreshUnreadCount();
    setRefreshing(false);
  }

  function renderNotification({ item }: { item: NotificationItem }) {
    return (
      <Pressable
        accessibilityLabel={`${item.title}. ${item.body}. ${formatNotificationDate(item.created_at, language)}${item.read_at ? '' : `, ${t('Unread')}`}`}
        accessibilityRole="button"
        onPress={() => void markAsRead(item)}
        style={[styles.notification, !item.read_at && styles.unreadNotification, isRTL && styles.notificationRtl]}
      >
        <View style={[styles.iconWrap, !item.read_at && styles.unreadIconWrap]}>
          <AppIcon
            color={!item.read_at ? colors.greenDark : colors.muted}
            name={item.kind === 'chat' ? 'messageCircle' : item.kind === 'verification' ? 'badgeCheck' : item.kind === 'report' ? 'info' : 'bell'}
            size={18}
          />
        </View>
        <View style={styles.notificationCopy}>
          <View style={[styles.titleRow, isRTL && styles.rowRtl]}>
            <Text style={[styles.notificationTitle, isRTL && styles.rtlText]}>{item.title}</Text>
            {!item.read_at ? <View accessibilityLabel={t('Unread')} style={styles.unreadDot} /> : null}
          </View>
          <Text style={[styles.notificationBody, isRTL && styles.rtlText]}>{item.body}</Text>
          <Text style={[styles.date, isRTL && styles.rtlText]}>{formatNotificationDate(item.created_at, language)}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.headerTitleRow, isRTL && styles.headerRtl]}>
          <Pressable accessibilityLabel={t('Back')} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <AppIcon color={colors.buttonText} name={isRTL ? 'arrowRight' : 'arrowLeft'} size={21} />
          </Pressable>
          <View style={styles.headingCopy}>
            <Text style={[styles.heading, isRTL && styles.rtlText]}>{t('Notifications')}</Text>
            <Text style={[styles.subtitle, isRTL && styles.rtlText]}>
              {backendUnavailable
                ? t('Notification history is unavailable until server setup is complete.')
                : unreadCount ? `${unreadCount} ${t('unread')}` : t('You are all caught up.')}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy || unreadCount === 0 || backendUnavailable}
          onPress={() => void markAllAsRead()}
          style={[styles.markAllButton, isRTL && styles.markAllButtonRtl, (busy || unreadCount === 0 || backendUnavailable) && styles.disabled]}
        >
          <Text style={styles.markAllText}>{busy ? t('Saving…') : t('Mark all as read')}</Text>
        </Pressable>
      </View>

      {backendUnavailable ? (
        <View style={styles.setupNotice}>
          <Text style={[styles.setupTitle, isRTL && styles.rtlText]}>{t('Notification setup required')}</Text>
          <Text style={[styles.setupBody, isRTL && styles.rtlText]}>
            {t('Apply the Supabase migration supabase/migrations/202611150001_realtime_notifications.sql. If it is already applied, run NOTIFY pgrst, \'reload schema\'; in the Supabase SQL Editor, then reload this screen.')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.preferences}>
            <View style={[styles.preferenceIntro, isRTL && styles.headerRtl]}>
              <View style={styles.preferenceIcon}><AppIcon color={colors.greenDark} name="bell" size={17} /></View>
              <View style={styles.preferenceCopy}>
                <Text style={[styles.preferenceTitle, isRTL && styles.rtlText]}>{t('Push notifications')}</Text>
                <Text style={[styles.preferenceDescription, isRTL && styles.rtlText]}>
                  {t(pushEnabled ? 'Enabled for this account. Set up each device to receive alerts.' : 'Disabled for this account. In-app notifications will still be saved.')}
                </Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void togglePush()} style={styles.preferenceButton}>
              <Text style={styles.preferenceButtonText}>{t(pushEnabled ? 'Turn off' : 'Turn on')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void setPushEnabled(true)} style={styles.deviceSetupButton}>
              <Text style={styles.deviceSetupText}>{t('Enable push on this device')}</Text>
            </Pressable>
          </View>
        </>
      )}

      {(error || notificationError) && !backendUnavailable ? (
        <Text accessibilityRole="alert" style={styles.error}>{error || notificationError}</Text>
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}

      {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : backendUnavailable ? (
        <View style={styles.unavailableSpace} />
      ) : (
        <FlatList
          contentContainerStyle={notifications.length ? styles.list : styles.emptyList}
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={() => void refresh()} refreshing={refreshing} tintColor={colors.green} />}
          renderItem={renderNotification}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><AppIcon color={colors.green} name="bell" size={25} /></View>
              <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t('No notifications yet')}</Text>
              <Text style={[styles.emptyCopy, isRTL && styles.rtlText]}>{t('Important updates about your Fixhub account will appear here.')}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 12, paddingBottom: 8 },
  headerTitleRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center' },
  headerRtl: { flexDirection: 'row-reverse' },
  backButton: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: colors.green, borderRadius: 10 },
  headingCopy: { flex: 1, minWidth: 0, marginHorizontal: 4 },
  heading: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  markAllButton: { minHeight: 38, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.green },
  markAllButtonRtl: { alignSelf: 'flex-start' },
  markAllText: { color: colors.buttonText, fontSize: 11, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  preferences: { backgroundColor: colors.white, marginHorizontal: 14, marginTop: 12, borderRadius: radius.card, padding: 12 },
  preferenceIntro: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  preferenceIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  preferenceCopy: { flex: 1, minWidth: 0 },
  preferenceTitle: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  preferenceDescription: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  preferenceButton: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 10, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
  preferenceButtonText: { color: colors.buttonText, fontSize: 10, fontWeight: '800' },
  deviceSetupButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginTop: 4, paddingHorizontal: 10, backgroundColor: colors.green, borderRadius: 10 },
  deviceSetupText: { color: colors.buttonText, fontSize: 10, fontWeight: '800' },
  setupNotice: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: radius.card, marginHorizontal: 14, marginTop: 12, padding: 14 },
  setupTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  setupBody: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 6 },
  unavailableSpace: { flex: 1 },
  error: { color: colors.coral, fontSize: 11, lineHeight: 16, marginHorizontal: 16, marginTop: 8 },
  success: { color: colors.greenDark, fontSize: 11, lineHeight: 16, marginHorizontal: 16, marginTop: 8 },
  loader: { marginTop: 32 },
  list: { padding: 14, paddingBottom: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  empty: { alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.card, padding: 24 },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.ink, fontSize: 14, fontWeight: '900', marginTop: 12 },
  emptyCopy: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 5, textAlign: 'center' },
  notification: { flexDirection: 'row', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, marginBottom: 9, gap: 11 },
  notificationRtl: { flexDirection: 'row-reverse' },
  unreadNotification: { borderColor: colors.line, backgroundColor: '#FBFEFC' },
  iconWrap: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  unreadIconWrap: { backgroundColor: colors.mint },
  notificationCopy: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowRtl: { flexDirection: 'row-reverse' },
  notificationTitle: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: '900' },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  notificationBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  date: { color: colors.muted, fontSize: 9, marginTop: 7 },
});
