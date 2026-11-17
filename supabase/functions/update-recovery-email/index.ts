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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Recovery email update is missing server configuration.');
    return jsonResponse({ error: 'Recovery email update is temporarily unavailable.' }, 503);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse({ error: 'Sign in before updating your recovery email.' }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid recovery email request.' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Invalid recovery email request.' }, 400);
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.email !== 'string' || typeof body.redirectTo !== 'string') {
    return jsonResponse({ error: 'Enter a valid recovery email.' }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const emailDomain = email.split('@').at(-1) ?? '';
  if (email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || ['invalid', 'test', 'example', 'localhost'].some((suffix) => emailDomain === suffix || emailDomain.endsWith(`.${suffix}`))) {
    return jsonResponse({ error: 'Enter a real, deliverable email address.' }, 400);
  }

  const auth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await auth.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Sign in again before updating your recovery email.' }, 401);
  }
  const user = userData.user;
  if (!user.email) return jsonResponse({ error: 'This account does not have an email address to update.' }, 409);
  if (user.email.toLowerCase() === email && user.email_confirmed_at) {
    return jsonResponse({ error: 'This email is already verified for your account.' }, 409);
  }

  const username = typeof user.user_metadata.username === 'string'
    ? user.user_metadata.username
    : user.id;
  const ipAddress = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  if (!ipAddress) return jsonResponse({ error: 'Could not verify this email update. Please try again.' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: allowed, error: rateLimitError } = await admin.rpc('consume_username_auth_attempt', {
    p_action: 'recovery',
    p_ip_hash: await sha256(ipAddress),
    p_username_hash: await sha256(username),
  });
  if (rateLimitError) {
    console.error('Unable to verify recovery email rate limit:', rateLimitError.message);
    return jsonResponse({ error: 'Recovery email update is temporarily unavailable.' }, 503);
  }
  if (!allowed) {
    return jsonResponse({ error: 'Too many recovery requests. Please wait before trying again.' }, 429);
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    email,
    email_confirm: false,
  });
  if (updateError) {
    const message = updateError.message.toLowerCase();
    if (message.includes('already') || message.includes('registered') || message.includes('duplicate')) {
      return jsonResponse({ error: 'That email is already in use.' }, 409);
    }
    console.error('Unable to update recovery email:', updateError.message);
    return jsonResponse({ error: 'Could not update your recovery email. Please try again.' }, 400);
  }

  const { error: resendError } = await auth.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: body.redirectTo },
  });
  if (resendError) {
    const { error: rollbackError } = await admin.auth.admin.updateUserById(user.id, {
      email: user.email,
      email_confirm: Boolean(user.email_confirmed_at),
    });
    if (rollbackError) {
      console.error('Unable to restore the previous recovery email:', rollbackError.message);
      return jsonResponse({ error: 'Email verification could not be sent. Please contact support before signing out.' }, 503);
    }
    console.error('Unable to send recovery email verification:', resendError.message);
    return jsonResponse({ error: 'Could not send verification email. Please try again later.' }, 503);
  }

  return jsonResponse({ message: 'Check your email and confirm the address to enable account recovery.' }, 200);
});
