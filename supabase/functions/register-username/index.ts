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
    console.error('Username registration is missing server configuration.');
    return jsonResponse({ error: 'Account registration is temporarily unavailable.' }, 503);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid registration request.' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Invalid registration request.' }, 400);
  }

  const body = payload as Record<string, unknown>;
  if (typeof body.username !== 'string'
    || typeof body.name !== 'string'
    || typeof body.email !== 'string'
    || typeof body.password !== 'string'
    || typeof body.redirectTo !== 'string') {
    return jsonResponse({ error: 'Enter your name, email, and password.' }, 400);
  }

  const username = normalizeUsername(body.username);
  const name = body.name.trim().replace(/\s+/g, ' ');
  const email = body.email.trim().toLowerCase();
  const emailDomain = email.split('@').at(-1) ?? '';
  const password = body.password;
  if (username.length < 2 || username.length > 50 || name.length < 2 || name.length > 50) {
    return jsonResponse({ error: 'Name must be between 2 and 50 characters.' }, 400);
  }
  if (email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || ['invalid', 'test', 'example', 'localhost'].some((suffix) => emailDomain === suffix || emailDomain.endsWith(`.${suffix}`))) {
    return jsonResponse({ error: 'Enter a real, deliverable email address.' }, 400);
  }
  if (password.length < 6 || password.length > 128) {
    return jsonResponse({ error: 'Password must be between 6 and 128 characters.' }, 400);
  }

  const ipAddress = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  if (!ipAddress) return jsonResponse({ error: 'Could not verify this registration request. Please try again.' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ipHash = await sha256(ipAddress);
  const { data: allowed, error: rateLimitError } = await admin.rpc(
    'consume_username_registration_attempt',
    { p_ip_hash: ipHash },
  );
  if (rateLimitError) {
    console.error('Unable to verify username registration rate limit:', rateLimitError.message);
    return jsonResponse({ error: 'Account registration is temporarily unavailable.' }, 503);
  }
  if (!allowed) return jsonResponse({ error: 'Registration rate limit exceeded. Please try again later.' }, 429);

  const { data: existingProfile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (profileError) {
    console.error('Unable to check username availability:', profileError.message);
    return jsonResponse({ error: 'Could not create account. Please try again.' }, 503);
  }
  if (existingProfile) return jsonResponse({ error: 'That name is already in use. Choose another name.' }, 409);

  const auth = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error: signUpError } = await auth.auth.signUp({
    email,
    password,
    options: {
      data: { name, username },
      emailRedirectTo: body.redirectTo,
    },
  });
  if (signUpError) {
    const message = signUpError.message.toLowerCase();
    if (message.includes('already') || message.includes('registered') || message.includes('duplicate')) {
      return jsonResponse({ error: 'That email or name is already in use.' }, 409);
    }
    console.error('Unable to register username account:', signUpError.message);
    return jsonResponse({ error: 'Could not create account. Please try again.' }, 400);
  }
  if (data.user?.identities?.length === 0) {
    return jsonResponse({ error: 'That email or name is already in use.' }, 409);
  }

  if (!data.user || !data.session) {
    if (data.user) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
      if (deleteError) {
        console.error('Unable to remove a registration without an authenticated session:', deleteError.message);
        return jsonResponse({ error: 'Account was created but sign-in could not be completed. Contact support.' }, 503);
      }
    }
    return jsonResponse({
      error: 'Sign-up did not create an authenticated session. Check the Supabase email-confirmation setting and try again.',
    }, 503);
  }

  return jsonResponse({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  }, 201);
});
