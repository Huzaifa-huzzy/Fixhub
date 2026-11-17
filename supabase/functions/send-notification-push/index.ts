import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseApiKeys } from '../_shared/supabaseKeys.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const webhookSecret = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET');
const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
const { serviceRoleKey } = getSupabaseApiKeys();

type DatabaseWebhook = {
  type?: string;
  table?: string;
  schema?: string;
  record?: {
    id?: string;
    profile_id?: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
    console.error('Notification push delivery is missing server configuration.');
    return jsonResponse({ error: 'Notification delivery is temporarily unavailable.' }, 503);
  }
  if (request.headers.get('Authorization') !== `Bearer ${webhookSecret}`) {
    return jsonResponse({ error: 'Unauthorized notification webhook.' }, 401);
  }

  let payload: DatabaseWebhook;
  try {
    payload = await request.json() as DatabaseWebhook;
  } catch {
    return jsonResponse({ error: 'Invalid notification event.' }, 400);
  }
  const notification = payload.record;
  if (
    payload.type !== 'INSERT'
    || payload.schema !== 'public'
    || payload.table !== 'notifications'
    || !notification
    || typeof notification.id !== 'string'
    || typeof notification.profile_id !== 'string'
    || typeof notification.title !== 'string'
    || typeof notification.body !== 'string'
  ) {
    return jsonResponse({ error: 'Unexpected notification event.' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: claimed, error: claimError } = await adminClient
    .from('notifications')
    .update({ push_status: 'sending', push_error: null })
    .eq('id', notification.id)
    .eq('push_status', 'pending')
    .select('id')
    .maybeSingle();
  if (claimError) {
    console.error('Unable to claim notification push delivery:', claimError.message);
    return jsonResponse({ error: 'Could not prepare notification delivery.' }, 503);
  }
  if (!claimed) return jsonResponse({ sent: 0, duplicate: true });

  const finish = async (status: 'sent' | 'skipped' | 'failed', errorMessage?: string) => {
    const { error } = await adminClient
      .from('notifications')
      .update({ push_status: status, push_error: errorMessage?.slice(0, 500) ?? null })
      .eq('id', notification.id);
    if (error) console.error('Unable to save notification push status:', error.message);
  };

  const { data: preference, error: preferenceError } = await adminClient
    .from('notification_preferences')
    .select('push_enabled')
    .eq('profile_id', notification.profile_id)
    .maybeSingle();
  if (preferenceError) {
    await finish('failed', preferenceError.message);
    console.error('Unable to load notification preference:', preferenceError.message);
    return jsonResponse({ error: 'Could not read notification preferences.' }, 503);
  }
  if (preference?.push_enabled === false) {
    await finish('skipped');
    return jsonResponse({ sent: 0, disabled: true });
  }

  const { data: tokenRows, error: tokenError } = await adminClient
    .from('provider_push_tokens')
    .select('expo_push_token')
    .eq('profile_id', notification.profile_id);
  if (tokenError) {
    await finish('failed', tokenError.message);
    console.error('Unable to load notification devices:', tokenError.message);
    return jsonResponse({ error: 'Could not load notification devices.' }, 503);
  }
  const tokens = [...new Set((tokenRows ?? []).map((row) => row.expo_push_token))];
  if (!tokens.length) {
    await finish('skipped');
    return jsonResponse({ sent: 0, noDevices: true });
  }

  const messages = tokens.map((token) => ({
    to: token,
    title: notification.title,
    body: notification.body,
    sound: 'default',
    channelId: 'default',
    data: {
      ...(notification.data ?? {}),
      notification_id: notification.id,
      recipient_profile_id: notification.profile_id,
    },
  }));
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;

  type PushTicket = { status?: string; message?: string; details?: { error?: string } };
  const tickets: PushTicket[] = [];
  for (let offset = 0; offset < messages.length; offset += 100) {
    const batch = messages.slice(offset, offset + 100);
    let response: Response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(batch),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network request failed.';
      await finish('failed', message);
      console.error('Unable to reach the Expo push service:', message);
      return jsonResponse({ error: 'Could not reach the notification service.' }, 502);
    }
    if (!response.ok) {
      await finish('failed', `Expo push service returned ${response.status}.`);
      console.error('Expo push service returned an error:', response.status);
      return jsonResponse({ error: 'The notification service could not send the message.' }, 502);
    }

    let ticketBody: unknown;
    try {
      ticketBody = await response.json();
    } catch (error) {
      await finish('failed', 'Expo push service returned an invalid response.');
      console.error('Unable to read Expo push response:', error);
      return jsonResponse({ error: 'The notification service returned an invalid response.' }, 502);
    }
    const batchTickets = ticketBody && typeof ticketBody === 'object'
      && 'data' in ticketBody && Array.isArray(ticketBody.data)
      ? ticketBody.data as PushTicket[]
      : [];
    if (batchTickets.length !== batch.length) {
      await finish('failed', 'Expo push service returned an incomplete ticket batch.');
      console.error('Expo push service returned an incomplete ticket batch.');
      return jsonResponse({ error: 'The notification service returned an incomplete response.' }, 502);
    }
    tickets.push(...batchTickets);
  }

  const sent = tickets.filter((ticket) => ticket.status === 'ok').length;
  const invalidTokens = tickets.flatMap((ticket, index) => (
    ticket.details?.error === 'DeviceNotRegistered' ? [tokens[index]] : []
  ));
  if (invalidTokens.length) {
    const { error: deleteError } = await adminClient
      .from('provider_push_tokens')
      .delete()
      .eq('profile_id', notification.profile_id)
      .in('expo_push_token', invalidTokens);
    if (deleteError) console.error('Unable to remove expired push token:', deleteError.message);
  }

  if (sent !== tokens.length) {
    const failedCount = tokens.length - sent;
    await finish('failed', `${failedCount} of ${tokens.length} push deliveries failed.`);
    console.error('Some notification push deliveries failed:', JSON.stringify(tickets));
    return jsonResponse({ error: 'Some notifications could not be sent.', sent }, 502);
  }

  await finish('sent');
  return jsonResponse({ sent });
});
