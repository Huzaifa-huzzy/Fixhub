import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { signInWithGoogle as signInWithGoogleProvider } from '../lib/googleSignIn';
import { normalizeUsername } from '../lib/usernameAuth';
import { filterTextInput, isValidEmail } from '../lib/inputValidation';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { FieldError } from '../components/FieldError';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';

async function getFunctionError(error: Error, shouldLog = true) {
  let message = error.message;
  let status: number | null = null;
  const context: unknown = 'context' in error ? error.context : null;
  if (context && typeof context === 'object') {
    try {
      if ('status' in context && typeof context.status === 'number') status = context.status;
      const response = 'clone' in context && typeof context.clone === 'function'
        ? context.clone()
        : context;
      const responseText = 'text' in response && typeof response.text === 'function'
        ? await response.text()
        : null;
      if (responseText) {
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          message = responseText.trim().slice(0, 500);
        }
        if (responseBody && typeof responseBody === 'object') {
          if ('error' in responseBody && typeof responseBody.error === 'string') {
            message = responseBody.error;
          } else if ('message' in responseBody && typeof responseBody.message === 'string') {
            message = responseBody.message;
          } else if ('msg' in responseBody && typeof responseBody.msg === 'string') {
            message = responseBody.msg;
          } else {
            message = responseText.trim().slice(0, 500);
          }
        }
      }
    } catch (responseError) {
      console.error('Unable to read authentication error response:', responseError);
    }
  }
  if (shouldLog) {
    const details = {
      functionError: error.name,
      status,
      message,
    };
    if (status === 401) {
      console.warn('Authentication rejected:', details);
    } else {
      console.error('Authentication Edge Function failed:', details);
    }
  }
  return { message, status };
}

function getSessionTokens(value: unknown) {
  if (!value || typeof value !== 'object' || !('session' in value)) return null;
  const session = value.session;
  if (!session || typeof session !== 'object'
    || !('access_token' in session) || typeof session.access_token !== 'string'
    || !('refresh_token' in session) || typeof session.refresh_token !== 'string') return null;
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}

function getRecoveryLinkTokens(linkingUrl: string | null) {
  if (!linkingUrl) return null;
  try {
    const url = new URL(linkingUrl);
    const query = url.searchParams;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const isRecovery = query.get('type') === 'recovery' || fragment.get('type') === 'recovery';
    const accessToken = query.get('access_token') ?? fragment.get('access_token');
    const refreshToken = query.get('refresh_token') ?? fragment.get('refresh_token');
    if (!isRecovery) return null;
    if (!accessToken || !refreshToken) return { invalid: true as const };
    return { access_token: accessToken, refresh_token: refreshToken, invalid: false as const };
  } catch {
    return null;
  }
}

function getAuthRedirectTo() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return new URL('/auth', window.location.href).toString();
  }
  return Linking.createURL('auth');
}

