import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import type { NotificationResponse } from 'expo-notifications';
import { useAppSession } from './AppSessionContext';
import { supabase } from '../lib/supabase';
import { registerPushToken, syncPushToken } from '../lib/pushNotifications';
import { openNotificationDestination } from '../lib/notificationNavigation';
import { isNotificationSchemaError, notificationSchemaSetupMessage } from '../lib/notificationErrors';

type NotificationContextValue = {
  unreadCount: number;
  pushEnabled: boolean;
  loading: boolean;
  error: string;
  schemaUnavailable: boolean;
  refreshUnreadCount: () => Promise<void>;
  setPushEnabled: (enabled: boolean) => Promise<boolean>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function getNotificationData(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function NotificationProvider({ children }: PropsWithChildren) {
  const { session, profile } = useAppSession();
  const profileId = session?.user.id;
  const activeProfileId = useRef<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushEnabled, setPushEnabledState] = useState(true);
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [schemaUnavailable, setSchemaUnavailable] = useState(false);
  const lastHandledResponseId = useRef('');
  const hasLoadedProfile = loadedProfileId === profileId;

  useEffect(() => {
    activeProfileId.current = profileId ?? null;
  }, [profileId]);

  const refreshUnreadCount = useCallback(async () => {
    const client = supabase;
    if (!profileId || !client) return;
    const { count, error: countError } = await client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .is('read_at', null);
    if (countError) {
      if (activeProfileId.current === profileId) {
        setSchemaUnavailable(isNotificationSchemaError(countError));
        setError(isNotificationSchemaError(countError) ? notificationSchemaSetupMessage : countError.message);
      }
      return;
    }
    if (activeProfileId.current !== profileId) return;
    setError('');
    setSchemaUnavailable(false);
    setUnreadCount(count ?? 0);
    setLoadedProfileId(profileId);
  }, [profileId]);

  useEffect(() => {
    const client = supabase;
    if (!profileId || !client) return;

    let active = true;
    void Promise.all([
      client.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .is('read_at', null),
      client.from('notification_preferences')
        .select('push_enabled')
        .eq('profile_id', profileId)
        .maybeSingle(),
    ]).then(([countResult, preferenceResult]) => {
      if (!active) return;
      setLoadedProfileId(profileId);
      if (countResult.error) {
        setUnreadCount(0);
        const schemaError = isNotificationSchemaError(countResult.error)
          || isNotificationSchemaError(preferenceResult.error);
        setSchemaUnavailable(schemaError);
        setError(schemaError ? notificationSchemaSetupMessage : countResult.error.message);
      } else {
        setUnreadCount(countResult.count ?? 0);
      }
      if (preferenceResult.error) {
        setPushEnabledState(true);
        const schemaError = isNotificationSchemaError(preferenceResult.error);
        setSchemaUnavailable(schemaError);
        setError(schemaError ? notificationSchemaSetupMessage : preferenceResult.error.message);
      } else {
        setPushEnabledState(preferenceResult.data?.push_enabled ?? true);
      }
      if (!countResult.error && !preferenceResult.error) {
        setError('');
        setSchemaUnavailable(false);
      }
    }).catch((loadError: unknown) => {
      if (!active) return;
      setLoadedProfileId(profileId);
      const errorMessage = loadError instanceof Error ? loadError.message : 'Unable to load notifications.';
      setSchemaUnavailable(isNotificationSchemaError({ message: errorMessage }));
      setError(isNotificationSchemaError({ message: errorMessage }) ? notificationSchemaSetupMessage : errorMessage);
    });

    const channel = client
      .channel(`notifications:${profileId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${profileId}`,
      }, () => { void refreshUnreadCount(); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void refreshUnreadCount();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Live notifications are temporarily disconnected. Reopen this screen to retry.');
        }
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [profileId, refreshUnreadCount]);

  useEffect(() => {
    if (Platform.OS === 'web' || !hasLoadedProfile || !profileId || profile?.id !== profileId) return;
    let active = true;
    void syncPushToken(profileId).catch((syncError: unknown) => {
      if (active) setError(syncError instanceof Error ? syncError.message : 'Unable to sync push notifications for this account.');
    });
    return () => { active = false; };
  }, [hasLoadedProfile, profile?.id, profileId]);

  useEffect(() => {
    if (Platform.OS === 'web' || !profileId || profile?.id !== profileId) return;
    let active = true;
    let responseSubscription: { remove: () => void } | undefined;

    void import('expo-notifications').then(async (notifications) => {
      if (!active) return;
      notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      const handleResponse = (response: NotificationResponse) => {
        const responseId = response.notification.request.identifier;
        if (responseId === lastHandledResponseId.current) return;
        const data = getNotificationData(response.notification.request.content.data);
        if (data?.recipient_profile_id !== profileId) return;
        lastHandledResponseId.current = responseId;
        const notificationId = data.notification_id;
        if (typeof notificationId === 'string') {
          void supabase?.from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', notificationId)
            .eq('profile_id', profileId)
            .is('read_at', null)
            .then(({ error: readError }) => {
              if (readError && activeProfileId.current === profileId) setError(readError.message);
            });
        }
        openNotificationDestination(data);
        notifications.clearLastNotificationResponse();
      };
      responseSubscription = notifications.addNotificationResponseReceivedListener(handleResponse);
      const lastResponse = notifications.getLastNotificationResponse();
      if (active && lastResponse) handleResponse(lastResponse);
    }).catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : 'Push notifications are unavailable in this app build.');
      }
    });

    return () => {
      active = false;
      responseSubscription?.remove();
    };
  }, [profile?.id, profileId]);

  const setPushEnabled = useCallback(async (enabled: boolean) => {
    if (!profileId || !supabase) {
      setError('Sign in to manage notification preferences.');
      return false;
    }
    setError('');
    try {
      if (enabled) {
        const registered = await registerPushToken(profileId);
        if (!registered) {
          setError('Notification permission was not granted. You can enable it in your device settings.');
          return false;
        }
      } else {
        const { error: preferenceError } = await supabase
          .from('notification_preferences')
          .upsert({ profile_id: profileId, push_enabled: false });
        if (preferenceError) throw preferenceError;
      }
      setPushEnabledState(enabled);
      return true;
    } catch (preferenceError) {
      const errorMessage = preferenceError instanceof Error ? preferenceError.message : 'Unable to update notification preferences.';
      const schemaError = isNotificationSchemaError({ message: errorMessage });
      setSchemaUnavailable(schemaError);
      setError(schemaError ? notificationSchemaSetupMessage : errorMessage);
      return false;
    }
  }, [profileId]);

  const value = useMemo(() => ({
    unreadCount: hasLoadedProfile ? unreadCount : 0,
    pushEnabled: hasLoadedProfile ? pushEnabled : true,
    loading: Boolean(profileId && !hasLoadedProfile),
    error: hasLoadedProfile ? error : '',
    schemaUnavailable: hasLoadedProfile && schemaUnavailable,
    refreshUnreadCount,
    setPushEnabled,
  }), [error, hasLoadedProfile, profileId, pushEnabled, refreshUnreadCount, schemaUnavailable, setPushEnabled, unreadCount]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationCenter() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotificationCenter must be used within a NotificationProvider');
  return context;
}
