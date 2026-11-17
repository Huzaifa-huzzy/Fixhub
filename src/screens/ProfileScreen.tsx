import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Animated, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { AppIcon } from '../components/AppIcon';
import { AdminVerificationPanel } from '../components/AdminVerificationPanel';
import { FieldError } from '../components/FieldError';
import { ProviderVerificationPanel } from '../components/ProviderVerificationPanel';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { useAppSession } from '../context/AppSessionContext';
import { useLanguage } from '../context/LanguageContext';
import { filterDecimalInput, filterIntegerInput, filterTextInput, isValidDecimal, isValidEmail, isValidPakistanPhone, isValidText, toPakistanInternationalPhone, toPakistanLocalPhone } from '../lib/inputValidation';
import type { SavedAccount } from '../lib/savedAccounts';
import { supabase } from '../lib/supabase';
import { getPinnedLtrStyle } from '../lib/layoutDirection';
import { colors, radius } from '../theme';
import type { Profile, UserRole } from '../types';

type ProviderService = { id: string; task_name: string; price: number; is_starting_from: boolean; is_negotiable: boolean };
type ContactPhone = { slot: number; phone: string };
type ProviderAccount = {
  id: string;
  is_active: boolean;
  availability_status: string;
  verification_status: 'pending' | 'verified' | 'rejected';
  category: string;
  lat: number | null;
  lng: number | null;
  contact_phones: ContactPhone[];
  phone_public: boolean;
};
type LocationToast = { kind: 'success' | 'error'; message: string };

function getAuthRedirectTo() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return new URL('/auth', window.location.href).toString();
  }
  return Linking.createURL('auth');
}

const roleLabels: Record<UserRole, string> = {
  taker: 'Service taker',
  provider: 'Service provider',
  business_owner: 'Business owner',
  admin: 'Administrator',
};

