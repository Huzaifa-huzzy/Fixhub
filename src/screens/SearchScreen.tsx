import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { AppIcon } from '../components/AppIcon';
import { ProviderCard } from '../components/ProviderCard';
import { ProviderVerificationBanner } from '../components/ProviderVerificationBanner';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { Notice } from '../components/Notice';
import { FieldError } from '../components/FieldError';
import { categories, demoProviders } from '../data/demo';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { filterDecimalInput, filterTextInput, isValidDecimal } from '../lib/inputValidation';
import { distanceKm } from '../lib/geo';
import { getPinnedLtrStyle } from '../lib/layoutDirection';
import { formatLocalizedExperience } from '../lib/formatLocalizedExperience';
import { colors, radius } from '../theme';
import type { ProviderListing } from '../types';

type PublicProviderProfile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

type ProviderReview = {
  id: string;
  reviewer: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

function aggregateRatings(rows: { to_profile_id: string; rating: number }[]) {
  const grouped = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const current = grouped.get(row.to_profile_id) ?? { total: 0, count: 0 };
    current.total += Number(row.rating);
    current.count += 1;
    grouped.set(row.to_profile_id, current);
  }
  return new Map([...grouped].map(([id, value]) => [
    id,
    { rating: value.total / value.count, reviews: value.count },
  ]));
}

