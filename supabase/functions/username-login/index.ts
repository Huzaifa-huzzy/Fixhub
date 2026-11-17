import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseApiKeys } from '../_shared/supabaseKeys.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const { anonKey, serviceRoleKey } = getSupabaseApiKeys();

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Username sign-in is missing server configuration.');
    return jsonResponse({ error: 'Sign-in is temporarily unavailable.' }, 503);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid sign-in request.' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Invalid sign-in request.' }, 400);
  }

  const body = payload as Record<string, unknown>;
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return jsonResponse({ error: 'Enter your name and password.' }, 400);
  }
  const username = normalizeUsername(body.username);
  if (username.length < 2 || username.length > 50 || body.password.length === 0 || body.password.length > 128) {
    return jsonResponse({ error: 'Invalid name or password.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ipAddress = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  if (!ipAddress) return jsonResponse({ error: 'Could not verify this sign-in request. Please try again.' }, 503);
  const { data: allowed, error: rateLimitError } = await admin.rpc('consume_username_auth_attempt', {
    p_action: 'login',
    p_ip_hash: await sha256(ipAddress),
    p_username_hash: await sha256(username),
  });
  if (rateLimitError) {
    console.error('Unable to verify username sign-in rate limit:', rateLimitError.message);
    return jsonResponse({ error: 'Sign-in is temporarily unavailable.' }, 503);
  }
  if (!allowed) {
    return jsonResponse({ error: 'Too many sign-in attempts. Please wait before trying again.' }, 429);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (profileError) {
    console.error('Unable to find username account:', profileError.message);
    return jsonResponse({ error: 'Sign-in is temporarily unavailable.' }, 503);
  }
  if (!profile) {
    return jsonResponse({ error: 'Invalid name or password.' }, 401);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
  if (userError || !userData.user.email) {
    if (userError) console.error('Unable to load username account:', userError.message);
    return jsonResponse({ error: 'Sign-in is temporarily unavailable.' }, 503);
  }

  const auth = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error: signInError } = await auth.auth.signInWithPassword({
    email: userData.user.email,
    password: body.password,
  });
  if (signInError || !data.session) {
    return jsonResponse({ error: 'Invalid name or password.' }, 401);
  }

  return jsonResponse({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  }, 200);
});
