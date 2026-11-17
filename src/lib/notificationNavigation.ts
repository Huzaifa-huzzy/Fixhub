import { router } from 'expo-router';

type NotificationData = Record<string, unknown>;

function getString(data: NotificationData, key: string) {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

export function openNotificationDestination(data: NotificationData) {
  switch (getString(data, 'destination')) {
    case 'chat': {
      const chatId = getString(data, 'chat_id');
      const otherProfileId = getString(data, 'other_profile_id');
      if (!chatId || !otherProfileId) return false;
      router.push({
        pathname: '/chat/[chatId]',
        params: {
          chatId,
          otherProfileId,
          providerName: getString(data, 'provider_name') || 'Fixhub user',
        },
      });
      return true;
    }
    case 'verification':
      router.push('/provider-verification');
      return true;
    case 'profile':
      router.push('/(tabs)/profile');
      return true;
    default:
      return false;
  }
}
