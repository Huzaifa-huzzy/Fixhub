import { Platform } from 'react-native';
import { supabase } from './supabase';

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

function configureGoogleSignin(GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin) {
  GoogleSignin.configure({
    ...(webClientId ? { webClientId } : {}),
    ...(iosClientId ? { iosClientId } : {}),
    offlineAccess: false,
  });
}

export async function signOutFromGoogle(): Promise<void> {
  const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
  configureGoogleSignin(GoogleSignin);
  await GoogleSignin.signOut();
}

export async function signInWithGoogle(selectAccount = false): Promise<boolean> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!webClientId) {
    throw new Error('Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env.local and rebuild the native app.');
  }
  if (Platform.OS === 'ios' && !iosClientId) {
    throw new Error('Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID in .env.local and rebuild the native app.');
  }

  const { GoogleSignin, isCancelledResponse, isSuccessResponse } = await import(
    '@react-native-google-signin/google-signin'
  );
  configureGoogleSignin(GoogleSignin);

  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

  if (selectAccount) await signOutFromGoogle();
  const response = await GoogleSignin.signIn();
  if (isCancelledResponse(response)) return false;
  if (!isSuccessResponse(response)) throw new Error('Google sign-in did not complete successfully.');

  const idToken = response.data.idToken;
  if (!idToken) throw new Error('Google did not return an ID token. Check the Web client ID configuration.');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  return true;
}
