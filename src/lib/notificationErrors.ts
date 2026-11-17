type BackendError = { code?: string; message?: string } | null | undefined;

export function isNotificationSchemaError(error: BackendError) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  const message = error.message?.toLowerCase() ?? '';
  return message.includes('schema cache')
    && (message.includes('notifications') || message.includes('notification_preferences'));
}

export const notificationSchemaSetupMessage =
  'Notifications are not set up on the server. Apply the realtime notifications migration in Supabase, then reload this screen.';
