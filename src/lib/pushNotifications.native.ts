import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const savedPushTokenKey = '@fixhub/expo-push-token';

async function loadPushTokenModule(): Promise<typeof import('expo-notifications')> {
  try {
    return await import('expo-notifications');
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot find native module 'ExpoPushTokenManager'")) {
      throw new Error('Push notifications need the latest Fixhub app. Install a new development build, then try again.');
    }
    throw error;
  }
}

async function getExpoPushToken(notifications: typeof import('expo-notifications')) {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Expo project ID is missing from the app configuration.');
  return (await notifications.getExpoPushTokenAsync({ projectId })).data;
}

async function associatePushToken(profileId: string, token: string) {
  if (!supabase) throw new Error('Notifications cannot be enabled because the app is not connected.');
  const { error } = await supabase.rpc('register_my_push_token', {
    target_expo_push_token: token,
  });
  if (error) throw error;
  await AsyncStorage.setItem(savedPushTokenKey, token);
}

export async function registerPushToken(profileId: string): Promise<boolean> {
  if (!supabase) throw new Error('Notifications cannot be enabled because the app is not connected.');
  const notifications = await loadPushTokenModule();

  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync('default', {
      name: 'Fixhub updates',
      importance: notifications.AndroidImportance.DEFAULT,
    });
  }

  const permissions = await notifications.getPermissionsAsync();
  const finalStatus = permissions.status === 'granted'
    ? permissions.status
    : (await notifications.requestPermissionsAsync()).status;
  if (finalStatus !== 'granted') return false;

  const token = await getExpoPushToken(notifications);
  await associatePushToken(profileId, token);
  const { error: preferenceError } = await supabase.from('notification_preferences').upsert({
    profile_id: profileId,
    push_enabled: true,
  });
  if (preferenceError) throw preferenceError;
  return true;
}

export async function syncPushToken(profileId: string): Promise<void> {
  if (!supabase) return;
  const notifications = await loadPushTokenModule();
  const permissions = await notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return;
  const token = await getExpoPushToken(notifications);
  await associatePushToken(profileId, token);
}

export async function unregisterPushToken(_profileId: string): Promise<void> {
  if (!supabase) return;
  const token = await AsyncStorage.getItem(savedPushTokenKey);
  if (!token) return;
  const { error } = await supabase.rpc('unregister_my_push_token', {
    target_expo_push_token: token,
  });
  if (error) throw error;
  await AsyncStorage.removeItem(savedPushTokenKey);
}

export const registerProviderPushToken = registerPushToken;
