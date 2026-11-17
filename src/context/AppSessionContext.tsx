import { AppState, Platform } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { supabase } from '../lib/supabase';
import { signOutFromGoogle } from '../lib/googleSignIn';
import { syncPushToken, unregisterPushToken } from '../lib/pushNotifications';
import {
  getSavedAccountRefreshToken,
  loadSavedAccounts,
  removeSavedAccount,
  saveSessionAccount,
  type SavedAccount,
} from '../lib/savedAccounts';
import type { Profile, ProviderAvailability, ProviderStatusSyncState, UserRole } from '../types';

type PendingProviderStatus = {
  id: string;
  profileId: string;
  providerProfileId: string;
  availabilityStatus: ProviderAvailability;
  updatedAt: string;
};

type AppSessionContextValue = {
  session: Session | null;
  profile: Profile | null;
  providerProfileReady: boolean;
  activeProfile: Profile | null;
  demoMode: boolean;
  demoRole: UserRole;
  authLoading: boolean;
  profileLoading: boolean;
  profileError: string;
  savedAccounts: SavedAccount[];
  accountsLoading: boolean;
  accountsError: string;
  pendingProviderStatus: PendingProviderStatus | null;
  providerStatusSyncState: ProviderStatusSyncState;
  providerStatusSyncError: string;
  providerStatusSyncedAt: number | null;
  startDemo: () => void;
  setDemoRole: (role: UserRole) => void;
  loadProfile: () => Promise<string | null>;
  signOut: () => Promise<string | null>;
  addAccount: () => Promise<string | null>;
  switchAccount: (id: string) => Promise<string | null>;
  queueProviderAvailability: (providerProfileId: string, availabilityStatus: ProviderAvailability) => Promise<string | null>;
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export const savedAccountSignInRequired = 'This saved account needs Google sign-in again.';
const providerStatusQueueKey = (profileId: string) => `@fixhub/provider-status-queue/${profileId}`;
const profileCacheKey = (profileId: string) => `@fixhub/profile-cache/${profileId}`;

type CachedProfileState = {
  profile: Profile;
  providerProfileReady: boolean;
};

function isCachedProfileState(value: unknown, userId: string): value is CachedProfileState {
  if (!value || typeof value !== 'object' || !('profile' in value) || !('providerProfileReady' in value)) return false;
  const cached = value as Partial<CachedProfileState>;
  const profile = cached.profile;
  return typeof cached.providerProfileReady === 'boolean'
    && Boolean(profile && profile.id === userId
      && (profile.role === 'provider' || profile.role === 'taker' || profile.role === 'business_owner' || profile.role === 'admin')
      && typeof profile.name === 'string');
}

async function loadCachedProfile(userId: string) {
  const storedValue = await AsyncStorage.getItem(profileCacheKey(userId));
  if (!storedValue) return null;
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!isCachedProfileState(parsed, userId)) {
      console.warn('Ignoring invalid cached profile data for offline use.');
      return null;
    }
    return parsed;
  } catch (parseError) {
    console.warn('Unable to parse cached profile data for offline use:', parseError);
    return null;
  }
}

function isPendingProviderStatus(value: unknown): value is PendingProviderStatus {
  if (!value || typeof value !== 'object') return false;
  const pending = value as Partial<PendingProviderStatus>;
  return typeof pending.id === 'string'
    && typeof pending.profileId === 'string'
    && typeof pending.providerProfileId === 'string'
    && (pending.availabilityStatus === 'active' || pending.availabilityStatus === 'busy' || pending.availabilityStatus === 'inactive')
    && typeof pending.updatedAt === 'string';
}

function hasInternetConnection(state: Network.NetworkState) {
  return state.isConnected === true && state.isInternetReachable !== false;
}

