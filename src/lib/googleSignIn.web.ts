import { supabase } from './supabase';

export function signOutFromGoogle(): Promise<void> {
  return Promise.resolve();
}

export async function signInWithGoogle(selectAccount = false): Promise<boolean> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const redirectTo = new URL('/auth', window.location.href).toString();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      ...(selectAccount ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in did not return an authorization URL.');

  window.location.assign(data.url);
  return true;
}