export function ProfileScreen({
  profile,
  demoMode,
  onSignOut,
  onDemoRoleChange,
  onRefreshApprovalStatus,
  savedAccounts = [],
  accountsLoading = false,
  accountsError = '',
  onAddAccount,
  onSwitchAccount,
}: {
  profile: Profile;
  demoMode: boolean;
  onSignOut: () => void;
  onDemoRoleChange: (role: UserRole) => void;
  onRefreshApprovalStatus?: () => Promise<string | null>;
  savedAccounts?: SavedAccount[];
  accountsLoading?: boolean;
  accountsError?: string;
  onAddAccount?: () => Promise<string | null>;
  onSwitchAccount?: (id: string) => Promise<string | null>;
}) {
  const { t, isRTL } = useLanguage();
  const {
    pendingProviderStatus,
    providerStatusSyncError,
    providerStatusSyncState,
    providerStatusSyncedAt,
    queueProviderAvailability,
  } = useAppSession();
  const role = profile.role ?? 'taker';
  const [provider, setProvider] = useState<ProviderAccount | null>(null);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const [profileMenuMounted, setProfileMenuMounted] = useState(false);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const [providerCategoryDraft, setProviderCategoryDraft] = useState('');
  const [editingProviderCategory, setEditingProviderCategory] = useState(false);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [business, setBusiness] = useState<{ id: string; name: string } | null>(null);
  const [category, setCategory] = useState('');
  const [bio, setBio] = useState('');
  const [experience, setExperience] = useState('');
  const [serviceRadius, setServiceRadius] = useState('10');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [settingLocation, setSettingLocation] = useState(false);
  const [locationToast, setLocationToast] = useState<LocationToast | null>(null);
  const locationToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [taskName, setTaskName] = useState('');
  const [taskPrice, setTaskPrice] = useState('');
  const [taskFieldErrors, setTaskFieldErrors] = useState<{ taskName?: string; taskPrice?: string }>({});
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [negotiable, setNegotiable] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [editingPhoneSlot, setEditingPhoneSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!demoMode && Boolean(supabase));
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [message, setMessage] = useState('');
  const [accountActionError, setAccountActionError] = useState('');
  const [switchingAccountId, setSwitchingAccountId] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [usernameAccount, setUsernameAccount] = useState(false);
  const [avatarOverride, setAvatarOverride] = useState<{ profileId: string; url: string } | null>(null);
  const [nameOverride, setNameOverride] = useState<{ profileId: string; name: string } | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editedName, setEditedName] = useState(profile.name ?? '');
  const [selectedAvatar, setSelectedAvatar] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const avatarUrl = avatarOverride?.profileId === profile.id
    ? avatarOverride.url
    : profile.avatar_url ?? null;
  const profileName = nameOverride?.profileId === profile.id
    ? nameOverride.name
    : profile.name ?? '';

  function closeProfileMenu() {
    setProfileMenuVisible(false);
  }

  function openProfileDestination(path: '/my-reviews' | '/terms' | '/privacy' | '/report') {
    closeProfileMenu();
    router.push(path);
  }

  useEffect(() => {
    if (!profileMenuMounted) return;
    const animation = Animated.timing(drawerProgress, {
      toValue: profileMenuVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !profileMenuVisible) setProfileMenuMounted(false);
    });
    return () => animation.stop();
  }, [drawerProgress, profileMenuMounted, profileMenuVisible]);

  function showLocationToast(kind: LocationToast['kind'], messageText: string) {
    if (locationToastTimer.current) clearTimeout(locationToastTimer.current);
    setLocationToast({ kind, message: messageText });
    locationToastTimer.current = setTimeout(() => {
      setLocationToast(null);
      locationToastTimer.current = null;
    }, 3500);
  }

  useEffect(() => () => {
    if (locationToastTimer.current) clearTimeout(locationToastTimer.current);
  }, []);

  useEffect(() => {
    if (demoMode || !supabase) return;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const currentEmail = session?.user.email ?? '';
      setAuthEmail(currentEmail);
      setRecoveryEmail(currentEmail.endsWith('@accounts.serviceconnect.invalid') ? '' : currentEmail);
      setUsernameAccount(typeof session?.user.user_metadata.username === 'string');
    });
    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (!active) return;
      if (userError) {
        setError(userError.message);
        return;
      }
      const currentEmail = data.user?.email ?? '';
      setAuthEmail(currentEmail);
      setRecoveryEmail(currentEmail.endsWith('@accounts.serviceconnect.invalid') ? '' : currentEmail);
      setUsernameAccount(typeof data.user?.user_metadata.username === 'string');
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [demoMode, profile.id]);

  async function updateRecoveryEmail() {
    if (!supabase) return;
    setError('');
    setFieldError(null);
    const nextEmail = recoveryEmail.trim().toLowerCase();
    if (!isValidEmail(nextEmail)) {
      setFieldError({ field: 'recoveryEmail', message: 'Enter a valid email address.' });
      return;
    }
    setFieldError(null);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: updateError } = await supabase.functions.invoke('update-recovery-email', {
        body: { email: nextEmail, redirectTo: getAuthRedirectTo() },
      });
      if (updateError) {
        let updateMessage = updateError.message;
        if (updateError instanceof FunctionsHttpError && updateError.context instanceof Response) {
          try {
            const responseBody: unknown = await updateError.context.clone().json();
            if (responseBody && typeof responseBody === 'object'
              && 'error' in responseBody && typeof responseBody.error === 'string') {
              updateMessage = responseBody.error;
            }
          } catch (responseError) {
            console.error('Unable to read recovery email error response:', responseError);
          }
        }
        setError(t(updateMessage));
        return;
      }
      setMessage('Check your email and confirm the address to enable account recovery.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update your recovery email.');
    } finally {
      setBusy(false);
    }
  }

  async function switchSavedAccount(account: SavedAccount) {
    if (!onSwitchAccount) return;
    setSwitchingAccountId(account.id);
    setAccountActionError('');
    try {
      const switchError = await onSwitchAccount(account.id);
      if (switchError) setAccountActionError(switchError);
    } catch (switchError) {
      setAccountActionError(switchError instanceof Error ? switchError.message : 'Unable to switch accounts.');
    } finally {
      setSwitchingAccountId('');
    }
  }

  async function addSavedAccount() {
    if (!onAddAccount) return;
    setAddingAccount(true);
    setAccountActionError('');
    try {
      const addError = await onAddAccount();
      if (addError) setAccountActionError(addError);
    } catch (addError) {
      setAccountActionError(addError instanceof Error ? addError.message : 'Unable to add an account.');
    } finally {
      setAddingAccount(false);
    }
  }

  useEffect(() => {
    if (demoMode || !supabase) return;
    let active = true;
    async function loadRoleData() {
      setLoading(true);
      setError('');
      if (role === 'taker' || role === 'admin') {
        if (active) setLoading(false);
        return;
      }
      if (role === 'provider') {
        const { data: providerRow, error: providerError } = await supabase!
          .from('provider_profiles')
          .select('id,is_active,availability_status,verification_status,category,lat,lng,phone_public')
          .eq('profile_id', profile.id)
          .maybeSingle();
        if (providerError) {
          if (active) setError(providerError.message);
          if (active && profile.providerProfile) {
            setProvider({
              id: profile.providerProfile.id,
              is_active: profile.providerProfile.isActive,
              availability_status: profile.providerProfile.availabilityStatus,
              verification_status: profile.providerProfile.verificationStatus,
              category: profile.providerProfile.category,
              lat: profile.providerProfile.latitude,
              lng: profile.providerProfile.longitude,
              contact_phones: [],
              phone_public: false,
            });
            setProviderCategoryDraft(profile.providerProfile.category);
          }
          if (active) setLoading(false);
          return;
        }
        if (!active) return;
        if (providerRow) {
          const { data: contactRow, error: contactError } = await supabase!
            .from('provider_contact_phones')
            .select('slot,phone')
            .eq('provider_id', providerRow.id)
            .order('slot');
          if (contactError) {
            if (active) setError(contactError.message);
            if (active) setLoading(false);
            return;
          }
          const providerWithContact = { ...providerRow, contact_phones: contactRow ?? [] };
          setProvider(providerWithContact);
          setProviderCategoryDraft(providerRow.category);
          const { data: serviceRows, error: serviceError } = await supabase!
            .from('provider_services')
            .select('id,task_name,price,is_starting_from,is_negotiable')
            .eq('provider_id', providerRow.id)
            .order('created_at', { ascending: false });
          if (serviceError) setError(serviceError.message);
          else setServices(serviceRows ?? []);
        } else setProvider(null);
      } else {
        const { data: businessRow, error: businessError } = await supabase!
          .from('businesses')
          .select('id,name')
          .eq('owner_id', profile.id)
          .maybeSingle();
        if (businessError) setError(businessError.message);
        else if (active) setBusiness(businessRow);
      }
      if (active) setLoading(false);
    }
    void loadRoleData();
    return () => { active = false; };
  }, [demoMode, profile.id, profile.providerProfile, role, t]);

  async function chooseProfilePhoto() {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) {
        setError(t('No image was selected. Please try again.'));
        return;
      }
      if (asset.fileSize != null && asset.fileSize > 5 * 1024 * 1024) {
        setError(t('Choose an image smaller than 5 MB.'));
        return;
      }

      const extension = asset.fileName?.split('.').pop()?.toLowerCase();
      const mimeByExtension: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      const contentType = asset.mimeType ?? (extension ? mimeByExtension[extension] : undefined);
      if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        setError(t('Choose a JPEG, PNG, or WebP image.'));
        return;
      }

      setSelectedAvatar(asset);
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : t('Unable to choose a profile photo.'));
    }
  }

  async function saveProfile() {
    if (!supabase) {
      setError(t('Supabase is not configured.'));
      return;
    }
    const nextName = filterTextInput(editedName, 50).trim();
    if (!isValidText(nextName, 2, 50)) {
      setFieldError({ field: 'profileName', message: t('Your name must be between 2 and 50 characters.') });
      return;
    }

    setFieldError(null);
    setError('');
    setMessage('');
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      let nextAvatarUrl: string | null = null;
      if (selectedAvatar) {
        const extension = selectedAvatar.fileName?.split('.').pop()?.toLowerCase();
        const mimeByExtension: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        const contentType = selectedAvatar.mimeType ?? (extension ? mimeByExtension[extension] : undefined);
        if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
          throw new Error(t('Choose a JPEG, PNG, or WebP image.'));
        }
        const response = await fetch(selectedAvatar.uri);
        if (!response.ok) throw new Error(t('Unable to read the selected image. Please try another photo.'));
        const imageData = await response.arrayBuffer();
        const fileExtension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
        uploadedPath = `${profile.id}/profile-${Date.now()}.${fileExtension}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(uploadedPath, imageData, { contentType, upsert: false });
        if (uploadError) throw uploadError;
        const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(uploadedPath);
        nextAvatarUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ name: nextName, ...(nextAvatarUrl ? { avatar_url: nextAvatarUrl } : {}) })
        .eq('id', profile.id);
      if (profileError) {
        if (uploadedPath) {
          const { error: cleanupError } = await supabase.storage.from('avatars').remove([uploadedPath]);
          throw new Error(cleanupError
            ? `${profileError.message} Also, the uploaded image could not be cleaned up: ${cleanupError.message}`
            : profileError.message);
        }
        throw profileError;
      }

      setNameOverride({ profileId: profile.id, name: nextName });
      if (nextAvatarUrl) setAvatarOverride({ profileId: profile.id, url: nextAvatarUrl });
      setSelectedAvatar(null);
      setEditingProfile(false);

      const oldStoragePath = profile.avatar_url
        ?.split('/storage/v1/object/public/avatars/')[1]
        ?.split('?')[0];
      if (uploadedPath && oldStoragePath?.startsWith(`${profile.id}/`) && oldStoragePath !== uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from('avatars').remove([oldStoragePath]);
        if (cleanupError) {
          setMessage(`${t('Your profile was saved, but the previous photo could not be removed:')} ${cleanupError.message}`);
          return;
        }
      }
      setMessage(t('Your profile has been updated.'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('Unable to update your profile.'));
    } finally {
      setBusy(false);
    }
  }

  async function createProviderProfile() {
    if (!supabase) return;
    setError('');
    setFieldError(null);
    if (!isValidText(category, 2, 80)) {
      setFieldError({ field: 'category', message: 'Enter a service category between 2 and 80 characters.' });
      return;
    }
    if (bio.trim().length > 1000) {
      setFieldError({ field: 'bio', message: 'Your introduction must be 1000 characters or fewer.' });
      return;
    }
    setFieldError(null);
    setBusy(true);
    setError('');
    const years = Number(experience);
    if (!isValidDecimal(experience, 0, 70, 0) || !Number.isInteger(years)) {
      setBusy(false);
      setFieldError({ field: 'experience', message: 'Experience must be a whole number between 0 and 70.' });
      return;
    }
    const radiusKm = Number(serviceRadius);
    if (!isValidDecimal(serviceRadius, 0.01, 500)) {
      setBusy(false);
      setFieldError({ field: 'serviceRadius', message: 'Service radius must be greater than 0 and no more than 500 km.' });
      return;
    }
    const { data, error: createError } = await supabase
      .from('provider_profiles')
      .insert({
        profile_id: profile.id,
        category: category.trim(),
        bio: bio.trim() || null,
        experience_years: years,
        service_radius_km: radiusKm,
        lat: latitude,
        lng: longitude,
      })
      .select('id,is_active,availability_status,verification_status,category,lat,lng,phone_public')
      .single();
    setBusy(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setProvider({ ...data, contact_phones: [] });
    setMessage('Your professional profile is ready. Add your first service price below.');
  }

  async function saveProviderCategory() {
    if (!supabase || !provider) return;
    const nextCategory = filterTextInput(providerCategoryDraft, 80).trim();
    if (!isValidText(nextCategory, 2, 80)) {
      setFieldError({ field: 'providerCategory', message: t('Enter a service category between 2 and 80 characters.') });
      return;
    }

    setFieldError(null);
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const { data, error: updateError } = await supabase
        .from('provider_profiles')
        .update({ category: nextCategory })
        .eq('id', provider.id)
        .eq('profile_id', profile.id)
        .select('category')
        .single();
      if (updateError) throw updateError;

      setProvider((current) => current ? { ...current, category: data.category } : current);
      setProviderCategoryDraft(data.category);
      setEditingProviderCategory(false);
      setMessage(t('Your service category has been updated.'));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t('Unable to update your service category.'));
    } finally {
      setBusy(false);
    }
  }

  async function addService() {
    if (!supabase || !provider) return;
    setError('');
    const nextTaskName = taskName.trim();
    const nextTaskPrice = taskPrice.trim();
    const price = Number(taskPrice);
    const nextTaskFieldErrors = {
      ...(!nextTaskName
        ? { taskName: 'Task name is required.' }
        : !isValidText(nextTaskName, 1, 120)
          ? { taskName: 'Enter a task name between 1 and 120 characters.' }
          : {}),
      ...(!nextTaskPrice
        ? { taskPrice: 'Price is required.' }
        : !isValidDecimal(nextTaskPrice, 0.01, 9_999_999_999.99)
          ? { taskPrice: 'Enter a price greater than zero with no more than two decimal places.' }
          : {}),
    };
    setTaskFieldErrors(nextTaskFieldErrors);
    if (Object.keys(nextTaskFieldErrors).length > 0) {
      return;
    }
    setBusy(true);
    setError('');
    const serviceValues = {
        provider_id: provider.id,
        task_name: nextTaskName,
        price,
        is_negotiable: negotiable,
    };
    const request = editingServiceId
      ? supabase.from('provider_services')
        .update(serviceValues)
        .eq('id', editingServiceId)
        .select('id,task_name,price,is_starting_from,is_negotiable')
        .single()
      : supabase.from('provider_services')
        .insert(serviceValues)
        .select('id,task_name,price,is_starting_from,is_negotiable')
        .single();
    const { data, error: insertError } = await request;
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setServices((current) => editingServiceId
      ? current.map((service) => service.id === editingServiceId ? data : service)
      : [data, ...current]);
    setTaskName('');
    setTaskPrice('');
    setTaskFieldErrors({});
    setEditingServiceId(null);
    setNegotiable(false);
    setMessage('Service price added.');
  }

  function editService(service: ProviderService) {
    setEditingServiceId(service.id);
    setTaskName(service.task_name);
    setTaskPrice(String(service.price));
    setTaskFieldErrors({});
    setNegotiable(service.is_negotiable);
    setMessage('');
  }

  async function setProviderLocation() {
    if (settingLocation) return;
    setSettingLocation(true);
    setLocationToast(null);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (permission.status !== 'granted') {
        showLocationToast('error', t('Location permission is required to set your service location.'));
        return;
      }

      if (!(await Location.hasServicesEnabledAsync())) {
        showLocationToast('error', t('Location services are turned off. Enable GPS and try again.'));
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: true,
      });
      const nextLatitude = location.coords.latitude;
      const nextLongitude = location.coords.longitude;
      if (
        !Number.isFinite(nextLatitude)
        || !Number.isFinite(nextLongitude)
        || nextLatitude < -90
        || nextLatitude > 90
        || nextLongitude < -180
        || nextLongitude > 180
      ) {
        showLocationToast('error', t('Unable to get your current location.'));
        return;
      }

      if (provider && supabase) {
        const { data, error: updateError } = await supabase
          .from('provider_profiles')
          .update({ lat: nextLatitude, lng: nextLongitude })
          .eq('id', provider.id)
          .select('id')
          .maybeSingle();
        if (updateError) {
          showLocationToast('error', updateError.message);
          return;
        }
        if (!data) {
          showLocationToast('error', t('Unable to save your service location. Please try again.'));
          return;
        }
        setProvider({
          ...provider,
          lat: nextLatitude,
          lng: nextLongitude,
        });
      } else if (provider) {
        showLocationToast('error', t('Unable to save your service location. Please try again.'));
        return;
      }
      setLatitude(nextLatitude);
      setLongitude(nextLongitude);
      showLocationToast(
        'success',
        provider
          ? t('Location updated successfully!')
          : t('Location detected. It will be saved when you create your provider profile.'),
      );
    } catch (locationError) {
      showLocationToast(
        'error',
        locationError instanceof Error
          ? locationError.message
          : t('Unable to get your current location.'),
      );
    } finally {
      setSettingLocation(false);
    }
  }

  async function removeService(serviceId: string) {
    if (!supabase) return;
    const { error: deleteError } = await supabase.from('provider_services').delete().eq('id', serviceId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setServices((current) => current.filter((service) => service.id !== serviceId));
  }

  async function setAvailability(availabilityStatus: 'active' | 'busy' | 'inactive') {
    if (!supabase || !provider || busy) return;
    setError('');
    setMessage('');
    if (availabilityStatus !== 'inactive' && provider.verification_status !== 'verified') {
      setError(t('Your CNIC must be approved before you can show that you are available.'));
      return;
    }
    setBusy(true);
    try {
      const queueError = await queueProviderAvailability(provider.id, availabilityStatus);
      if (queueError) {
        setError(queueError);
        return;
      }
      setProvider({
        ...provider,
        availability_status: availabilityStatus,
        is_active: availabilityStatus !== 'inactive',
      });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t('Unable to update your status.'));
    } finally {
      setBusy(false);
    }
  }

  async function setPhonePublic(phonePublic: boolean) {
    if (!supabase || !provider) return;
    if (phonePublic && provider.contact_phones.length === 0) {
      setError('Add your contact number before enabling direct calls.');
      return;
    }
    const { error: updateError } = await supabase
      .from('provider_profiles')
      .update({ phone_public: phonePublic })
      .eq('id', provider.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setProvider({ ...provider, phone_public: phonePublic });
  }

  async function saveContactPhone() {
    if (!supabase || !provider) return;
    setError('');
    setFieldError(null);
    const localPhone = filterIntegerInput(contactPhone.trim());
    if (!isValidPakistanPhone(localPhone)) {
      setFieldError({ field: 'contactPhone', message: 'Enter an 11-digit Pakistani mobile number starting with 0, for example 03001234567.' });
      return;
    }
    setFieldError(null);
    if (editingPhoneSlot === null && provider.contact_phones.length >= 2) {
      setError('You can add up to two contact numbers.');
      return;
    }
    const slot = editingPhoneSlot ?? (provider.contact_phones.length === 0 ? 1 : 2);
    const phone = toPakistanInternationalPhone(localPhone);
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase
      .from('provider_contact_phones')
      .upsert({ provider_id: provider.id, slot, phone });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    const contactPhones = [...provider.contact_phones.filter((item) => item.slot !== slot), { slot, phone }]
      .sort((left, right) => left.slot - right.slot);
    setProvider({ ...provider, contact_phones: contactPhones });
    setContactPhone('');
    setEditingPhoneSlot(null);
    setMessage('Contact number saved.');
  }

  async function createBusiness() {
    if (!supabase) return;
    setError('');
    setFieldError(null);
    if (!isValidText(businessName, 1, 160)) {
      setFieldError({ field: 'businessName', message: 'Business name must be between 1 and 160 characters.' });
      return;
    }
    if (!isValidText(businessCategory, 2, 100)) {
      setFieldError({ field: 'businessCategory', message: 'Business category must be between 2 and 100 characters.' });
      return;
    }
    if (!isValidText(businessAddress, 3, 300)) {
      setFieldError({ field: 'businessAddress', message: 'Business address must be between 3 and 300 characters.' });
      return;
    }
    setFieldError(null);
    setBusy(true);
    setError('');
    const { data, error: insertError } = await supabase
      .from('businesses')
      .insert({
        owner_id: profile.id,
        name: businessName.trim(),
        category: businessCategory.trim(),
        address: businessAddress.trim(),
      })
      .select('id,name')
      .single();
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setBusiness(data);
    setMessage('Your business listing has been created.');
  }

  async function toggleBusiness() {
    if (!supabase || !business) return;
    const { data, error: statusError } = await supabase
      .from('businesses')
      .select('is_active')
      .eq('id', business.id)
      .single();
    if (statusError) {
      setError(statusError.message);
      return;
    }
    const { error: updateError } = await supabase
      .from('businesses')
      .update({ is_active: !data.is_active })
      .eq('id', business.id);
    if (updateError) setError(updateError.message);
    else setMessage(data.is_active ? 'Business listing paused.' : 'Business listing is live.');
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={[styles.screen, getPinnedLtrStyle()]}
        contentContainerStyle={[styles.content, getPinnedLtrStyle()]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t('YOUR ACCOUNT')}</Text>
        <View style={[styles.headingRow, getPinnedLtrStyle()]}>
          <Text style={styles.title}>{t('Profile')}</Text>
          <Pressable
            accessibilityLabel={t('More Details')}
            accessibilityRole="button"
            accessibilityState={{ expanded: profileMenuVisible }}
            onPress={() => {
              setProfileMenuMounted(true);
              setProfileMenuVisible((visible) => !visible);
            }}
            style={styles.moreDetailsButton}
          >
            <AppIcon color={colors.buttonText} name="more" size={20} />
          </Pressable>
        </View>
      </View>
      <View style={[styles.identity, getPinnedLtrStyle()]}>
        <View style={styles.avatar}>
          {selectedAvatar || avatarUrl
            ? <Image source={{ uri: selectedAvatar?.uri ?? avatarUrl ?? undefined }} style={styles.avatarImage} />
            : <Text style={styles.avatarText}>{(profileName || 'U').slice(0, 1).toUpperCase()}</Text>}
        </View>
        <View style={styles.identityCopy}>
          <View style={styles.nameBadgeRow}>
            <Text style={styles.name}>{profileName || 'Fixhub user'}</Text>
            {role === 'provider' && provider?.verification_status === 'verified' ? <VerifiedBadge /> : null}
          </View>
          <Text style={styles.role}>{t(roleLabels[role])}</Text>
          {!demoMode ? (
            <Pressable
              accessibilityLabel={t('Edit Profile')}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setEditedName(profileName);
                setSelectedAvatar(null);
                setFieldError(null);
                setError('');
                setEditingProfile((editing) => !editing);
              }}
              style={styles.editProfileButton}
            >
              <AppIcon color={colors.buttonText} name="pencil" size={16} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {editingProfile ? (
        <View style={[styles.profileEditPanel, getPinnedLtrStyle()]}>
          <TextInput
            accessibilityLabel={t('Your name')}
            autoCapitalize="words"
            maxLength={50}
            onChangeText={(value) => {
              setEditedName(filterTextInput(value, 50));
              if (fieldError?.field === 'profileName') setFieldError(null);
            }}
            placeholder={t('Your name')}
            placeholderTextColor={colors.muted}
            style={[styles.input, isRTL && styles.rtlInput]}
            value={editedName}
          />
          <FieldError message={fieldError?.field === 'profileName' ? fieldError.message : undefined} />
          <Pressable
            accessibilityLabel={t('Edit category')}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void chooseProfilePhoto()}
            style={[styles.choosePhotoButton, busy && styles.buttonDisabled]}
          >
            <Text style={styles.secondaryText}>
              {t(selectedAvatar || avatarUrl ? 'Change profile photo' : 'Add profile photo')}
            </Text>
          </Pressable>
          {selectedAvatar ? <Text style={styles.helper}>{t('A new profile photo is selected.')}</Text> : null}
          <View style={[styles.profileEditActions, getPinnedLtrStyle()]}>
            <Pressable
              accessibilityRole="button"
              disabled={busy || !supabase}
              onPress={() => void saveProfile()}
              style={[styles.primaryButton, styles.profileEditAction, (busy || !supabase) && styles.buttonDisabled]}
            >
              {busy
                ? <ActivityIndicator color={colors.buttonText} />
                : <Text style={styles.primaryText}>{t('Save profile')}</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setEditingProfile(false);
                setSelectedAvatar(null);
                setEditedName(profileName);
                setFieldError(null);
              }}
              style={[styles.cancelProfileEdit, styles.profileEditAction]}
            >
              <Text style={styles.secondaryText}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {demoMode ? (
        <View
          style={[styles.panel, getPinnedLtrStyle()]}
        >
          <Text style={styles.panelTitle}>{t('Preview another role')}</Text>
          <Text style={styles.helper}>{t('Demo only. Connect Supabase to create a real account profile.')}</Text>
          <View style={styles.roleButtons}>
            {(['taker', 'provider', 'business_owner'] as UserRole[]).map((nextRole) => (
              <Pressable key={nextRole} onPress={() => onDemoRoleChange(nextRole)} style={[styles.roleButton, role === nextRole && styles.roleButtonSelected]}>
                <Text style={[styles.roleButtonText, role === nextRole && styles.roleButtonTextSelected]}>
                  {t(nextRole === 'taker' ? 'Taker' : nextRole === 'provider' ? 'Provider' : 'Business')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {!demoMode && onAddAccount && onSwitchAccount ? (
        <View style={[styles.panel, getPinnedLtrStyle()]}>
          <Text style={styles.panelTitle}>{t('Saved accounts')}</Text>
          <Text style={styles.helper}>{t('Switch accounts without signing in again, or add another Google account.')}</Text>
          {accountsLoading ? <ActivityIndicator color={colors.green} style={{ marginVertical: 12 }} /> : null}
          {savedAccounts.map((account) => {
            const isCurrent = account.id === profile.id;
            const isSwitching = switchingAccountId === account.id;
            return (
              <View key={account.id} style={styles.accountRow}>
                <View style={styles.accountCopy}>
                  <Text style={styles.accountName}>{account.name}{isCurrent ? t(' · Current') : ''}</Text>
                  {account.email && !account.email.endsWith('@accounts.serviceconnect.invalid')
                    ? <Text style={styles.accountEmail}>{account.email}</Text>
                    : null}
                </View>
                {!isCurrent ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={Boolean(switchingAccountId) || addingAccount}
                    onPress={() => void switchSavedAccount(account)}
                    style={[styles.accountButton, (Boolean(switchingAccountId) || addingAccount) && styles.buttonDisabled]}
                  >
                    {isSwitching
                      ? <ActivityIndicator color={colors.buttonText} size="small" />
                      : <Text style={styles.secondaryText}>{t('Switch')}</Text>}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {accountsError ? <Text accessibilityRole="alert" style={styles.error}>{accountsError}</Text> : null}
          {accountActionError ? <Text accessibilityRole="alert" style={styles.error}>{accountActionError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={addingAccount || Boolean(switchingAccountId)}
            onPress={() => void addSavedAccount()}
            style={[styles.secondaryButton, (addingAccount || Boolean(switchingAccountId)) && styles.buttonDisabled]}
          >
            {addingAccount
              ? <ActivityIndicator color={colors.buttonText} />
              : <View style={styles.buttonContent}><AppIcon color={colors.buttonText} name="plus" size={16} /><Text style={styles.secondaryText}>{t('Add another account')}</Text></View>}
          </Pressable>
        </View>
      ) : null}

      {!demoMode && usernameAccount ? (
        <View style={[styles.panel, getPinnedLtrStyle()]}>
          <Text style={styles.panelTitle}>{t('Account recovery email')}</Text>
          <Text style={styles.helper}>
            {authEmail.endsWith('@accounts.serviceconnect.invalid')
              ? t('This older account has no recovery email yet. Add and verify one to reset your password.')
              : t('A verified email lets you recover your account. Sign-in still uses your name and password.')}
          </Text>
          {authEmail && !authEmail.endsWith('@accounts.serviceconnect.invalid')
            ? <Text style={styles.accountEmail}>{authEmail}</Text>
            : null}
          <TextInput
            accessibilityLabel={t('Recovery email')}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            maxLength={254}
            onChangeText={(value) => {
              setRecoveryEmail(filterTextInput(value, 254));
              if (fieldError?.field === 'recoveryEmail') setFieldError(null);
            }}
            placeholder={t('Recovery email')}
            placeholderTextColor={colors.muted}
            style={[styles.input, isRTL && styles.rtlInput]}
            textContentType="emailAddress"
            value={recoveryEmail}
          />
          <FieldError message={fieldError?.field === 'recoveryEmail' ? fieldError.message : undefined} />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !supabase}
            onPress={() => void updateRecoveryEmail()}
            style={[styles.secondaryButton, (busy || !supabase) && styles.buttonDisabled]}
          >
            {busy
              ? <ActivityIndicator color={colors.buttonText} />
              : <Text style={styles.secondaryText}>{t('Send email verification')}</Text>}
          </Pressable>
        </View>
      ) : null}

      {loading ? <ActivityIndicator color={colors.green} style={{ marginVertical: 20 }} /> : null}
      {role === 'provider' ? (
        <View style={[styles.panel, getPinnedLtrStyle()]}>
          <Text style={styles.panelTitle}>{t('Provider profile')}</Text>
          {!provider ? (
            <>
              <Text style={styles.helper}>{t('Tell nearby customers what you do. You can update your profile later.')}</Text>
              <TextInput maxLength={80} onChangeText={(value) => { setCategory(filterTextInput(value, 80)); if (fieldError?.field === 'category') setFieldError(null); }} placeholder={t('Main category (e.g. Electrician)')} placeholderTextColor={colors.muted} style={[styles.input, isRTL && styles.rtlInput]} value={category} />
              <FieldError message={fieldError?.field === 'category' ? fieldError.message : undefined} />
              <TextInput maxLength={1000} onChangeText={(value) => { setBio(filterTextInput(value, 1000, true)); if (fieldError?.field === 'bio') setFieldError(null); }} placeholder={t('Short introduction (optional)')} placeholderTextColor={colors.muted} style={[styles.input, styles.multiline, isRTL && styles.rtlInput]} value={bio} multiline />
              <FieldError message={fieldError?.field === 'bio' ? fieldError.message : undefined} />
              <TextInput keyboardType="number-pad" maxLength={2} onChangeText={(value) => { setExperience(filterIntegerInput(value)); if (fieldError?.field === 'experience') setFieldError(null); }} placeholder={t('Years of experience')} placeholderTextColor={colors.muted} style={[styles.input, isRTL && styles.rtlInput]} value={experience} />
              <FieldError message={fieldError?.field === 'experience' ? fieldError.message : undefined} />
              <TextInput keyboardType="decimal-pad" maxLength={6} onChangeText={(value) => { setServiceRadius(filterDecimalInput(value)); if (fieldError?.field === 'serviceRadius') setFieldError(null); }} placeholder={t('Service radius in km')} placeholderTextColor={colors.muted} style={[styles.input, isRTL && styles.rtlInput]} value={serviceRadius} />
              <FieldError message={fieldError?.field === 'serviceRadius' ? fieldError.message : undefined} />
              <Pressable
                accessibilityRole="button"
                disabled={settingLocation || busy}
                onPress={() => void setProviderLocation()}
                style={[styles.locationButton, (settingLocation || busy) && styles.buttonDisabled]}
              >
                {settingLocation
                  ? <View style={styles.buttonContent}><ActivityIndicator color={colors.buttonText} size="small" /><Text style={styles.secondaryText}>{t('Getting current location…')}</Text></View>
                  : <View style={styles.buttonContent}>
                    <AppIcon color={colors.buttonText} name={latitude == null ? 'plus' : 'badgeCheck'} size={16} />
                    <Text style={styles.secondaryText}>{t(latitude == null ? 'Add service location' : 'Service location added')}</Text>
                  </View>}
              </Pressable>
              <Pressable disabled={busy || settingLocation || !supabase} onPress={() => void createProviderProfile()} style={[styles.primaryButton, (!supabase || busy || settingLocation) && styles.buttonDisabled]}>
                <Text style={styles.primaryText}>{busy ? 'Saving…' : demoMode ? 'Connect Supabase to save' : 'Create provider profile'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.providerCategoryRow}>
                <Text style={[styles.categoryText, styles.providerCategoryName]}>{t(provider.category)}</Text>
                {!editingProviderCategory ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setProviderCategoryDraft(provider.category);
                      setEditingProviderCategory(true);
                    }}
                    style={[styles.editCategoryButton, busy && styles.buttonDisabled]}
                  >
                    <AppIcon color={colors.buttonText} name="pencil" size={16} />
                  </Pressable>
                ) : null}
              </View>
              {editingProviderCategory ? (
                <>
                  <TextInput
                    accessibilityLabel={t('Main category (e.g. Electrician)')}
                    maxLength={80}
                    onChangeText={(value) => {
                      setProviderCategoryDraft(filterTextInput(value, 80));
                      if (fieldError?.field === 'providerCategory') setFieldError(null);
                    }}
                    placeholder={t('Main category (e.g. Electrician)')}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, isRTL && styles.rtlInput]}
                    value={providerCategoryDraft}
                  />
                  <FieldError message={fieldError?.field === 'providerCategory' ? fieldError.message : undefined} />
                  <View style={styles.profileEditActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void saveProviderCategory()}
                      style={[styles.primaryButton, styles.profileEditAction, busy && styles.buttonDisabled]}
                    >
                      {busy
                        ? <ActivityIndicator color={colors.buttonText} />
                        : <Text style={styles.primaryText}>{t('Save changes')}</Text>}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        setProviderCategoryDraft(provider.category);
                        setEditingProviderCategory(false);
                        setFieldError(null);
                      }}
                      style={[styles.cancelProfileEdit, styles.profileEditAction, busy && styles.buttonDisabled]}
                    >
                      <Text style={styles.secondaryText}>{t('Cancel')}</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
              <Text style={styles.helper}>{t('Set yourself available when you are ready to take a job.')}</Text>
              {provider.lat == null || provider.lng == null
                ? <Text style={styles.helper}>{t('Add a service location to appear in nearby map results.')}</Text>
                : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy || settingLocation}
                onPress={() => void setProviderLocation()}
                style={[styles.locationButton, (busy || settingLocation) && styles.buttonDisabled]}
              >
                {settingLocation
                  ? <View style={styles.buttonContent}><ActivityIndicator color={colors.buttonText} size="small" /><Text style={styles.secondaryText}>{t('Getting current location…')}</Text></View>
                  : <Text style={styles.secondaryText}>
                    {t(provider.lat == null || provider.lng == null ? 'Set service location' : 'Update service location')}
                  </Text>}
              </Pressable>
              <Text style={[styles.subsectionTitle, styles.statusHeading]}>{t('Update status')}</Text>
              {profile.isOfflineCached ? (
                <Text style={styles.helper}>{t('Showing your saved profile while offline. Status updates are stored on this device until they can sync.')}</Text>
              ) : null}
              {provider.verification_status !== 'verified'
                ? <Text style={styles.helper}>{t('Your CNIC must be approved before you can show that you are available.')}</Text>
                : provider.lat == null || provider.lng == null
                  ? <Text style={styles.helper}>{t('You can update your availability without a service location. Add one to appear in nearby map results.')}</Text>
                  : null}
              {pendingProviderStatus?.providerProfileId === provider.id && providerStatusSyncState === 'syncing' ? (
                <View style={styles.statusSyncRow}>
                  <ActivityIndicator color={colors.green} size="small" />
                  <Text style={styles.statusSyncText}>{t('Syncing your availability status…')}</Text>
                </View>
              ) : null}
              {pendingProviderStatus?.providerProfileId === provider.id && providerStatusSyncState === 'pending' ? (
                <Text style={styles.statusSyncText}>{t('Status saved on this device. It will sync when your connection is restored.')}</Text>
              ) : null}
              {providerStatusSyncState === 'synced' && providerStatusSyncedAt ? (
                <Text style={styles.statusSyncText}>{t('Your availability status has synced.')}</Text>
              ) : null}
              {providerStatusSyncError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {t('Status sync issue:')} {providerStatusSyncError}
                </Text>
              ) : null}
              <View style={styles.statusOptions}>
                {(['active', 'busy', 'inactive'] as const).map((status) => (
                  <Pressable
                    disabled={busy || (status !== 'inactive' && (
                      provider.verification_status !== 'verified'
                    ))}
                    key={status}
                    onPress={() => void setAvailability(status)}
                    style={[
                      styles.statusOption,
                      (pendingProviderStatus?.providerProfileId === provider.id
                        ? pendingProviderStatus.availabilityStatus
                        : provider.availability_status) === status && styles.statusOptionActive,
                      (busy || (status !== 'inactive' && (
                        provider.verification_status !== 'verified'
                      ))) && styles.buttonDisabled,
                    ]}
                  >
                    <Text style={[
                      styles.statusOptionText,
                      (pendingProviderStatus?.providerProfileId === provider.id
                        ? pendingProviderStatus.availabilityStatus
                        : provider.availability_status) === status && styles.statusOptionTextActive,
                    ]}>
                      {t(status === 'active' ? 'Available' : status === 'busy' ? 'Busy' : 'Unavailable')}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.providerSetting}>{t('Contact numbers')}</Text>
                  <Text style={styles.helper}>{t('Add up to two numbers customers can call. SMS verification is not required.')}</Text>
                </View>
              </View>
              {provider.contact_phones.map((item) => (
                <View key={item.slot} style={styles.contactPhoneRow}>
                  <Text style={styles.contactPhoneText}>{toPakistanLocalPhone(item.phone)}</Text>
                  <Pressable
                    accessibilityLabel={`${t('Edit')} contact number ${item.slot}`}
                    onPress={() => {
                      setEditingPhoneSlot(item.slot);
                      setContactPhone(toPakistanLocalPhone(item.phone));
                      setError('');
                      setFieldError(null);
                    }}
                    style={styles.phoneEditButton}
                  >
                    <AppIcon color={colors.buttonText} name="pencil" size={16} />
                  </Pressable>
                </View>
              ))}
              {editingPhoneSlot !== null || provider.contact_phones.length === 0 ? (
                <>
                  <TextInput
                    accessibilityLabel={t('Provider contact phone number')}
                    autoComplete="tel"
                    keyboardType="phone-pad"
                    maxLength={11}
                    onChangeText={(value) => {
                      setContactPhone(filterIntegerInput(value).slice(0, 11));
                      if (fieldError?.field === 'contactPhone') setFieldError(null);
                    }}
                    placeholder="03001234567"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, isRTL && styles.rtlInput]}
                    value={contactPhone}
                  />
                  <FieldError message={fieldError?.field === 'contactPhone' ? fieldError.message : undefined} />
                  <Pressable disabled={busy || !supabase} onPress={() => void saveContactPhone()} style={[styles.primaryButton, (busy || !supabase) && styles.buttonDisabled]}>
                    {busy ? <ActivityIndicator color={colors.buttonText} /> : <Text style={styles.primaryText}>{t('Save contact number')}</Text>}
                  </Pressable>
                  {editingPhoneSlot !== null ? (
                    <Pressable
                      onPress={() => {
                        setEditingPhoneSlot(null);
                        setContactPhone('');
                      }}
                      style={styles.cancelEdit}
                    >
                      <Text style={styles.cancelEditText}>{t('Cancel editing')}</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
              {provider.contact_phones.length > 0 && provider.contact_phones.length < 2 && editingPhoneSlot === null ? (
                <Pressable
                  onPress={() => {
                    setEditingPhoneSlot(2);
                    setContactPhone('');
                  }}
                  style={styles.locationButton}
                >
                  <View style={styles.buttonContent}>
                    <AppIcon color={colors.buttonText} name="plus" size={16} />
                    <Text style={styles.secondaryText}>{t('Add another number')}</Text>
                  </View>
                </Pressable>
              ) : null}
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.providerSetting}>{t('Allow direct calls')}</Text>
                  <Text style={styles.helper}>{t('Customers can open their phone dialer with your number when enabled.')}</Text>
                </View>
                <Switch
                  disabled={provider.contact_phones.length === 0 && !provider.phone_public}
                  onValueChange={(value) => void setPhonePublic(value)}
                  trackColor={{ true: colors.green }}
                  value={provider.phone_public}
                />
              </View>
              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>{t('Your task prices')}</Text>
                {services.map((service) => (
                  <View key={service.id} style={styles.serviceRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serviceName}>{service.task_name}</Text>
                      {service.is_starting_from || service.is_negotiable
                        ? <Text style={styles.helper}>{[service.is_starting_from ? 'Starting from' : '', service.is_negotiable ? 'Negotiable' : ''].filter(Boolean).join(' · ')}</Text>
                        : null}
                    </View>
                    <Text style={styles.servicePrice}>Rs. {Number(service.price).toLocaleString()}</Text>
                    <Pressable accessibilityLabel={`Edit ${service.task_name}`} onPress={() => editService(service)} style={styles.editButton}>
                      <AppIcon color={colors.buttonText} name="pencil" size={16} />
                    </Pressable>
                    <Pressable accessibilityLabel={`Delete ${service.task_name}`} onPress={() => void removeService(service.id)} style={styles.deleteButton}>
                      <AppIcon color={colors.buttonText} name="trash" size={16} />
                    </Pressable>
                  </View>
                ))}
                {services.length === 0 ? <Text style={styles.helper}>{t('No services added yet.')}</Text> : null}
                <TextInput
                  accessibilityLabel={t('Task name (e.g. Fan installation)')}
                  maxLength={120}
                  onChangeText={(value) => {
                    setTaskName(filterTextInput(value, 120));
                    setTaskFieldErrors((current) => ({ ...current, taskName: undefined }));
                  }}
                  placeholder={t('Task name (e.g. Fan installation)')}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, isRTL && styles.rtlInput]}
                  value={taskName}
                />
                <FieldError message={taskFieldErrors.taskName} />
                <TextInput
                  accessibilityLabel={t('Price in Rs.')}
                  keyboardType="decimal-pad"
                  maxLength={13}
                  onChangeText={(value) => {
                    setTaskPrice(filterDecimalInput(value));
                    setTaskFieldErrors((current) => ({ ...current, taskPrice: undefined }));
                  }}
                  placeholder={t('Price in Rs.')}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, isRTL && styles.rtlInput]}
                  value={taskPrice}
                />
                <FieldError message={taskFieldErrors.taskPrice} />
                <View style={styles.switchRow}>
                  <Text style={styles.helper}>{t('Price is negotiable')}</Text>
                  <Switch onValueChange={setNegotiable} trackColor={{ true: colors.green }} value={negotiable} />
                </View>
                <Pressable disabled={busy} onPress={() => void addService()} style={[styles.secondaryButton, busy && styles.buttonDisabled]}>
                  <Text style={styles.secondaryText}>{busy ? t('Saving…') : editingServiceId ? t('Save changes') : t('Add service price')}</Text>
                </Pressable>
                {editingServiceId ? (
                  <Pressable
                    onPress={() => {
                      setEditingServiceId(null);
                      setTaskName('');
                      setTaskPrice('');
                      setTaskFieldErrors({});
                      setNegotiable(false);
                    }}
                    style={styles.cancelEdit}
                  >
                    <Text style={styles.cancelEditText}>{t('Cancel editing')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
          {provider ? (
            <ProviderVerificationPanel
              initialStatus={provider.verification_status}
              onRefreshApprovalStatus={onRefreshApprovalStatus}
              profileId={profile.id}
              providerProfileId={provider.id}
            />
          ) : null}
        </View>
      ) : null}

      {role === 'admin' && !demoMode ? <AdminVerificationPanel /> : null}

      {role === 'business_owner' ? (
        <View style={[styles.panel, getPinnedLtrStyle()]}>
          <Text style={styles.panelTitle}>{t('Business listing')}</Text>
          {business ? (
            <>
              <Text style={styles.categoryText}>{business.name}</Text>
              <Text style={styles.helper}>{t('Your directory listing can be paused or made visible at any time.')}</Text>
              <Pressable onPress={() => void toggleBusiness()} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>{t('Update listing status')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.helper}>{t('Add your shop or service business to the local directory.')}</Text>
              <TextInput maxLength={160} onChangeText={(value) => { setBusinessName(filterTextInput(value, 160)); if (fieldError?.field === 'businessName') setFieldError(null); }} placeholder={t('Business name')} placeholderTextColor={colors.muted} style={[styles.input, isRTL && styles.rtlInput]} value={businessName} />
              <FieldError message={fieldError?.field === 'businessName' ? fieldError.message : undefined} />
              <TextInput maxLength={100} onChangeText={(value) => { setBusinessCategory(filterTextInput(value, 100)); if (fieldError?.field === 'businessCategory') setFieldError(null); }} placeholder={t('Business category')} placeholderTextColor={colors.muted} style={[styles.input, isRTL && styles.rtlInput]} value={businessCategory} />
              <FieldError message={fieldError?.field === 'businessCategory' ? fieldError.message : undefined} />
              <TextInput maxLength={300} onChangeText={(value) => { setBusinessAddress(filterTextInput(value, 300)); if (fieldError?.field === 'businessAddress') setFieldError(null); }} placeholder={t('Street address')} placeholderTextColor={colors.muted} style={[styles.input, isRTL && styles.rtlInput]} value={businessAddress} />
              <FieldError message={fieldError?.field === 'businessAddress' ? fieldError.message : undefined} />
              <Pressable disabled={busy || !supabase} onPress={() => void createBusiness()} style={[styles.primaryButton, (!supabase || busy) && styles.buttonDisabled]}>
                <Text style={styles.primaryText}>{busy ? t('Saving…') : t('Create business listing')}</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
      </ScrollView>
      <Modal
        onRequestClose={closeProfileMenu}
        transparent
        visible={profileMenuMounted}
      >
        <View style={styles.drawerOverlay}>
          <Animated.View
            pointerEvents="none"
            style={[styles.drawerScrim, { opacity: drawerProgress }]}
          />
          <Pressable
            accessibilityLabel={t('Close menu')}
            accessibilityRole="button"
            onPress={closeProfileMenu}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            style={[
              styles.drawerPanel,
              {
                transform: [{
                  translateX: drawerProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-300, 0],
                  }),
                }],
              },
            ]}
          >
            <View style={[styles.drawerHeader, getPinnedLtrStyle()]}>
              <Text style={styles.drawerTitle}>{t('More Details')}</Text>
              <Pressable accessibilityLabel={t('Close menu')} accessibilityRole="button" onPress={closeProfileMenu} style={styles.drawerClose}>
                <AppIcon color={colors.buttonText} name="x" size={18} />
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={() => openProfileDestination('/my-reviews')} style={[styles.drawerItem, getPinnedLtrStyle()]}>
              <AppIcon color={colors.green} name="star" size={18} />
              <Text style={styles.drawerItemText}>{t('My Reviews')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => openProfileDestination('/terms')} style={[styles.drawerItem, getPinnedLtrStyle()]}>
              <AppIcon color={colors.green} name="document" size={18} />
              <Text style={styles.drawerItemText}>{t('Terms & Conditions')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => openProfileDestination('/privacy')} style={[styles.drawerItem, getPinnedLtrStyle()]}>
              <AppIcon color={colors.green} name="badgeCheck" size={18} />
              <Text style={styles.drawerItemText}>{t('Privacy Policy')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => openProfileDestination('/report')} style={[styles.drawerItem, getPinnedLtrStyle()]}>
              <AppIcon color={colors.green} name="flag" size={18} />
              <Text style={styles.drawerItemText}>{t('Report')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                closeProfileMenu();
                onSignOut();
              }}
              style={[styles.drawerItem, getPinnedLtrStyle()]}
            >
              <AppIcon color={colors.green} name="logOut" size={18} />
              <Text style={styles.drawerItemText}>{t(demoMode ? 'Exit demo' : 'Sign out')}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
      {locationToast ? (
        <View
          accessibilityLiveRegion={locationToast.kind === 'error' ? 'assertive' : 'polite'}
          accessibilityRole={locationToast.kind === 'error' ? 'alert' : 'text'}
          pointerEvents="none"
          style={[
            styles.locationToast,
            locationToast.kind === 'error' ? styles.locationToastError : styles.locationToastSuccess,
          ]}
        >
          <Text style={styles.locationToastText}>{locationToast.message}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 18, paddingBottom: 34, width: '100%', maxWidth: 720, alignSelf: 'center' },
  rtlInput: { textAlign: 'right' },
  header: { marginVertical: 6 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.green, fontWeight: '800', letterSpacing: 1.7, fontSize: 9 },
  title: { color: colors.ink, fontWeight: '900', fontSize: 25, marginTop: 4 },
  moreDetailsButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  drawerOverlay: { flex: 1, flexDirection: 'row' },
  drawerScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.42)' },
  drawerPanel: { width: 300, maxWidth: '84%', height: '100%', backgroundColor: colors.paper, paddingTop: 28, paddingHorizontal: 18, elevation: 12, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 3, height: 0 } },
  drawerHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 10 },
  drawerTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  drawerClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.green },
  drawerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: 6 },
  drawerItemText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  identity: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 15, marginTop: 14, marginBottom: 13 },
  avatar: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 17 },
  avatarText: { color: colors.greenDark, fontSize: 19, fontWeight: '900' },
  identityCopy: { flex: 1, marginLeft: 12 },
  nameBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  editProfileButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginTop: 4, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 10 },
  profileEditPanel: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, padding: 14, marginBottom: 13 },
  choosePhotoButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 10, marginTop: 10 },
  profileEditActions: { flexDirection: 'row', gap: 10 },
  profileEditAction: { flex: 1 },
  cancelProfileEdit: { minHeight: 45, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, marginTop: 12 },
  accountRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 10, gap: 10 },
  accountCopy: { flex: 1 },
  accountName: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  accountEmail: { color: colors.muted, fontSize: 10, marginTop: 3 },
  accountButton: { minWidth: 76, minHeight: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 10, paddingHorizontal: 10 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  role: { color: colors.muted, fontSize: 11, marginTop: 4 },
  panel: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, padding: 16, marginBottom: 12 },
  panelTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 6 },
  roleButtons: { flexDirection: 'row', gap: 7, marginTop: 13 },
  roleButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 10 },
  roleButtonSelected: { backgroundColor: colors.green, borderColor: colors.green },
  roleButtonText: { color: colors.buttonText, fontSize: 10, fontWeight: '700' },
  roleButtonTextSelected: { color: colors.buttonText },
  input: { backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 12, minHeight: 45, paddingHorizontal: 12, fontSize: 12, color: colors.ink, marginTop: 10 },
  multiline: { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 },
  primaryButton: { backgroundColor: colors.green, borderRadius: 12, minHeight: 45, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  primaryText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
  buttonDisabled: { opacity: 0.6 },
  categoryText: { color: colors.green, fontSize: 13, fontWeight: '800', marginTop: 10 },
  providerCategoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  providerCategoryName: { flex: 1 },
  editCategoryButton: { minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green },
  locationButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, minHeight: 40, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  locationToast: { position: 'absolute', bottom: 14, left: 18, right: 18, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, elevation: 5, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  locationToastSuccess: { backgroundColor: colors.greenDark },
  locationToastError: { backgroundColor: colors.coral },
  locationToastText: { color: colors.white, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  statusHeading: { marginTop: 14 },
  statusSyncRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  statusSyncText: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 7 },
  statusOptions: { flexDirection: 'row', gap: 7, marginTop: 14 },
  statusOption: { flex: 1, alignItems: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#E8E8E8', paddingVertical: 9 },
  statusOptionActive: { backgroundColor: colors.green, borderColor: colors.green },
  statusOptionText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  statusOptionTextActive: { color: colors.buttonText },
  providerSetting: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  subsection: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 17, paddingTop: 14, marginBottom: 14 },
  subsectionTitle: { color: colors.ink, fontSize: 12, fontWeight: '900', marginBottom: 5 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 10 },
  contactPhoneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 8 },
  phoneEditButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 10, backgroundColor: colors.green, borderRadius: 9 },
  contactPhoneText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  serviceName: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  servicePrice: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  deleteButton: { marginLeft: 9, width: 28, height: 28, backgroundColor: colors.green, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  editButton: { marginLeft: 7, width: 28, height: 28, backgroundColor: colors.green, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cancelEdit: { alignItems: 'center', padding: 8, backgroundColor: colors.green, borderRadius: 10, marginTop: 8 },
  cancelEditText: { color: colors.buttonText, fontSize: 11, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  secondaryButton: { borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, minHeight: 43, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryText: { color: colors.buttonText, fontSize: 12, fontWeight: '800' },
  error: { color: colors.coral, fontSize: 11, lineHeight: 16, marginBottom: 10 },
  success: { color: colors.green, fontSize: 11, marginBottom: 10 },
  signOut: { alignItems: 'center', padding: 14, marginTop: 16, backgroundColor: colors.green, borderRadius: 12 },
  signOutText: { color: colors.buttonText, fontWeight: '800', fontSize: 12 },
});