async function fetchProfile(userId: string): Promise<{
  profile: Profile | null;
  providerProfileReady: boolean;
  error: string | null;
}> {
  if (!supabase) return { profile: null, providerProfileReady: false, error: 'Supabase is not configured.' };
  const { data, error } = await supabase
    .from('profiles')
    .select('id,role,name,avatar_url,phone')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    const cached = await loadCachedProfile(userId);
    return cached
      ? { ...cached, profile: { ...cached.profile, isOfflineCached: true }, error: null }
      : { profile: null, providerProfileReady: false, error: error.message };
  }
  if (!data) {
    return {
      profile: null,
      providerProfileReady: false,
      error: 'Your account profile was not created. Apply the Supabase database migration, then try again.',
    };
  }
  const role: UserRole | null = data.role === 'provider'
    || data.role === 'taker'
    || data.role === 'business_owner'
    || data.role === 'admin'
    ? data.role
    : null;
  let providerProfileReady = role !== 'provider';
  let providerVerificationStatus: Profile['providerVerificationStatus'] = null;
  let providerProfile: Profile['providerProfile'] = null;
  if (role === 'provider') {
    const { data: provider, error: providerError } = await supabase
      .from('provider_profiles')
      .select('id,category,experience_years,service_radius_km,verification_status,is_active,availability_status,lat,lng')
      .eq('profile_id', userId)
      .maybeSingle();
    if (providerError) {
      const cached = await loadCachedProfile(userId);
      return cached
        ? { ...cached, profile: { ...cached.profile, isOfflineCached: true }, error: null }
        : { profile: null, providerProfileReady: false, error: providerError.message };
    }
    providerVerificationStatus = provider?.verification_status ?? null;
    providerProfile = provider ? {
      id: provider.id,
      isActive: provider.is_active,
      availabilityStatus: provider.availability_status,
      verificationStatus: provider.verification_status,
      category: provider.category,
      latitude: provider.lat,
      longitude: provider.lng,
    } : null;
    providerProfileReady = Boolean(
      provider
      && typeof data.name === 'string'
      && data.name.trim().length >= 2
      && typeof provider.category === 'string'
      && provider.category.trim().length >= 2
      && Number.isInteger(provider.experience_years)
      && provider.experience_years >= 0
      && Number(provider.service_radius_km) > 0,
    );
  }
  const cachedState: CachedProfileState = {
    profile: {
      id: data.id,
      role,
      name: data.name,
      avatar_url: data.avatar_url,
      phone: data.phone,
      providerVerificationStatus,
      providerProfile,
    },
    providerProfileReady,
  };
  try {
    await AsyncStorage.setItem(profileCacheKey(userId), JSON.stringify(cachedState));
  } catch (cacheError) {
    console.warn('Unable to cache profile data for offline access:', cacheError);
  }
  return { ...cachedState, error: null };
}