export function SearchScreen({
  demoMode,
  currentProfileId,
  isProvider,
}: {
  demoMode: boolean;
  currentProfileId: string;
  isProvider: boolean;
}) {
  const { t, isRTL } = useLanguage();
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 900;
  const [providers, setProviders] = useState<ProviderListing[]>(demoMode ? demoProviders : []);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [highlyRatedOnly, setHighlyRatedOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState('');
  const [selected, setSelected] = useState<ProviderListing | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const [showVerificationSuccess, setShowVerificationSuccess] = useState(false);
  const [verificationReason, setVerificationReason] = useState<string | null>(null);
  const [hasCnicDocuments, setHasCnicDocuments] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [phonesLoading, setPhonesLoading] = useState(false);
  const [phonesError, setPhonesError] = useState('');
  const [providerReviews, setProviderReviews] = useState<ProviderReview[]>([]);
  const [providerReviewsLoading, setProviderReviewsLoading] = useState(false);
  const [providerReviewsError, setProviderReviewsError] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewChatBusy, setReviewChatBusy] = useState(false);
  const [loading, setLoading] = useState(!demoMode && Boolean(supabase));
  const [error, setError] = useState('');

  const loadProviderReviews = useCallback(async (profileId: string, isActive: () => boolean = () => true) => {
    if (!supabase) return;
    setProviderReviewsLoading(true);
    setProviderReviewsError('');
    const { data: reviewRows, error: reviewsError } = await supabase
      .from('reviews')
      .select('id,from_profile_id,rating,comment,created_at')
      .eq('to_profile_id', profileId)
      .order('created_at', { ascending: false });
    if (!isActive()) return;
    if (reviewsError) {
      setProviderReviewsError(reviewsError.message);
      setProviderReviewsLoading(false);
      return;
    }

    const reviewerIds = [...new Set((reviewRows ?? []).map((review) => review.from_profile_id))];
    const { data: reviewerProfiles, error: reviewersError } = reviewerIds.length
      ? await supabase.from('public_profiles').select('id,name').in('id', reviewerIds)
      : { data: [], error: null };
    if (!isActive()) return;
    if (reviewersError) {
      setProviderReviewsError(reviewersError.message);
      setProviderReviewsLoading(false);
      return;
    }

    const reviewerNames = new Map((reviewerProfiles ?? []).map((reviewer) => [reviewer.id, reviewer.name]));
    setProviderReviews((reviewRows ?? []).map((review) => ({
      id: review.id,
      reviewer: reviewerNames.get(review.from_profile_id)?.trim() || t('FixHub user'),
      rating: review.rating,
      comment: review.comment,
      createdAt: review.created_at,
    })));
    setProviderReviewsLoading(false);
  }, [t]);

  useEffect(() => {
    if (!selected || demoMode || !supabase) return;

    let active = true;
    const reviewTimer = setTimeout(() => {
      void loadProviderReviews(selected.profileId, () => active).catch((reviewsError: unknown) => {
        if (!active) return;
        setProviderReviewsError(reviewsError instanceof Error ? reviewsError.message : t('Unable to load reviews.'));
        setProviderReviewsLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(reviewTimer);
    };
  }, [demoMode, loadProviderReviews, selected, t]);

  useFocusEffect(useCallback(() => {
    if (!isProvider || demoMode || !supabase) return;
    let active = true;
    async function loadVerificationStatus() {
      setVerificationError('');
      setShowVerificationSuccess(false);
      const { data, error: statusError } = await supabase!.rpc('get_provider_verification', {
        p_profile_id: currentProfileId,
      });
      if (statusError) throw statusError;
      const verification = data?.[0] as {
        verification_status: 'pending' | 'verified' | 'rejected';
        rejection_reason: string | null;
        cnic_front_url: string | null;
        cnic_back_url: string | null;
      } | undefined;
      if (!active) return;
      const status = verification?.verification_status ?? 'pending';
      setVerificationStatus(status);
      setVerificationReason(verification?.rejection_reason ?? null);
      setHasCnicDocuments(Boolean(verification?.cnic_front_url && verification.cnic_back_url));
      if (status === 'verified') {
        const noticeKey = `@fixhub/provider-verification-success-shown/${currentProfileId}`;
        const alreadyShown = await AsyncStorage.getItem(noticeKey);
        if (!active) return;
        if (!alreadyShown) {
          await AsyncStorage.setItem(noticeKey, 'true');
          if (!active) return;
          setShowVerificationSuccess(true);
        }
      }
    }
    void loadVerificationStatus().catch((statusError: unknown) => {
      if (active) setVerificationError(statusError instanceof Error ? statusError.message : t('Unable to load your CNIC status.'));
    });
    return () => { active = false; };
  }, [currentProfileId, demoMode, isProvider, t]));

  useEffect(() => {
    if (!selected || demoMode || !supabase) return;

    let active = true;
    async function loadContactPhones() {
      const { data, error: phoneError } = await supabase!.rpc('get_public_provider_phones', {
        target_provider_profile_id: selected!.id,
      });
      if (!active) return;
      if (phoneError) {
        setPhonesError(phoneError.message);
      } else {
        setSelectedPhones(Array.isArray(data) ? data.filter((phone): phone is string => typeof phone === 'string') : []);
      }
      setPhonesLoading(false);
    }
    void loadContactPhones().catch((phoneError: unknown) => {
      if (!active) return;
      setPhonesError(phoneError instanceof Error ? phoneError.message : 'Unable to load contact numbers.');
      setPhonesLoading(false);
    });
    return () => { active = false; };
  }, [demoMode, selected]);

  useEffect(() => {
    if (demoMode || !supabase) return;
    let active = true;
    async function loadProviders() {
      setLoading(true);
      setError('');
      const { data, error: providerError } = await supabase!
        .from('provider_profiles')
        .select('id,profile_id,category,bio,experience_years,is_active,availability_status,verification_status,lat,lng,provider_services(task_name,price,is_starting_from,is_negotiable)');
      if (providerError) {
        if (active) {
          setError(providerError.message);
          setLoading(false);
        }
        return;
      }

      const providerRows = data ?? [];
      const ids = providerRows.map((row) => row.profile_id);
      const { data: profileRows, error: profileError } = ids.length
        ? await supabase!.rpc('get_public_provider_profiles', { target_profile_ids: ids })
        : { data: [], error: null };
      if (profileError) {
        if (active) {
          setError(profileError.message);
          setLoading(false);
        }
        return;
      }
      const { data: providerReviewRows, error: providerReviewError } = ids.length
        ? await supabase!.from('reviews').select('to_profile_id,rating').in('to_profile_id', ids)
        : { data: [], error: null };
      if (providerReviewError) {
        if (active) {
          setError(providerReviewError.message);
          setLoading(false);
        }
        return;
      }
      const providerRatings = aggregateRatings(providerReviewRows ?? []);
      const profileById = new Map<string, PublicProviderProfile>(
        (profileRows ?? []).map((row: PublicProviderProfile) => [row.id, row]),
      );
      const nextProviders: ProviderListing[] = providerRows.map((row) => {
        const publicProfile = profileById.get(row.profile_id);
        const services = row.provider_services ?? [];
        const rating = providerRatings.get(row.profile_id);
        return {
          id: row.id,
          profileId: row.profile_id,
          name: publicProfile?.name ?? 'Service provider',
          category: row.category,
          bio: row.bio ?? '',
          experience: row.experience_years ?? 0,
          rating: rating?.rating ?? 0,
          reviews: rating?.reviews ?? 0,
          distance: 'Distance unavailable',
          active: row.is_active,
          availabilityStatus: row.availability_status,
          isVerified: row.verification_status === 'verified',
          latitude: row.lat,
          longitude: row.lng,
          avatar: publicProfile?.name
            ? publicProfile.name.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase()
            : 'SC',
          avatarUrl: publicProfile?.avatar_url ?? null,
          services: services.map((service) => ({
            name: service.task_name,
            price: Number(service.price),
            startingFrom: service.is_starting_from,
            negotiable: service.is_negotiable,
          })),
        };
      });
      if (active) {
        setProviders(nextProviders);
        setLoading(false);
      }
    }
    void loadProviders();
    return () => { active = false; };
  }, [demoMode]);

  const visibleProviders = useMemo(() => providers.filter((provider) => {
    const matchesCategory = category === 'All' || provider.category.toLowerCase() === category.toLowerCase();
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery
      || `${provider.name} ${provider.category} ${provider.bio} ${provider.services.map((service) => service.name).join(' ')}`
        .toLowerCase().includes(normalizedQuery);
    const matchesAvailability = !activeOnly
      || (provider.availabilityStatus ? provider.availabilityStatus === 'active' : provider.active);
    const matchesRating = !highlyRatedOnly || provider.rating >= 4.5;
    const priceLimit = Number(maxPrice);
    const matchesPrice = !maxPrice.trim()
      || (Number.isFinite(priceLimit) && priceLimit > 0
        && provider.services.some((service) => service.price <= priceLimit));
    const distanceLimit = Number(maxDistance);
    const providerDistance = userLocation && provider.latitude != null && provider.longitude != null
      ? distanceKm(userLocation, { latitude: provider.latitude, longitude: provider.longitude })
      : Number.parseFloat(provider.distance);
    const matchesDistance = !maxDistance.trim()
      || (Number.isFinite(distanceLimit) && distanceLimit > 0
        && Number.isFinite(providerDistance) && providerDistance <= distanceLimit);
    return matchesCategory && matchesQuery && matchesAvailability && matchesRating && matchesPrice && matchesDistance;
  }), [activeOnly, category, highlyRatedOnly, maxDistance, maxPrice, providers, query, userLocation]);

  const maxPriceInvalid = Boolean(maxPrice) && !isValidDecimal(maxPrice, 0.01, 9_999_999_999.99);
  const maxDistanceInvalid = Boolean(maxDistance) && !isValidDecimal(maxDistance, 0.1, 5000);

  const displayProviders = visibleProviders.map((provider) => {
    const distance = userLocation && provider.latitude != null && provider.longitude != null
      ? distanceKm(userLocation, { latitude: provider.latitude, longitude: provider.longitude })
      : Number.parseFloat(provider.distance);
    return Number.isFinite(distance)
      ? { ...provider, distance: `${distance.toFixed(1)} km` }
      : provider;
  });

  const setSearchLocation = useCallback(async (requestPermission = true) => {
    setLocationError('');
    try {
      const permission = requestPermission
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        if (requestPermission) setLocationError('Allow location access to filter by distance.');
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    } catch (locationError) {
      setLocationError(locationError instanceof Error ? locationError.message : 'Unable to get your current location.');
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void setSearchLocation(false);
  }, [setSearchLocation]));

  function openProvider(provider: ProviderListing) {
    setReviewRating(5);
    setReviewComment('');
    setReviewError('');
    setReviewMessage('');
    setReviewChatBusy(false);
    setSelectedPhones([]);
    setPhonesError('');
    setPhonesLoading(!demoMode && Boolean(supabase));
    setProviderReviews([]);
    setProviderReviewsError('');
    setProviderReviewsLoading(!demoMode && Boolean(supabase));
    setSelected(provider);
  }

  async function submitReview() {
    if (!selected) return;
    if (demoMode || !supabase) {
      setReviewError('Reviews in demo mode are not saved.');
      return;
    }
    if (currentProfileId === selected.profileId) {
      setReviewError('You cannot review your own profile.');
      return;
    }
    if (reviewComment.length > 1500) {
      setReviewError('Review comments must be 1500 characters or fewer.');
      return;
    }
    setReviewBusy(true);
    setReviewError('');
    try {
      const { data: reviewId, error: submitError } = await supabase.rpc('submit_provider_review', {
        p_to_profile_id: selected.profileId,
        p_rating: reviewRating,
        p_comment: reviewComment.trim() || null,
      });
      if (submitError) {
        setReviewError(submitError.code === '23505'
          ? 'You have already reviewed this provider.'
          : submitError.code === 'PGRST202'
            ? 'Review service setup is missing. Apply the latest Supabase migration, then try again.'
            : submitError.message);
        return;
      }
      if (typeof reviewId !== 'string') throw new Error('Unable to confirm that your review was saved.');
      const nextReviews = selected.reviews + 1;
      const nextRating = ((selected.rating * selected.reviews) + reviewRating) / nextReviews;
      const updated = { ...selected, reviews: nextReviews, rating: nextRating };
      setSelected(updated);
      setProviders((current) => current.map((provider) => provider.id === selected.id ? updated : provider));
      setReviewMessage('Thank you. Your review has been submitted.');
      void loadProviderReviews(selected.profileId);
    } catch (reviewError) {
      setReviewError(reviewError instanceof Error ? reviewError.message : 'Unable to submit your review.');
    } finally {
      setReviewBusy(false);
    }
  }

  async function chatWithSelectedProvider() {
    if (!selected || !supabase || demoMode) {
      setReviewError('Sign in to chat with this provider.');
      return;
    }
    if (currentProfileId === selected.profileId) {
      setReviewError('You cannot start a chat with your own profile.');
      return;
    }
    setReviewChatBusy(true);
    setReviewError('');
    try {
      const { data, error: chatError } = await supabase.rpc('get_or_create_chat', {
        other_profile_id: selected.profileId,
      });
      if (chatError) throw chatError;
      if (typeof data !== 'string') throw new Error('Could not start this chat.');
      router.push({
        pathname: '/chat/[chatId]',
        params: {
          chatId: data,
          otherProfileId: selected.profileId,
          providerName: selected.name,
        },
      });
    } catch (chatError) {
      setReviewError(chatError instanceof Error ? chatError.message : 'Unable to open chat.');
    } finally {
      setReviewChatBusy(false);
    }
  }

  async function callProvider(phone: string) {
    try {
      const dialerUrl = `tel:${phone}`;
      const supported = await Linking.canOpenURL(dialerUrl);
      if (supported) await Linking.openURL(dialerUrl);
      else Alert.alert('Calling unavailable', 'This device cannot place phone calls.');
    } catch (callError) {
      Alert.alert('Unable to open phone dialer', callError instanceof Error ? callError.message : 'Please try again.');
    }
  }

  return (
    <View style={[styles.screen, getPinnedLtrStyle()]}>
      <ScrollView
        contentContainerStyle={[styles.content, isWideScreen && styles.contentWide]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.header, isWideScreen && styles.headerWide]}>
          <View>
            <Text style={[styles.greeting, isRTL && styles.rtlText]}>{t('LOCAL SERVICE DIRECTORY')}</Text>
            <Text style={[styles.heading, isRTL && styles.rtlText]}>{t('Find trusted help nearby')}</Text>
            <Text style={[styles.headerSubtitle, isRTL && styles.rtlText]}>{t('Compare local professionals and find the right person for the job.')}</Text>
          </View>
          {isProvider && !demoMode ? (
            <>
              {verificationError ? <Text accessibilityRole="alert" style={styles.error}>{verificationError}</Text> : null}
              <ProviderVerificationBanner
                hasDocuments={hasCnicDocuments}
                onManage={() => router.push('/(tabs)/profile')}
                rejectionReason={verificationReason}
                showSuccessMessage={showVerificationSuccess}
                status={verificationStatus}
              />
            </>
          ) : null}
        </View>
        <View style={[styles.searchRow, isWideScreen && styles.searchRowWide]}>
          <View style={[styles.searchBox, isWideScreen && styles.searchBoxWide]}>
            <AppIcon color={colors.green} name="search" size={20} />
            <TextInput
              accessibilityLabel={t('Search services')}
              maxLength={100}
              onChangeText={(value) => setQuery(filterTextInput(value, 100))}
              placeholder={t('What service do you need?')}
              placeholderTextColor={colors.muted}
              style={[styles.searchInput, isRTL && styles.rtlInput]}
              value={query}
            />
            {isWideScreen ? <Text style={styles.searchHint}>{t('Search by service or provider')}</Text> : null}
          </View>
        </View>
        <Text style={[styles.filterLabel, isRTL && styles.rtlText]}>{t('Browse by service')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {categories.map((item) => {
            const active = category === item.name;
            return (
              <Pressable key={item.name} onPress={() => setCategory(item.name)} style={[styles.chip, active && styles.chipActive]}>
                <AppIcon color={active ? colors.white : colors.ink} name={item.icon} size={15} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(item.name)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.filterSection}>
          <Text style={[styles.filterLabel, isRTL && styles.rtlText]}>{t('Refine your search')}</Text>
          <View style={styles.filters}>
          <Pressable onPress={() => setActiveOnly((current) => !current)} style={[styles.filterChip, activeOnly && styles.filterChipActive]}>
            <Text numberOfLines={1} style={[styles.filterText, activeOnly && styles.filterTextActive]}>{t('Available now')}</Text>
          </Pressable>
          <Pressable onPress={() => setHighlyRatedOnly((current) => !current)} style={[styles.filterChip, highlyRatedOnly && styles.filterChipActive]}>
            <Text numberOfLines={1} style={[styles.filterText, highlyRatedOnly && styles.filterTextActive]}>{t('Ratings 4.5+')}</Text>
          </Pressable>
          <View style={styles.numericFilter}>
            <TextInput
              accessibilityLabel={t('Maximum task price in rupees')}
              keyboardType="decimal-pad"
              maxLength={13}
              onChangeText={(value) => setMaxPrice(filterDecimalInput(value))}
              placeholder={t('Max Rs.')}
              placeholderTextColor={colors.muted}
              style={[styles.priceFilter, isRTL && styles.rtlInput]}
              value={maxPrice}
            />
            <FieldError message={maxPriceInvalid ? t('Enter a price greater than zero with no more than two decimal places.') : undefined} />
          </View>
          <View style={styles.numericFilter}>
            <TextInput
              accessibilityLabel={t('Maximum distance in kilometers')}
              keyboardType="decimal-pad"
              maxLength={7}
              onChangeText={(value) => setMaxDistance(filterDecimalInput(value))}
              placeholder={t('Max km')}
              placeholderTextColor={colors.muted}
              style={[styles.distanceFilter, isRTL && styles.rtlInput]}
              value={maxDistance}
            />
            <FieldError message={maxDistanceInvalid ? t('Distance must be greater than 0 and no more than 5000 km.') : undefined} />
          </View>
          </View>
        </View>
        {locationError ? <Text accessibilityRole="alert" style={styles.error}>{locationError}</Text> : null}

        <View style={styles.sectionHeading}>
          <View>
            <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('Top professionals')}</Text>
            <Text style={styles.sectionSubtitle}>{t('Trusted experts, ready to help')}</Text>
          </View>
        </View>
        {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>Could not load providers: {error}</Text> : null}
        {!loading && !error && visibleProviders.length === 0 ? (
          <View style={styles.empty}>
            <AppIcon color={colors.green} name="search" size={29} />
            <Text style={styles.emptyTitle}>{t('No matches yet')}</Text>
            <Text style={styles.emptyCopy}>{t('Try another category or search term.')}</Text>
          </View>
        ) : null}
        <View style={styles.providerGrid}>
          {displayProviders.map((provider) => (
            <View key={provider.id} style={[styles.providerColumn, isWideScreen && styles.providerColumnWide]}>
              <ProviderCard onPress={() => openProvider(provider)} provider={provider} />
            </View>
          ))}
        </View>

        <Notice>
          {t('Final price and payment are agreed directly between you and the provider. The app only connects you.')}
        </Notice>
        <Text style={styles.demoNote}>{t(demoMode ? 'DEMO MODE · Sample listings' : 'Listings are provided by local users')}</Text>
      </ScrollView>

      <Modal animationType="slide" onRequestClose={() => setSelected(null)} transparent visible={Boolean(selected)}>
        {selected ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
          <View style={[styles.modalBackdrop, getPinnedLtrStyle()]}>
            <View style={styles.modalCard}>
              <View style={styles.modalHandle} />
              <Pressable accessibilityLabel={t('Close provider details')} onPress={() => setSelected(null)} style={styles.closeButton}>
                <AppIcon color={colors.buttonText} name="x" size={20} />
              </Pressable>
              <ScrollView
                contentContainerStyle={styles.modalScrollContent}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                style={styles.modalScroll}
              >
                <View style={styles.modalAvatar}>
                  {selected.avatarUrl
                    ? <Image accessibilityLabel={`${selected.name} profile photo`} source={{ uri: selected.avatarUrl }} style={styles.modalAvatarImage} />
                    : <Text style={styles.modalAvatarText}>{selected.avatar}</Text>}
                </View>
                <View style={styles.modalNameRow}>
                  <Text style={styles.modalName}>{selected.name}</Text>
                  {selected.isVerified ? <VerifiedBadge /> : null}
                </View>
                <Text style={[styles.modalMeta, isRTL && styles.rtlCenteredText]}>{t(selected.category)} · {formatLocalizedExperience(selected.experience, t('years of experience'))}</Text>
                <Text style={styles.modalBio}>{selected.bio}</Text>
                <View style={styles.modalSectionLine}>
                  <Text style={styles.modalSectionTitle}>{t('Service prices')}</Text>
                  <View style={styles.modalRating}>
                    <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={12} />
                    <Text style={styles.modalRatingText}>{selected.rating || 'New'} {selected.reviews ? `(${selected.reviews})` : ''}</Text>
                  </View>
                </View>
                {selected.services.map((service) => (
                  <View key={service.name} style={styles.serviceRow}>
                    <Text style={styles.serviceName}>
                      {service.name}
                      {service.startingFrom ? ` · ${t('Starting from')}` : ''}
                      {service.negotiable ? ` · ${t('Negotiable')}` : ''}
                    </Text>
                    <Text style={styles.servicePrice}>Rs. {service.price.toLocaleString()}</Text>
                  </View>
                ))}
                {selected.services.length === 0 ? <Text style={styles.noServices}>{t('No task prices have been added yet.')}</Text> : null}
                <View style={styles.providerReviewsSection}>
                  <View style={styles.modalSectionLine}>
                    <Text style={styles.modalSectionTitle}>{t('Reviews')}</Text>
                    <Text style={styles.modalRating}>{selected.reviews}</Text>
                  </View>
                  {providerReviewsLoading ? <ActivityIndicator color={colors.green} style={styles.phoneLoader} /> : null}
                  {providerReviewsError ? <Text accessibilityRole="alert" style={styles.error}>{t('Unable to load reviews.')}: {providerReviewsError}</Text> : null}
                  {!providerReviewsLoading && !providerReviewsError && providerReviews.length === 0
                    ? <Text style={styles.noServices}>{t('No reviews yet.')}</Text>
                    : null}
                  {providerReviews.map((review) => (
                    <View key={review.id} style={styles.providerReviewCard}>
                      <View style={styles.providerReviewHeader}>
                        <View style={styles.providerReviewReviewer}>
                          <Text style={[styles.providerReviewName, isRTL && styles.rtlText]}>{t('Review by')} {review.reviewer}</Text>
                          <Text style={styles.providerReviewDate}>
                            {new Date(review.createdAt).toLocaleDateString(isRTL ? 'ur-PK' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </Text>
                        </View>
                        <View style={styles.providerReviewRating}>
                          {Array.from({ length: review.rating }, (_, index) => (
                            <AppIcon color="#B7791F" fill="#B7791F" key={index} name="star" size={12} />
                          ))}
                        </View>
                      </View>
                      {review.comment ? <Text style={[styles.providerReviewComment, isRTL && styles.rtlText]}>{review.comment}</Text> : null}
                    </View>
                  ))}
                </View>
                <View style={styles.reviewBox}>
                  <Text style={styles.modalSectionTitle}>{t('Rate after your job')}</Text>
                  <Text style={styles.reviewHelp}>{t('Leave a review after your job is done.')}</Text>
                  {!demoMode ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={reviewChatBusy}
                      onPress={() => void chatWithSelectedProvider()}
                      style={[styles.reviewChatButton, reviewChatBusy && styles.reviewButtonDisabled]}
                    >
                      {reviewChatBusy
                        ? <ActivityIndicator color={colors.buttonText} />
                        : <Text style={styles.reviewChatButtonText}>{t('Chat with provider')}</Text>}
                    </Pressable>
                  ) : null}
                  <View style={styles.stars}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Pressable key={value} accessibilityLabel={`${value} stars`} onPress={() => setReviewRating(value)}>
                        <AppIcon
                          color={value <= reviewRating ? '#B7791F' : '#D4D4D4'}
                          fill={value <= reviewRating ? '#B7791F' : 'none'}
                          name="star"
                          size={24}
                        />
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel={t('Review comment')}
                    maxLength={1500}
                    onChangeText={(value) => setReviewComment(filterTextInput(value, 1500, true))}
                    placeholder={t('Share a little about your experience (optional)')}
                    placeholderTextColor={colors.muted}
                    style={styles.reviewInput}
                    value={reviewComment}
                  />
                  {reviewError ? <FieldError message={reviewError} /> : null}
                  {reviewMessage ? <Text accessibilityLiveRegion="polite" style={styles.reviewSuccess}>{reviewMessage}</Text> : null}
                  <Pressable disabled={reviewBusy} onPress={() => void submitReview()} style={[styles.reviewButton, reviewBusy && styles.reviewButtonDisabled]}>
                    <Text style={styles.reviewButtonText}>{reviewBusy ? t('Submitting…') : t('Submit review')}</Text>
                  </Pressable>
                </View>
                <Notice>
                  Final price and payment are agreed directly between you and the provider. The app only connects you.
                </Notice>
                <View style={styles.contactActions}>
                  <Text style={styles.modalSectionTitle}>{t('Call provider')}</Text>
                  {phonesLoading ? <ActivityIndicator color={colors.green} style={styles.phoneLoader} /> : null}
                  {phonesError ? <Text accessibilityRole="alert" style={styles.error}>Could not load contact numbers: {phonesError}</Text> : null}
                  {!phonesLoading && !phonesError && selectedPhones.length === 0 ? (
                    <Text style={styles.noServices}>{t('This provider has not enabled direct calls.')}</Text>
                  ) : null}
                  {selectedPhones.map((phone) => (
                    <Pressable key={phone} onPress={() => void callProvider(phone)} style={styles.callButton}>
                      <Text style={styles.actionText}>{t('Call')} {phone}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          </View>
          </KeyboardAvoidingView>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { paddingHorizontal: 19, paddingTop: 25, paddingBottom: 36, maxWidth: 720, width: '100%', alignSelf: 'center' },
  contentWide: { maxWidth: 1180, paddingHorizontal: 34, paddingTop: 38 },
  header: { marginBottom: 20 },
  rtlText: { textAlign: 'right' },
  rtlCenteredText: { textAlign: 'center', writingDirection: 'rtl' },
  rtlInput: { textAlign: 'right' },
  headerWide: { marginBottom: 25 },
  greeting: { color: colors.green, fontWeight: '800', fontSize: 10, letterSpacing: 1.6 },
  heading: { color: colors.ink, fontWeight: '900', fontSize: 27, marginTop: 7, letterSpacing: -0.7 },
  headerSubtitle: { color: colors.muted, fontSize: 13, marginTop: 7, lineHeight: 19 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 23 },
  searchRowWide: { gap: 14, marginBottom: 28 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, height: 54 },
  searchBoxWide: { height: 60, paddingHorizontal: 18 },
  searchIcon: { fontSize: 22, color: colors.green, marginRight: 10 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14 },
  searchHint: { color: colors.muted, fontSize: 11, paddingLeft: 12 },
  filterLabel: { color: colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 10 },
  chips: { gap: 9, paddingBottom: 20 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.white, borderWidth: 1, borderColor: '#7A283F', borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 15 },
  chipActive: { backgroundColor: '#7A283F', borderColor: '#7A283F' },
  chipIcon: { color: colors.green, fontSize: 12 },
  chipText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.white },
  filterSection: { marginBottom: 24 },
  filters: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  numericFilter: { flex: 1, minWidth: 0 },
  filterChip: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#7A283F', backgroundColor: colors.white, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6 },
  filterChipActive: { backgroundColor: '#7A283F', borderColor: '#7A283F' },
  filterText: { color: colors.ink, fontWeight: '700', fontSize: 10, textAlign: 'center' },
  filterTextActive: { color: colors.white },
  priceFilter: { width: '100%', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 10, color: colors.ink, fontSize: 10 },
  distanceFilter: { width: '100%', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 10, color: colors.ink, fontSize: 10 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, marginBottom: 16 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  sectionSubtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  providerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  providerColumn: { width: '100%', marginBottom: 14 },
  providerColumnWide: { width: '49%' },
  loader: { marginVertical: 25 },
  error: { color: colors.coral, fontSize: 12, marginBottom: 12, lineHeight: 18 },
  empty: { alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.card, padding: 28, marginBottom: 14 },
  emptyIcon: { color: colors.green, fontSize: 29 },
  emptyTitle: { color: colors.ink, fontWeight: '800', marginTop: 8 },
  emptyCopy: { color: colors.muted, fontSize: 12, marginTop: 4 },
  demoNote: { textAlign: 'center', fontSize: 9, color: colors.muted, letterSpacing: 1.2, marginTop: 14 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.paper, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '90%' },
  modalScroll: { flexShrink: 1 },
  modalScrollContent: { paddingBottom: 8 },
  modalHandle: { width: 40, height: 4, backgroundColor: '#D4D4D4', alignSelf: 'center', borderRadius: 3, marginBottom: 14 },
  closeButton: { position: 'absolute', right: 18, top: 16, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  modalAvatar: { width: 56, height: 56, borderRadius: 19, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 3 },
  modalAvatarImage: { width: '100%', height: '100%', borderRadius: 19 },
  modalAvatarText: { color: colors.greenDark, fontWeight: '900', fontSize: 16 },
  modalName: { color: colors.ink, fontWeight: '900', fontSize: 20, textAlign: 'center', marginTop: 9 },
  modalNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  modalMeta: { color: colors.green, fontWeight: '700', fontSize: 11, textAlign: 'center', marginTop: 3 },
  modalBio: { color: colors.muted, fontSize: 12, lineHeight: 18, marginVertical: 13 },
  modalSectionLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  modalSectionTitle: { color: colors.ink, fontWeight: '900', fontSize: 14 },
  modalRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  modalRatingText: { color: colors.ink, fontWeight: '700', fontSize: 11 },
  serviceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line },
  serviceName: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  servicePrice: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  noServices: { color: colors.muted, fontSize: 12, paddingVertical: 12 },
  providerReviewsSection: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 13, marginTop: 13 },
  providerReviewCard: { backgroundColor: colors.white, borderRadius: 12, padding: 11, marginTop: 8 },
  providerReviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  providerReviewReviewer: { flex: 1 },
  providerReviewName: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  providerReviewDate: { color: colors.muted, fontSize: 9, marginTop: 3 },
  providerReviewRating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  providerReviewComment: { color: colors.ink, fontSize: 11, lineHeight: 16, marginTop: 8 },
  reviewBox: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 13, marginTop: 13 },
  reviewHelp: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 5 },
  reviewChatButton: { minHeight: 40, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 8 },
  reviewChatButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 11 },
  stars: { flexDirection: 'row', gap: 8, marginTop: 9 },
  reviewInput: { minHeight: 42, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, color: colors.ink, fontSize: 11, marginTop: 8 },
  reviewButton: { backgroundColor: colors.green, borderRadius: 11, alignItems: 'center', padding: 11, marginTop: 8 },
  reviewButtonDisabled: { opacity: 0.6 },
  reviewButtonText: { color: colors.buttonText, fontWeight: '800', fontSize: 11 },
  reviewSuccess: { color: colors.green, fontSize: 11, marginTop: 6 },
  contactActions: { gap: 8, marginTop: 14 },
  phoneLoader: { marginVertical: 8 },
  callButton: { backgroundColor: colors.green, borderRadius: 13, alignItems: 'center', padding: 14 },
  actionText: { color: colors.buttonText, fontWeight: '800', fontSize: 13 },
});
