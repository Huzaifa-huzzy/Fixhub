import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseApiKeys } from '../_shared/supabaseKeys.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const { anonKey, serviceRoleKey } = getSupabaseApiKeys();
const responseMessage = 'If an account exists for this email, check your inbox and spam folder for the password reset link.';

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
    console.error('Password recovery is missing server configuration.');
    return jsonResponse({ error: 'Password recovery is temporarily unavailable.' }, 503);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid recovery request.' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Invalid recovery request.' }, 400);
  }

  const body = payload as Record<string, unknown>;
  if (typeof body.email !== 'string' || typeof body.redirectTo !== 'string') {
    return jsonResponse({ error: 'Enter a valid email address.' }, 400);
  }
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Enter a valid email address.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ipAddress = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  if (!ipAddress) return jsonResponse({ error: 'Could not verify this recovery request. Please try again.' }, 503);
  const { data: allowed, error: rateLimitError } = await admin.rpc('consume_username_auth_attempt', {
    p_action: 'recovery',
    p_ip_hash: await sha256(ipAddress),
    p_username_hash: await sha256(email),
  });
  if (rateLimitError) {
    console.error('Unable to verify password recovery rate limit:', rateLimitError.message);
    return jsonResponse({ error: 'Password recovery is temporarily unavailable.' }, 503);
  }
  if (!allowed) {
    return jsonResponse({ error: 'Too many recovery requests. Please wait before trying again.' }, 429);
  }

  const auth = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: resetError } = await auth.auth.resetPasswordForEmail(email, {
    redirectTo: body.redirectTo,
  });
  if (resetError) {
    console.error('Unable to send a password recovery email:', resetError.message);
    return jsonResponse({ error: 'Could not send a reset email. Please try again later.' }, 503);
  }

  return jsonResponse({ message: responseMessage }, 200);
});