export function AppSessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [providerProfileReady, setProviderProfileReady] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoRole, setDemoRole] = useState<UserRole>('taker');
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(Boolean(supabase));
  const [accountsError, setAccountsError] = useState('');
  const [pendingProviderStatus, setPendingProviderStatus] = useState<PendingProviderStatus | null>(null);
  const [providerStatusSyncState, setProviderStatusSyncState] = useState<ProviderStatusSyncState>('idle');
  const [providerStatusSyncError, setProviderStatusSyncError] = useState('');
  const [providerStatusSyncedAt, setProviderStatusSyncedAt] = useState<number | null>(null);
  const activeUserId = useRef<string | null>(null);
  const statusRequestCounter = useRef(0);
  const statusSyncLock = useRef(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const client = supabase;
    function reloadAccounts() {
      void loadSavedAccounts().then((accounts) => {
        if (!active) return;
        setSavedAccounts(accounts);
        setAccountsError('');
        setAccountsLoading(false);
      }).catch((error: unknown) => {
        if (!active) return;
        setAccountsError(error instanceof Error ? error.message : 'Unable to load saved accounts.');
        setAccountsLoading(false);
      });
    }
    function persistAccount(nextSession: Session | null) {
      if (!nextSession) return;
      void saveSessionAccount(nextSession).then(reloadAccounts).catch((error: unknown) => {
        if (!active) return;
        setAccountsError(error instanceof Error ? error.message : 'Unable to save this account.');
      });
    }
    function applySession(nextSession: Session | null) {
      const nextUserId = nextSession?.user.id ?? null;
      if (activeUserId.current !== nextUserId) {
        activeUserId.current = nextUserId;
        setProfileLoading(Boolean(nextSession));
        setProfileError('');
        setProfile(null);
        setProviderProfileReady(false);
        setPendingProviderStatus(null);
        setProviderStatusSyncState('idle');
        setProviderStatusSyncError('');
        setProviderStatusSyncedAt(null);
      }
      setSession(nextSession);
      setAuthLoading(false);
      persistAccount(nextSession);
    }
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      applySession(nextSession);
    });
    reloadAccounts();
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setProfileError(error.message);
      applySession(data.session);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!session || !supabase) return 'You are not signed in.';
    let result: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      result = await fetchProfile(session.user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load your profile.';
      setProfileLoading(false);
      setProfileError(message);
      setProfile(null);
      setProviderProfileReady(false);
      return message;
    }
    setProfileLoading(false);
    if (result.error) {
      setProfileError(result.error);
      setProfile(null);
      setProviderProfileReady(false);
      return result.error;
    }
    setProfileError('');
    setProfile(result.profile);
    setProviderProfileReady(result.providerProfileReady);
    return null;
  }, [session]);

  const syncPendingProviderStatus = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId || !supabase || statusSyncLock.current) return;

    let networkState: Network.NetworkState;
    try {
      networkState = await Network.getNetworkStateAsync();
    } catch (networkError) {
      setProviderStatusSyncError(networkError instanceof Error ? networkError.message : 'Unable to check internet connectivity.');
      return;
    }
    if (!hasInternetConnection(networkState)) {
      setProviderStatusSyncState('pending');
      return;
    }

    statusSyncLock.current = true;
    try {
      for (;;) {
        const storedValue = await AsyncStorage.getItem(providerStatusQueueKey(userId));
        if (!storedValue) {
          setPendingProviderStatus(null);
          setProviderStatusSyncState('idle');
          setProviderStatusSyncError('');
          return;
        }

        const parsed: unknown = JSON.parse(storedValue);
        if (!isPendingProviderStatus(parsed) || parsed.profileId !== userId) {
          throw new Error('The saved provider status update is invalid. Clear app storage or contact support.');
        }

        setPendingProviderStatus(parsed);
        setProviderStatusSyncState('syncing');
        setProviderStatusSyncError('');
        const { error: syncError } = await supabase.rpc('sync_provider_availability', {
          target_provider_profile_id: parsed.providerProfileId,
          target_availability_status: parsed.availabilityStatus,
        });
        if (syncError) throw syncError;

        const latestValue = await AsyncStorage.getItem(providerStatusQueueKey(userId));
        if (latestValue !== storedValue) continue;

        await AsyncStorage.removeItem(providerStatusQueueKey(userId));
        setPendingProviderStatus(null);
        setProviderStatusSyncState('synced');
        setProviderStatusSyncedAt(Date.now());
        return;
      }
    } catch (syncError) {
      const errorMessage = syncError instanceof Error ? syncError.message : 'Unable to synchronize your provider status.';
      setProviderStatusSyncError(errorMessage);
      setProviderStatusSyncState('error');
    } finally {
      statusSyncLock.current = false;
    }
  }, [session]);

  const queueProviderAvailability = useCallback(async (
    providerProfileId: string,
    availabilityStatus: ProviderAvailability,
  ) => {
    const userId = session?.user.id;
    if (!userId) return 'You are not signed in.';
    const pending: PendingProviderStatus = {
      id: `${Date.now()}-${statusRequestCounter.current += 1}`,
      profileId: userId,
      providerProfileId,
      availabilityStatus,
      updatedAt: new Date().toISOString(),
    };
    try {
      await AsyncStorage.setItem(providerStatusQueueKey(userId), JSON.stringify(pending));
    } catch (storageError) {
      return storageError instanceof Error ? storageError.message : 'Unable to save the provider status on this device.';
    }
    setPendingProviderStatus(pending);
    setProviderStatusSyncState('pending');
    setProviderStatusSyncError('');
    await syncPendingProviderStatus();
    return null;
  }, [session, syncPendingProviderStatus]);

  useEffect(() => {
    if (!session || profile?.id !== session.user.id || profile.role !== 'provider' || !supabase) {
      return;
    }
    const userId = session.user.id;
    const client = supabase;
    let active = true;
    let providerProfileId = '';
    let heartbeatInFlight = false;

    async function loadPendingStatus() {
      const storedValue = await AsyncStorage.getItem(providerStatusQueueKey(userId));
      if (!active) return;
      if (!storedValue) {
        setPendingProviderStatus(null);
        setProviderStatusSyncState('idle');
        return;
      }
      const parsed: unknown = JSON.parse(storedValue);
      if (!isPendingProviderStatus(parsed) || parsed.profileId !== userId) {
        throw new Error('The saved provider status update is invalid. Clear app storage or contact support.');
      }
      setPendingProviderStatus(parsed);
      setProviderStatusSyncState('pending');
    }

    async function sendPresence() {
      if (!active || heartbeatInFlight) return;
      heartbeatInFlight = true;
      try {
        const networkState = await Network.getNetworkStateAsync();
        if (!hasInternetConnection(networkState)) return;
        if (!providerProfileId) {
          const { data, error: providerError } = await client
            .from('provider_profiles')
            .select('id')
            .eq('profile_id', userId)
            .maybeSingle();
          if (providerError) throw providerError;
          providerProfileId = data?.id ?? '';
        }
        if (!providerProfileId) return;
        const { error: presenceError } = await client.rpc('record_provider_presence', {
          target_provider_profile_id: providerProfileId,
        });
        if (presenceError) throw presenceError;
      } catch (presenceError) {
        setProviderStatusSyncError(presenceError instanceof Error ? presenceError.message : 'Unable to update your online status.');
      } finally {
        heartbeatInFlight = false;
      }
    }

    async function initializeSync() {
      try {
        await loadPendingStatus();
        await syncPendingProviderStatus();
        await sendPresence();
      } catch (syncError) {
        setProviderStatusSyncError(syncError instanceof Error ? syncError.message : 'Unable to prepare provider synchronization.');
        setProviderStatusSyncState('error');
      }
    }

    void initializeSync();
    const networkSubscription = Network.addNetworkStateListener((networkState) => {
      if (!hasInternetConnection(networkState)) return;
      void syncPendingProviderStatus();
      void sendPresence();
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncPendingProviderStatus();
        void sendPresence();
      }
    });
    const heartbeatInterval = setInterval(() => {
      if (AppState.currentState === 'active') void sendPresence();
    }, 60_000);

    return () => {
      active = false;
      networkSubscription.remove();
      appStateSubscription.remove();
      clearInterval(heartbeatInterval);
    };
  }, [profile, session, syncPendingProviderStatus]);

  useEffect(() => {
    if (!supabase || Platform.OS === 'web') return;
    const client = supabase;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void client.auth.startAutoRefresh();
        if (session) void loadProfile();
      }
      else void client.auth.stopAutoRefresh();
    });
    if (AppState.currentState === 'active') void client.auth.startAutoRefresh();
    return () => subscription.remove();
  }, [loadProfile, session]);

  const loadedProfileToken = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      loadedProfileToken.current = null;
      return;
    }
    // Supabase emits the session twice on startup (initial auth event plus getSession),
    // so the same token would otherwise fetch the profile twice; loadProfile() handles refreshes.
    if (loadedProfileToken.current === session.access_token) return;
    loadedProfileToken.current = session.access_token;
    let active = true;
    void fetchProfile(session.user.id).then((result) => {
      if (!active) return;
      setProfileLoading(false);
      setProfileError(result.error ?? '');
      if (result.profile) {
        setProfile(result.profile);
        setProviderProfileReady(result.providerProfileReady);
      } else if (result.error) {
        setProfile(null);
        setProviderProfileReady(false);
      }
    }).catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : 'Unable to load your profile.';
      setProfileLoading(false);
      setProfileError(message);
      setProfile(null);
      setProviderProfileReady(false);
    });
    return () => { active = false; };
  }, [session]);

  const startDemo = useCallback(() => {
    setDemoRole('taker');
    setDemoMode(true);
  }, []);

  const signOut = useCallback(async () => {
    if (demoMode) {
      setDemoMode(false);
      setProfile(null);
      return null;
    }
    if (!supabase) return null;
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) return sessionError.message;
    if (data.session) {
      try {
        await saveSessionAccount(data.session);
      } catch (error) {
        return error instanceof Error ? error.message : 'Unable to save this account before signing out.';
      }
      try {
        await unregisterPushToken(data.session.user.id);
      } catch (pushError) {
        console.warn('Unable to unregister this device for push notifications before sign-out:', pushError);
      }
    }
    try {
      await signOutFromGoogle();
    } catch (error) {
      return error instanceof Error ? error.message : 'Unable to sign out from Google.';
    }
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return error.message;
    if (data.session) {
      try {
        await removeSavedAccount(data.session.user.id);
        setSavedAccounts((accounts) => accounts.filter((account) => account.id !== data.session?.user.id));
      } catch (storageError) {
        const message = storageError instanceof Error ? storageError.message : 'Unable to remove the saved account.';
        setAccountsError(message);
        return message;
      }
    }
    return null;
  }, [demoMode]);

  const addAccount = useCallback(async () => {
    if (!supabase) return 'Supabase is not configured.';
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) return sessionError.message;
    if (data.session) {
      try {
        await saveSessionAccount(data.session);
        setSavedAccounts(await loadSavedAccounts());
        setAccountsError('');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to save this account.';
        setAccountsError(message);
        return message;
      }
    }
    return null;
  }, []);

  const switchAccount = useCallback(async (id: string) => {
    if (!supabase) return 'Supabase is not configured.';
    const { data: currentData, error: currentError } = await supabase.auth.getSession();
    if (currentError) return currentError.message;
    if (currentData.session) {
      try {
        await saveSessionAccount(currentData.session);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to save the current account.';
        setAccountsError(message);
        return message;
      }
    }
    let refreshToken: string | null;
    try {
      refreshToken = await getSavedAccountRefreshToken(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read the saved account.';
      setAccountsError(message);
      return message;
    }
    if (!refreshToken) return 'This saved account is no longer available. Sign in again to add it.';
    if (currentData.session) {
      try {
        await unregisterPushToken(currentData.session.user.id);
      } catch (pushError) {
        console.warn('Unable to unregister this device before switching accounts:', pushError);
      }
    }
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error) {
      if (currentData.session) {
        void syncPushToken(currentData.session.user.id).catch((pushError: unknown) => {
          console.warn('Unable to restore push registration for the current account:', pushError);
        });
      }
      if (error.code === 'refresh_token_not_found'
        || error.code === 'refresh_token_already_used'
        || error.code === 'session_expired') {
        return savedAccountSignInRequired;
      }
      return error.message;
    }
    if (!data.session) return 'The saved account could not be restored. Sign in again to add it.';
    try {
      await saveSessionAccount(data.session);
      setSavedAccounts(await loadSavedAccounts());
      setAccountsError('');
    } catch (storageError) {
      const message = storageError instanceof Error ? storageError.message : 'Unable to update the saved account.';
      setAccountsError(message);
      return message;
    }
    return null;
  }, []);

  const value = useMemo(() => ({
    session,
    profile,
    providerProfileReady,
    activeProfile: demoMode ? { id: 'demo-current-user', role: demoRole, name: 'Demo User' } : profile,
    demoMode,
    demoRole,
    authLoading,
    profileLoading,
    profileError,
    savedAccounts,
    accountsLoading,
    accountsError,
    pendingProviderStatus,
    providerStatusSyncState,
    providerStatusSyncError,
    providerStatusSyncedAt,
    startDemo,
    setDemoRole,
    loadProfile,
    signOut,
    addAccount,
    switchAccount,
    queueProviderAvailability,
  }), [
    session,
    profile,
    providerProfileReady,
    demoMode,
    demoRole,
    authLoading,
    profileLoading,
    profileError,
    savedAccounts,
    accountsLoading,
    accountsError,
    pendingProviderStatus,
    providerStatusSyncState,
    providerStatusSyncError,
    providerStatusSyncedAt,
    startDemo,
    loadProfile,
    signOut,
    addAccount,
    switchAccount,
    queueProviderAvailability,
  ]);

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const context = useContext(AppSessionContext);
  if (!context) throw new Error('useAppSession must be used within AppSessionProvider');
  return context;
}
