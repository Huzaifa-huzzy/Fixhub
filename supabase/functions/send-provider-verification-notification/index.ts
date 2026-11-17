import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseApiKeys } from '../_shared/supabaseKeys.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
const { anonKey, serviceRoleKey } = getSupabaseApiKeys();

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Provider verification notification is missing server configuration.');
    return jsonResponse({ error: 'Notifications are temporarily unavailable.' }, 503);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Sign in as an administrator to send this notification.' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Your sign-in has expired. Sign in again.' }, 401);
  }
  const { data: isAdmin, error: roleError } = await userClient.rpc('is_serviceconnect_admin');
  if (roleError) {
    console.error('Unable to verify provider review administrator:', roleError.message);
    return jsonResponse({ error: 'Could not verify administrator access.' }, 503);
  }
  if (!isAdmin) return jsonResponse({ error: 'Only administrators can send this notification.' }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid notification request.' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Invalid notification request.' }, 400);
  }
  const body = payload as Record<string, unknown>;
  if (
    typeof body.profile_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.profile_id)
    || (body.status !== 'verified' && body.status !== 'rejected')
  ) {
    return jsonResponse({ error: 'Choose a valid provider and review decision.' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: provider, error: providerError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('id', body.profile_id)
    .eq('role', 'provider')
    .maybeSingle();
  if (providerError) {
    console.error('Unable to check notification provider:', providerError.message);
    return jsonResponse({ error: 'Could not find this provider.' }, 503);
  }
  if (!provider) return jsonResponse({ error: 'Provider account was not found.' }, 404);

  const { data: tokenRows, error: tokenError } = await adminClient
    .from('provider_push_tokens')
    .select('expo_push_token')
    .eq('profile_id', body.profile_id);
  if (tokenError) {
    console.error('Unable to load provider push tokens:', tokenError.message);
    return jsonResponse({ error: 'Could not load notification devices.' }, 503);
  }
  const tokens = [...new Set((tokenRows ?? []).map((row) => row.expo_push_token))];
  if (!tokens.length) return jsonResponse({ sent: 0 });

  const verified = body.status === 'verified';
  const messages = tokens.map((token) => ({
    to: token,
    title: verified ? 'Fixhub account checked' : 'Fixhub CNIC needs changes',
    body: verified
      ? 'Your account is approved. You can now turn on your work availability.'
      : 'Your CNIC was not approved. Open Fixhub to see the reason and send it again.',
    sound: 'default',
    channelId: 'default',
    data: { verification_status: body.status },
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
    const messageBatch = messages.slice(offset, offset + 100);
    let expoResponse: Response;
    try {
      expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(messageBatch),
      });
    } catch (error) {
      console.error('Unable to reach the Expo push service:', error);
      return jsonResponse({ error: 'Could not reach the notification service.' }, 502);
    }
    if (!expoResponse.ok) {
      console.error('Expo push service returned an error:', expoResponse.status);
      return jsonResponse({ error: 'The notification service could not send the message.' }, 502);
    }

    let ticketBody: unknown;
    try {
      ticketBody = await expoResponse.json();
    } catch (error) {
      console.error('Unable to read Expo push response:', error);
      return jsonResponse({ error: 'The notification service returned an invalid response.' }, 502);
    }
    const batchTickets = ticketBody && typeof ticketBody === 'object' && 'data' in ticketBody && Array.isArray(ticketBody.data)
      ? ticketBody.data as PushTicket[]
      : [];
    if (batchTickets.length !== messageBatch.length) {
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
      .eq('profile_id', body.profile_id)
      .in('expo_push_token', invalidTokens);
    if (deleteError) console.error('Unable to remove expired provider push token:', deleteError.message);
  }
  if (sent !== tokens.length) {
    console.error('Some provider push notifications failed:', JSON.stringify(tickets));
    return jsonResponse({ error: 'Some notifications could not be sent.', sent }, 502);
  }
  return jsonResponse({ sent });
});