export function AuthScreen({
  onSuccess,
  onCancel,
  selectAccount = false,
}: {
  onSuccess?: () => void;
  onCancel?: () => void;
  selectAccount?: boolean;
}) {
  const { language, t, isRTL, toggleLanguage } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'login' | 'register' | 'recover' | 'recovery-sent' | 'update-password'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [recoveryRetryAt, setRecoveryRetryAt] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const recoveryFlow = useRef(false);
  const processedRecoveryLink = useRef<string | null>(null);
  const linkingUrl = Linking.useLinkingURL();
  const recoveryRetrySeconds = recoveryRetryAt === null
    ? 0
    : Math.max(0, Math.ceil((recoveryRetryAt - currentTime) / 1000));

  useEffect(() => {
    if (mode !== 'recovery-sent' || recoveryRetryAt === null || recoveryRetrySeconds === 0) return;
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [mode, recoveryRetryAt, recoveryRetrySeconds]);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryFlow.current = true;
        setMode('update-password');
        setError('');
        setMessage('');
        return;
      }
      if (session && !recoveryFlow.current
        && (event === 'SIGNED_IN' || (!selectAccount && event === 'INITIAL_SESSION'))) onSuccess?.();
    });
    return () => subscription.unsubscribe();
  }, [onSuccess, selectAccount]);

  useEffect(() => {
    if (!supabase || Platform.OS === 'web' || !linkingUrl) return;
    const tokens = getRecoveryLinkTokens(linkingUrl);
    if (!tokens || tokens.invalid || processedRecoveryLink.current === linkingUrl) return;
    processedRecoveryLink.current = linkingUrl;
    recoveryFlow.current = true;
    void supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    }).then(({ error: sessionError }) => {
      if (sessionError) {
        recoveryFlow.current = false;
        setMode('login');
      }
      else setMode('update-password');
    });
  }, [linkingUrl, t]);

  async function signInWithGoogle() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const completed = await signInWithGoogleProvider(selectAccount);
      if (!completed) setBusy(false);
    } catch (oauthError) {
      setBusy(false);
      setError(oauthError instanceof Error ? oauthError.message : 'Google sign-in failed.');
    }
  }

  function showRecoverySent(cooldownSeconds = 60) {
    const retryAt = Date.now() + cooldownSeconds * 1000;
    setCurrentTime(Date.now());
    setRecoveryRetryAt(retryAt);
    setMode('recovery-sent');
    setMessage('');
  }

  async function submitCredentials() {
    setFieldError(null);
    setError('');
    if (!supabase) {
      setError(t('Connect Supabase to create an account or sign in.'));
      return;
    }
    const username = normalizeUsername(name);
    if ((mode === 'login' || mode === 'register')
      && (username.length < 2 || username.length > 50)) {
      setFieldError({ field: 'name', message: t('Enter a name between 2 and 50 characters and your password.') });
      return;
    }
    if ((mode === 'register' || mode === 'recover' || mode === 'recovery-sent')
      && !isValidEmail(email)) {
      setFieldError({ field: 'email', message: t('Enter a valid email address.') });
      return;
    }
    if (password.length > 128) {
      setFieldError({ field: 'password', message: t('Password must be 128 characters or fewer.') });
      return;
    }
    if (confirmPassword.length > 128) {
      setFieldError({ field: 'confirmPassword', message: t('Password must be 128 characters or fewer.') });
      return;
    }
    if (mode === 'register' || mode === 'update-password') {
      if (password.length < 6) {
        setFieldError({ field: 'password', message: t('Your password must be at least 6 characters.') });
        return;
      }
      if (password !== confirmPassword) {
        setFieldError({ field: 'confirmPassword', message: t('Passwords do not match.') });
        return;
      }
    } else if (mode === 'login' && !password) {
      setFieldError({ field: 'password', message: t('Enter a name between 2 and 50 characters and your password.') });
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'register') {
        const { data, error: registrationError } = await supabase.functions.invoke('register-username', {
          body: {
            username,
            name: name.trim().replace(/\s+/g, ' '),
            email: email.trim().toLowerCase(),
            password,
            redirectTo: getAuthRedirectTo(),
          },
        });
        if (registrationError) {
          const { message: registrationMessage, status: registrationStatus } = await getFunctionError(registrationError);
          const errorMessage = registrationMessage.toLowerCase();
          setError(registrationStatus === 404
            ? t('Username registration is not deployed yet. Apply the database migrations and deploy the register-username function.')
            : errorMessage.includes('email or name is already in use')
              ? t('That email or name is already in use.')
              : errorMessage.includes('already in use')
            ? t('That name is already in use. Choose another name.')
            : errorMessage.includes('rate limit')
              ? t('Too many registration attempts. Please wait before trying again.')
                : registrationMessage);
          return;
        }
        const sessionTokens = getSessionTokens(data);
        if (!sessionTokens) {
          setError(t('Sign-up did not create a session. Check the Supabase email-confirmation setting and try again.'));
          return;
        }
        const { error: sessionError } = await supabase.auth.setSession(sessionTokens);
        if (sessionError) setError(sessionError.message);
      } else if (mode === 'login') {
        const { data, error: loginError } = await supabase.functions.invoke('username-login', {
          body: { username, password },
        });
        if (loginError) {
          const result = await getFunctionError(loginError);
          setError(result.status === 404
            ? t('Username sign-in is not deployed yet. Deploy the username-login function.')
            : result.status === 401
              ? t('Invalid name or password. If this account was created with Google, choose Continue with Google.')
              : t(result.message));
          return;
        }
        const sessionTokens = getSessionTokens(data);
        if (!sessionTokens) {
          setError(t('Unable to authenticate. Please try again.'));
          return;
        }
        const { error: sessionError } = await supabase.auth.setSession(sessionTokens);
        if (sessionError) setError(sessionError.message);
      } else if (mode === 'recover' || mode === 'recovery-sent') {
        const { error: recoveryError } = await supabase.functions.invoke('request-username-password-reset', {
          body: { email: email.trim().toLowerCase(), redirectTo: getAuthRedirectTo() },
        });
        if (recoveryError) {
          const result = await getFunctionError(recoveryError, false);
          if (result.message === 'Enter your sign-in name.') {
            const { error: directRecoveryError } = await supabase.auth.resetPasswordForEmail(
              email.trim().toLowerCase(),
              { redirectTo: getAuthRedirectTo() },
            );
            if (directRecoveryError) {
              const cooldownSeconds = directRecoveryError.message.match(/after\s+(\d+)\s+seconds?/i)?.[1];
              if (cooldownSeconds) {
                showRecoverySent(Number(cooldownSeconds));
                return;
              }
              console.error('Direct Supabase password recovery failed:', directRecoveryError.message);
              setError(t('Could not send a reset email. Please try again later.'));
              return;
            }
            showRecoverySent();
            return;
          }
          console.error('Password recovery Edge Function failed:', {
            functionError: recoveryError.name,
            status: result.status,
            message: result.message,
          });
          if (result.status === 429) {
            showRecoverySent();
            return;
          }
          setError(result.status === 404
            ? t('Password recovery is not deployed yet. Deploy the request-username-password-reset function.')
            : t(result.message));
          return;
        }
        showRecoverySent();
      } else {
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) {
          setError(updateError.message);
          return;
        }
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (signOutError) {
          setError(signOutError.message);
          return;
        }
        recoveryFlow.current = false;
        setMode('login');
        setPassword('');
        setConfirmPassword('');
        setMessage(t('Your password has been updated. Sign in with your name and new password.'));
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : t('Unable to authenticate. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const isRecoveryMode = mode === 'recover' || mode === 'recovery-sent' || mode === 'update-password';
  const visibleError = error || (isRecoveryMode && getRecoveryLinkTokens(linkingUrl)?.invalid
    ? t('This password reset link is invalid or expired. Request a new one.')
    : '');

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
      <View style={[styles.content, getLayoutDirectionStyle(isRTL)]}>
        <Pressable
          accessibilityLabel={language === 'en' ? 'Switch language to Urdu' : 'Switch language to English'}
          accessibilityRole="button"
          onPress={toggleLanguage}
          style={[styles.languageButton, { alignSelf: isRTL ? 'flex-start' : 'flex-end' }]}
        >
          <Text style={styles.languageButtonText}>{language === 'en' ? 'اردو' : 'English'}</Text>
        </Pressable>
        <Image accessibilityLabel="Fixhub logo" source={require('../../assets/Gemini_Generated_Image_f2lm3nf2lm3nf2lm.jpg')} style={styles.brandImage} />
        <Text style={[styles.brand, isRTL && styles.rtlText]}>
          <Text style={styles.fixBrand}>Fix</Text>
          <Text style={styles.hubBrand}>hub</Text>
        </Text>
        <Text style={[styles.tagline, isRTL && styles.rtlText]}>{t('Good work. Close to home.')}</Text>
        <Text style={[styles.taglineUrdu, isRTL && styles.rtlText]}>آپ کے قریب کام کرنے والے لوگ</Text>

        <View style={styles.form}>
          <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{t('WELCOME')}</Text>
          <Text style={[styles.title, isRTL && styles.rtlText]}>
            {selectAccount ? t('Add another account')
              : mode === 'register' ? t('Create your account')
                : mode === 'recovery-sent' ? t('Check your email')
                  : mode === 'recover' ? t('Reset your password')
                  : mode === 'update-password' ? t('Choose a new password')
                    : t('Find the right help')}
          </Text>
          <Text style={[styles.description, isRTL && styles.rtlText]}>
            {selectAccount
              ? t('Sign in or create an account to add it to your saved accounts.')
              : mode === 'register'
                ? t('Create an account to find or offer local services.')
                : mode === 'recovery-sent'
                  ? `${t('If an account exists for this email, a password reset link may have been sent to:')}\n${email.trim()}\n${t('Check your inbox and spam folder. Use the newest reset link.')}`
                : mode === 'recover'
                  ? t('Enter the email address linked to your account and we will send a password reset link.')
                  : mode === 'update-password'
                    ? t('Enter and confirm your new password.')
                    : t('Sign in to find or offer local services.')}
          </Text>

          {mode !== 'update-password' && mode !== 'recover' && mode !== 'recovery-sent' ? (
            <>
              <TextInput
                accessibilityLabel={t('Your name')}
                autoCapitalize="none"
                autoComplete="username"
                maxLength={50}
                onChangeText={(value) => {
                  setName(filterTextInput(value, 50));
                  if (fieldError?.field === 'name') setFieldError(null);
                }}
                placeholder={t('Your name')}
                placeholderTextColor={colors.muted}
                style={[styles.input, isRTL && styles.rtlInput]}
                textContentType="username"
                value={name}
              />
              <FieldError message={fieldError?.field === 'name' ? fieldError.message : undefined} />
            </>
          ) : null}
          {mode === 'register' ? (
            <Text style={[styles.inputHint, isRTL && styles.rtlText]}>
              {t('Your name is for sign-in. Use an email you can access for account recovery.')}
            </Text>
          ) : null}
          {mode === 'recover' ? (
            <>
              <TextInput
                accessibilityLabel={t('Email address')}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                maxLength={254}
                onChangeText={(value) => {
                  setEmail(filterTextInput(value, 254));
                  if (fieldError?.field === 'email') setFieldError(null);
                }}
                placeholder={t('Email address')}
                placeholderTextColor={colors.muted}
                style={[styles.input, isRTL && styles.rtlInput]}
                textContentType="emailAddress"
                value={email}
              />
              <FieldError message={fieldError?.field === 'email' ? fieldError.message : undefined} />
            </>
          ) : null}
          {mode === 'register' ? (
            <>
              <TextInput
                accessibilityLabel={t('Recovery email')}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                maxLength={254}
                onChangeText={(value) => {
                  setEmail(filterTextInput(value, 254));
                  if (fieldError?.field === 'email') setFieldError(null);
                }}
                placeholder={t('Recovery email')}
                placeholderTextColor={colors.muted}
                style={[styles.input, isRTL && styles.rtlInput]}
                textContentType="emailAddress"
                value={email}
              />
              <FieldError message={fieldError?.field === 'email' ? fieldError.message : undefined} />
            </>
          ) : null}
          {mode !== 'recover' && mode !== 'recovery-sent' ? (
            <>
              <TextInput
                accessibilityLabel={mode === 'update-password' ? t('New password') : t('Password')}
                autoCapitalize="none"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                maxLength={128}
                onChangeText={(value) => {
                  setPassword(value);
                  if (fieldError?.field === 'password') setFieldError(null);
                }}
                placeholder={mode === 'update-password' ? t('New password') : t('Password')}
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={[styles.input, isRTL && styles.rtlInput]}
                textContentType={mode === 'login' ? 'password' : 'newPassword'}
                value={password}
              />
              <FieldError message={fieldError?.field === 'password' ? fieldError.message : undefined} />
            </>
          ) : null}
          {mode === 'login' && !selectAccount ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setMode('recover');
                setError('');
                setMessage('');
              }}
              style={[styles.forgotPasswordLink, isRTL && styles.forgotPasswordLinkRTL]}
            >
              <Text style={styles.forgotPasswordText}>{t('Forgot password?')}</Text>
            </Pressable>
          ) : null}
          {mode === 'register' || mode === 'update-password' ? (
            <>
              <TextInput
                accessibilityLabel={t('Confirm password')}
                autoCapitalize="none"
                autoComplete="new-password"
                maxLength={128}
                onChangeText={(value) => {
                  setConfirmPassword(value);
                  if (fieldError?.field === 'confirmPassword') setFieldError(null);
                }}
                placeholder={t('Confirm password')}
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={[styles.input, isRTL && styles.rtlInput]}
                textContentType="newPassword"
                value={confirmPassword}
              />
              <FieldError message={fieldError?.field === 'confirmPassword' ? fieldError.message : undefined} />
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !supabase || (mode === 'recovery-sent' && recoveryRetrySeconds > 0)}
            onPress={() => void submitCredentials()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              (busy || (mode === 'recovery-sent' && recoveryRetrySeconds > 0)) && styles.disabled,
            ]}
          >
            {busy ? <ActivityIndicator color={colors.buttonText} /> : (
              <Text style={styles.primaryButtonText}>
                {mode === 'register' ? t('Create account')
                  : mode === 'recover' ? t('Send reset link')
                    : mode === 'recovery-sent'
                      ? recoveryRetrySeconds > 0
                        ? `${t('Resend reset link in')} ${Math.floor(recoveryRetrySeconds / 60)}:${String(recoveryRetrySeconds % 60).padStart(2, '0')}`
                        : t('Resend reset link')
                    : mode === 'update-password' ? t('Update password')
                      : t('Sign in')}
              </Text>
            )}
          </Pressable>

          {mode === 'login' || mode === 'register' ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
                setMessage('');
              }}
              style={styles.modeToggle}
            >
              <Text style={[styles.modeToggleText, isRTL && styles.rtlText]}>
                {mode === 'register' ? t('Already have an account? Sign in') : t('New here? Create an account')}
              </Text>
            </Pressable>
          ) : null}
          {mode === 'recover' || mode === 'recovery-sent' || mode === 'update-password' ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                recoveryFlow.current = false;
                setMode('login');
                setError('');
                setMessage('');
                setRecoveryRetryAt(null);
              }}
              style={styles.modeToggle}
            >
              <Text style={[styles.modeToggleText, isRTL && styles.rtlText]}>{t('Back to sign in')}</Text>
            </Pressable>
          ) : null}

          {mode === 'login' || mode === 'register' ? (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.orText}>{t('OR')}</Text>
                <View style={styles.divider} />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={busy || !supabase}
                onPress={() => void signInWithGoogle()}
                style={({ pressed }) => [styles.googleButton, pressed && styles.pressed, busy && styles.disabled]}
              >
                {busy ? <ActivityIndicator color={colors.buttonText} /> : (
                  <>
                    <Text style={styles.googleIcon}>G</Text>
                    <Text style={styles.googleButtonText}>{t('Continue with Google')}</Text>
                  </>
                )}
              </Pressable>
            </>
          ) : null}

          {mode === 'login' || mode === 'register' ? (
            <View style={[styles.legalLinks, isRTL && styles.legalLinksRtl]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/terms')}
                style={styles.legalLink}
              >
                <Text style={styles.legalLinkText}>{t('Terms and Conditions')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/privacy')}
                style={styles.legalLink}
              >
                <Text style={styles.legalLinkText}>{t('Privacy Policy')}</Text>
              </Pressable>
            </View>
          ) : null}

          {visibleError ? <Text accessibilityRole="alert" style={styles.error}>{visibleError}</Text> : null}
          {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
          {selectAccount && onCancel ? (
            <Pressable onPress={onCancel} style={styles.demoButton}>
              <Text style={styles.demoButtonText}>{t('Back to profile')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, justifyContent: 'center' },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  content: { paddingHorizontal: 24, paddingVertical: 28, width: '100%', maxWidth: 520, alignSelf: 'center' },
  languageButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 999, minHeight: 34, minWidth: 66, justifyContent: 'center', alignItems: 'center', marginBottom: 8, paddingHorizontal: 10 },
  languageButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  rtlText: { textAlign: 'right' },
  rtlInput: { textAlign: 'right' },
  brandImage: { width: 76, height: 76, borderRadius: 14, backgroundColor: colors.white },
  brand: { fontWeight: '900', fontSize: 25, marginTop: 16, letterSpacing: -0.5 },
  fixBrand: { color: '#B5AA91' },
  hubBrand: { color: '#7A283F' },
  tagline: { color: colors.muted, fontSize: 14, marginTop: 5 },
  taglineUrdu: { color: colors.green, fontSize: 14, marginTop: 4 },
  form: { backgroundColor: colors.white, borderRadius: 24, padding: 22, marginTop: 34, borderWidth: 1, borderColor: colors.line },
  eyebrow: { color: colors.green, letterSpacing: 1.8, fontWeight: '800', fontSize: 10 },
  title: { color: colors.ink, fontSize: 23, fontWeight: '900', marginTop: 11 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 19 },
  input: { height: 48, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, color: colors.ink, fontSize: 13, marginBottom: 10 },
  inputHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: -4, marginBottom: 10 },
  forgotPasswordLink: { alignSelf: 'flex-end', paddingVertical: 8, marginTop: -6, marginBottom: 4 },
  forgotPasswordLinkRTL: { alignSelf: 'flex-start' },
  forgotPasswordText: { color: colors.green, fontWeight: '700', fontSize: 13, textDecorationLine: 'underline' },
  primaryButton: { height: 50, backgroundColor: colors.green, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  primaryButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 14 },
  modeToggle: { alignItems: 'center', paddingVertical: 13 },
  modeToggleText: { color: colors.green, fontWeight: '700', fontSize: 12 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  divider: { height: 1, backgroundColor: colors.line, flex: 1 },
  orText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  googleButton: { height: 52, backgroundColor: colors.green, borderColor: colors.green, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  googleIcon: { color: '#4285F4', fontSize: 18, fontWeight: '900' },
  googleButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 14 },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  legalLinksRtl: { flexDirection: 'row-reverse' },
  legalLink: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, minHeight: 42, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  legalLinkText: { color: colors.buttonText, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.55 },
  error: { color: colors.coral, fontSize: 12, marginTop: 8 },
  message: { color: colors.green, fontSize: 12, lineHeight: 18, marginTop: 8 },
  demoButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 14, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  demoButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 13 },
});
