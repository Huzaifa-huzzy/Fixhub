import { useCallback, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppIcon } from '../components/AppIcon';
import ClusteredMapView from 'react-native-map-clustering';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useAppSession } from '../context/AppSessionContext';
import { useLanguage } from '../context/LanguageContext';
import { demoProviders } from '../data/demo';
import { supabase } from '../lib/supabase';
import { colors, radius } from '../theme';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { distanceKm, type Coordinate } from '../lib/geo';
import { formatLocalizedExperience } from '../lib/formatLocalizedExperience';
import { VerifiedBadge } from '../components/VerifiedBadge';
import type { ProviderListing } from '../types';

type MapCamera = Pick<MapView, 'animateToRegion'>;
type NearbyProviderRow = {
  provider_profile_id: string;
  profile_id: string;
  name: string | null;
  avatar_url: string | null;
  category: string;
  bio: string | null;
  experience_years: number;
  availability_status: 'active' | 'busy' | 'inactive';
  is_online: boolean;
  last_seen_at: string | null;
  location_updated_at: string | null;
  provider_lat: number;
  provider_lng: number;
  distance_km: number;
  average_rating: number;
  review_count: number;
  services: ProviderListing['services'];
};

const initialRegion: Region = {
  latitude: 31.514,
  longitude: 74.355,
  latitudeDelta: 0.045,
  longitudeDelta: 0.045,
};

const nearMeRadiusKm = 10;

function formatMapTimestamp(value: string | null | undefined, translate: (text: string) => string) {
  if (!value) return translate('Time unavailable');
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? translate('Time unavailable') : timestamp.toLocaleString();
}

function isMapCamera(value: unknown): value is MapCamera {
  return typeof value === 'object'
    && value !== null
    && 'animateToRegion' in value
    && typeof value.animateToRegion === 'function';
}

const demoCoordinates: Record<string, Coordinate> = {
  'demo-1': { latitude: 31.514, longitude: 74.355 },
  'demo-2': { latitude: 31.526, longitude: 74.342 },
  'demo-3': { latitude: 31.501, longitude: 74.368 },
};

function regionAround(coordinate: Coordinate, radiusKm: number): Region {
  const latitudeDelta = (radiusKm * 2) / 110.574;
  const longitudeDelta = Math.min(
    360,
    (radiusKm * 2) / (111.32 * Math.max(Math.abs(Math.cos(coordinate.latitude * Math.PI / 180)), 0.01)),
  );
  return { ...coordinate, latitudeDelta, longitudeDelta };
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function getLongitudeBounds(viewport: Region) {
  if (viewport.longitudeDelta >= 360) return { min: -180, max: 180 };
  return {
    min: normalizeLongitude(viewport.longitude - viewport.longitudeDelta / 2),
    max: normalizeLongitude(viewport.longitude + viewport.longitudeDelta / 2),
  };
}

function isInLongitudeBounds(longitude: number, bounds: { min: number; max: number }) {
  return bounds.min <= bounds.max
    ? longitude >= bounds.min && longitude <= bounds.max
    : longitude >= bounds.min || longitude <= bounds.max;
}

function ProviderMarker({
  provider,
  coordinate,
  isOnline,
  onPress,
}: {
  provider: ProviderListing;
  coordinate: Coordinate;
  isOnline: boolean;
  onPress: () => void;
}) {
  const { t } = useLanguage();
  const [imageLoaded, setImageLoaded] = useState(!provider.avatarUrl);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
      tracksViewChanges={!imageLoaded}
      zIndex={2}
    >
      <View style={styles.markerContainer}>
        <View style={[styles.markerImageRing, !isOnline && styles.markerImageRingOffline]}>
          {provider.avatarUrl && !imageFailed ? (
            <Image
              onError={() => { setImageFailed(true); setImageLoaded(true); }}
              onLoad={() => setImageLoaded(true)}
              source={{ uri: provider.avatarUrl }}
              style={styles.markerImage}
            />
          ) : (
            <Text style={styles.markerInitials}>{provider.avatar}</Text>
          )}
        </View>
        <View style={styles.markerRating}>
          <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={10} />
          <Text style={styles.markerRatingText}>{provider.rating ? provider.rating.toFixed(1) : 'New'}</Text>
        </View>
        {!isOnline ? (
          <View style={styles.markerOfflineBadge}>
            <Text style={styles.markerOfflineText}>{t('Offline')}</Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
}

export function MapScreen({ demoMode }: { demoMode: boolean }) {
  const { t, isRTL } = useLanguage();
  const { profile } = useAppSession();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const [providers, setProviders] = useState<ProviderListing[]>([]);
  const [selected, setSelected] = useState<ProviderListing | null>(null);
  const [userCoordinate, setUserCoordinate] = useState<Coordinate | null>(null);
  const [deviceLocationGranted, setDeviceLocationGranted] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [city, setCity] = useState('');
  const [mapSearch, setMapSearch] = useState('');
  const [mapError, setMapError] = useState('');
  const [distanceLimitKm, setDistanceLimitKm] = useState<number | null>(null);
  const mapRef = useRef<MapCamera | null>(null);
  const viewportRef = useRef<Region>(initialRegion);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const distanceLimitKmRef = useRef<number | null>(null);
  const normalizedMapSearch = mapSearch.trim().toLocaleLowerCase();
  const visibleProviders = normalizedMapSearch
    ? providers.filter((provider) => (
      provider.category.toLocaleLowerCase().includes(normalizedMapSearch)
      || provider.services.some((service) => service.name.toLocaleLowerCase().includes(normalizedMapSearch))
    ))
    : providers;

  useFocusEffect(useCallback(() => {
    if (!demoMode) setSelected(null);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [demoMode]));

  const loadNearby = useCallback(async (
    origin: Coordinate,
    viewport: Region,
    distanceLimitKm: number | null = null,
  ) => {
    const requestId = ++requestIdRef.current;
    const longitudeBounds = getLongitudeBounds(viewport);
    setLoading(true);
    setMapError('');

    try {
      let nextProviders: ProviderListing[];
      if (demoMode || !supabase) {
        nextProviders = demoProviders.flatMap((provider) => {
          const coordinate = demoCoordinates[provider.id];
          if (!provider.active || !coordinate) return [];
          const distance = distanceKm(origin, coordinate);
          if (distanceLimitKm != null && distance > distanceLimitKm) return [];
          if (coordinate.latitude < viewport.latitude - viewport.latitudeDelta / 2
            || coordinate.latitude > viewport.latitude + viewport.latitudeDelta / 2
            || !isInLongitudeBounds(coordinate.longitude, longitudeBounds)) return [];
          return [{
            ...provider,
            isOnline: true,
            lastSeenAt: new Date().toISOString(),
            locationUpdatedAt: new Date().toISOString(),
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            distance: `${distance.toFixed(1)} km ${t('away')}`,
          }];
        });
      } else {
        const { data, error } = await supabase.rpc('map_providers', {
          latitude: origin.latitude,
          longitude: origin.longitude,
          min_lat: viewport.latitude - viewport.latitudeDelta / 2,
          max_lat: viewport.latitude + viewport.latitudeDelta / 2,
          min_lng: longitudeBounds.min,
          max_lng: longitudeBounds.max,
        });
        if (error) throw error;
        const rows = (data ?? []) as NearbyProviderRow[];
        nextProviders = rows.filter((row) => (
          distanceLimitKm == null || Number(row.distance_km) <= distanceLimitKm
        )).map((row) => {
          const name = row.name ?? t('Service provider');
          return {
            id: row.provider_profile_id,
            profileId: row.profile_id,
            name,
            category: row.category,
            bio: row.bio ?? '',
            experience: row.experience_years ?? 0,
            rating: Number(row.average_rating) || 0,
            reviews: Number(row.review_count) || 0,
            distance: `${Number(row.distance_km).toFixed(1)} km ${t('away')}`,
            active: true,
            availabilityStatus: row.availability_status,
            isOnline: row.is_online,
            lastSeenAt: row.last_seen_at,
            locationUpdatedAt: row.location_updated_at,
            isVerified: true,
            latitude: row.provider_lat,
            longitude: row.provider_lng,
            avatar: name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
            avatarUrl: row.avatar_url,
            services: row.services ?? [],
          };
        });
      }

      if (requestId !== requestIdRef.current) return;
      setProviders(nextProviders);
      setSelected((current) => current
        ? nextProviders.find((provider) => provider.id === current.id) ?? null
        : null);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setMapError(error instanceof Error ? error.message : t('Unable to load nearby providers.'));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [demoMode, t]);

  useFocusEffect(useCallback(() => {
    if (!userCoordinate) return undefined;
    void loadNearby(userCoordinate, viewportRef.current, distanceLimitKmRef.current);
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        void loadNearby(userCoordinate, viewportRef.current, distanceLimitKmRef.current);
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [loadNearby, userCoordinate]));

  function onMapRegionChange(nextRegion: Region) {
    viewportRef.current = nextRegion;
    if (!userCoordinate) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadNearby(userCoordinate, nextRegion, distanceLimitKmRef.current);
    }, 500);
  }

  async function centerOnUser() {
    setLocating(true);
    setMapError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        distanceLimitKmRef.current = null;
        setDistanceLimitKm(null);
        setProviders([]);
        setSelected(null);
        setUserCoordinate(null);
        setDeviceLocationGranted(false);
        setLocationDenied(true);
        setMapError(t('Enable location or search for a city to see nearby providers.'));
        return;
      }
      const location = await Location.getCurrentPositionAsync({});
      const coordinate = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      const nextRegion = regionAround(coordinate, nearMeRadiusKm);
      viewportRef.current = nextRegion;
      distanceLimitKmRef.current = nearMeRadiusKm;
      setDistanceLimitKm(nearMeRadiusKm);
      setLocationDenied(false);
      setDeviceLocationGranted(true);
      setUserCoordinate(coordinate);
      setSelected(null);
      mapRef.current?.animateToRegion(nextRegion, 500);
      await loadNearby(coordinate, nextRegion, nearMeRadiusKm);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : t('Unable to get your location.'));
    } finally {
      setLocating(false);
    }
  }

  async function searchCity() {
    const query = city.trim();
    if (!query) {
      setMapError(t('Enter a city or area name.'));
      return;
    }
    setLocating(true);
    setMapError('');
    try {
      const results = await Location.geocodeAsync(query);
      if (!results.length) {
        setMapError(t('No matching area was found.'));
        return;
      }
      const coordinate = { latitude: results[0].latitude, longitude: results[0].longitude };
      const nextRegion = regionAround(coordinate, 30);
      viewportRef.current = nextRegion;
      distanceLimitKmRef.current = null;
      setDistanceLimitKm(null);
      setLocationDenied(false);
      setDeviceLocationGranted(false);
      setUserCoordinate(coordinate);
      mapRef.current?.animateToRegion(nextRegion, 500);
      await loadNearby(coordinate, nextRegion);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : t('Unable to search this area.'));
    } finally {
      setLocating(false);
    }
  }

  async function callProvider() {
    if (!selected || !supabase || demoMode) {
      Alert.alert(t('Calling unavailable'), t('Connect an account to contact this provider.'));
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_public_provider_phones', {
        target_provider_profile_id: selected.id,
      });
      if (error) throw error;
      const phone = Array.isArray(data) ? data.find((item): item is string => typeof item === 'string') : null;
      if (!phone) {
        Alert.alert(t('Calling unavailable'), t('This provider has not enabled direct calls.'));
        return;
      }
      const dialerUrl = `tel:${phone}`;
      if (await Linking.canOpenURL(dialerUrl)) await Linking.openURL(dialerUrl);
      else Alert.alert(t('Calling unavailable'), t('This device cannot place phone calls.'));
    } catch (error) {
      Alert.alert(t('Unable to call provider'), error instanceof Error ? error.message : t('Please try again.'));
    }
  }

  async function chatWithProvider() {
    if (!selected || !profile || !supabase || demoMode) {
      Alert.alert(t('Chat unavailable'), t('Sign in to chat with this provider.'));
      return;
    }
    if (profile.id === selected.profileId) {
      Alert.alert(t('Chat unavailable'), t('You cannot start a chat with your own profile.'));
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_or_create_chat', {
        other_profile_id: selected.profileId,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error(t('Could not start this chat.'));
      router.push({
        pathname: '/chat/[chatId]',
        params: {
          chatId: data,
          otherProfileId: selected.profileId,
          providerName: selected.name,
        },
      });
    } catch (error) {
      Alert.alert(t('Unable to open chat'), error instanceof Error ? error.message : t('Please try again.'));
    }
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.webScreen, getLayoutDirectionStyle(isRTL)]}>
        <AppIcon color={colors.ink} name="mapPin" size={40} />
        <Text style={styles.webTitle}>{t('Map view is available on mobile')}</Text>
        <Text style={styles.webCopy}>{t('Open this Expo project on iOS or Android to explore nearby providers on the map.')}</Text>
        {demoProviders.filter((provider) => provider.active).map((provider) => (
          <Pressable key={provider.id} onPress={() => setSelected(provider)} style={styles.webProvider}>
            <View style={styles.webAvatar}>
              <Text style={styles.markerInitials}>{provider.avatar}</Text>
            </View>
            <View style={styles.webCopyBlock}>
              <Text style={styles.webName}>{provider.name}</Text>
              <View style={styles.webProviderMeta}>
                <Text style={styles.webDetails}>{t(provider.category)} ·</Text>
                <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={11} />
                <Text style={styles.webDetails}>{provider.rating.toFixed(1)}</Text>
              </View>
            </View>
          </Pressable>
        ))}
        {selected ? (
          <View style={styles.webDetailsCard}>
            <Text style={styles.webName}>{selected.name}</Text>
            <View style={styles.webProviderMeta}>
              <Text style={styles.webDetails}>{t(selected.category)} ·</Text>
              <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={11} />
              <Text style={styles.webDetails}>{selected.rating.toFixed(1)}</Text>
            </View>
            <Text style={styles.webDetails}>{selected.bio}</Text>
            {selected.services.map((service) => (
              <Text key={service.name} style={styles.webDetails}>
                {service.name} · Rs. {service.price.toLocaleString()}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ClusteredMapView
        clusterColor={colors.ink}
        clusterTextColor={colors.white}
        initialRegion={initialRegion}
        mapRef={(map) => { mapRef.current = isMapCamera(map) ? map : null; }}
        onRegionChangeComplete={onMapRegionChange}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        radius={48}
        showsMyLocationButton={false}
        showsUserLocation={deviceLocationGranted}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle="light"
      >
        {visibleProviders.map((provider) => (
          provider.latitude != null && provider.longitude != null ? (
            <ProviderMarker
              coordinate={{ latitude: provider.latitude, longitude: provider.longitude }}
              key={`${provider.id}:${provider.isOnline ? 'online' : 'offline'}`}
              isOnline={provider.isOnline === true}
              onPress={() => setSelected(provider)}
              provider={provider}
            />
          ) : null
        ))}
      </ClusteredMapView>

      <View style={[styles.topBadge, { top: 12 }, isRTL && styles.topBadgeRtl]}>
        <Text style={styles.topBadgeTitle}>{t('NEARBY PROFESSIONALS')}</Text>
        <Text style={styles.topBadgeSubtext}>
          {userCoordinate
            ? `${visibleProviders.length} ${t(distanceLimitKm === nearMeRadiusKm
              ? 'verified providers within 10 km'
              : 'verified providers in this map area')}`
            : t('Tap Near Me to show verified providers in this map area')}
        </Text>
      </View>
      <View style={[styles.mapSearch, { top: 84 }, getLayoutDirectionStyle(isRTL)]}>
        <AppIcon color={colors.muted} name="search" size={20} />
        <TextInput
          accessibilityLabel={t('Search providers by category')}
          onChangeText={(value) => {
            setMapSearch(value);
            setSelected(null);
          }}
          placeholder={t('Search category (e.g. Electrician)')}
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={[styles.mapSearchInput, isRTL && styles.rtlInput]}
          value={mapSearch}
        />
        {mapSearch.length > 0 ? (
          <Pressable
            accessibilityLabel={t('Clear map search')}
            accessibilityRole="button"
            onPress={() => setMapSearch('')}
            style={styles.clearMapSearch}
          >
            <AppIcon color={colors.buttonText} name="x" size={18} />
          </Pressable>
        ) : null}
      </View>
      {mapError ? (
        <View style={[styles.mapError, { top: 140 }]}>
          <Text style={styles.mapErrorText}>{mapError}</Text>
        </View>
      ) : null}
      {userCoordinate && !loading && visibleProviders.length === 0 && !mapError ? (
        <View style={[styles.emptyProviders, { top: 140 }]}>
          <Text style={styles.emptyProvidersText}>
            {normalizedMapSearch
              ? t('No providers match this search in the map area.')
              : t('No active verified providers with a map location were found in this map area.')}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel={t('Find providers near me')}
        accessibilityRole="button"
        disabled={locating}
        onPress={() => void centerOnUser()}
        style={[styles.nearMeButton, { bottom: safeAreaBottom + 24 }, isRTL && styles.nearMeButtonRtl]}
      >
        {locating
          ? <ActivityIndicator color={colors.buttonText} />
          : <View style={styles.nearMeContent}><AppIcon color={colors.buttonText} name="locateFixed" size={16} /><Text style={styles.nearMeText}>{t('Near Me')}</Text></View>}
      </Pressable>

      {locationDenied ? (
        <View style={styles.locationFallback}>
          <Text style={styles.fallbackTitle}>{t('Location permission needed')}</Text>
          <Text style={styles.fallbackCopy}>{t('Enable location or search for a city to see nearby providers.')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void Linking.openSettings().catch((error: unknown) => {
                setMapError(error instanceof Error ? error.message : t('Unable to open location settings.'));
              });
            }}
            style={styles.settingsButton}
          >
            <Text style={styles.settingsButtonText}>{t('Open location settings')}</Text>
          </Pressable>
          <TextInput
            accessibilityLabel={t('Enter area or city')}
            onChangeText={setCity}
            onSubmitEditing={() => void searchCity()}
            placeholder={t('Enter area or city')}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.cityInput}
            value={city}
          />
          <Pressable accessibilityRole="button" onPress={() => void searchCity()} style={styles.fallbackButton}>
            <Text style={styles.fallbackButtonText}>{t('Search this area')}</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={[styles.loadingBadge, { top: 140 }]}>
          <ActivityIndicator color={colors.ink} size="small" />
          <Text style={styles.loadingText}>{t('Finding providers in this map area…')}</Text>
        </View>
      ) : null}

      {selected ? (
        <View style={[styles.providerCard, getLayoutDirectionStyle(isRTL)]}>
          <Pressable
            accessibilityLabel={t('Close selected provider')}
            onPress={() => setSelected(null)}
            style={[styles.dismiss, isRTL && styles.dismissRtl]}
          >
            <AppIcon color={colors.buttonText} name="x" size={20} />
          </Pressable>
          <ScrollView contentContainerStyle={styles.detailScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.providerHeader}>
              <View style={styles.detailAvatar}>
                {selected.avatarUrl
                  ? <Image accessibilityLabel={`${selected.name} profile photo`} source={{ uri: selected.avatarUrl }} style={styles.detailAvatarImage} />
                  : <Text style={styles.detailAvatarText}>{selected.avatar}</Text>}
              </View>
              <View style={styles.providerCopy}>
                <View style={styles.mapNameRow}>
                  <Text style={styles.providerName}>{selected.name}</Text>
                  {selected.isVerified ? <VerifiedBadge /> : null}
                </View>
                <Text style={styles.providerMeta}>{t(selected.category)}</Text>
                <View style={styles.providerRating}>
                  <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={12} />
                  <Text style={styles.providerRatingText}>
                    {selected.rating ? selected.rating.toFixed(1) : t('New')}
                    {selected.reviews > 0 ? ` · ${selected.reviews} ${t('reviews')}` : ''}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.providerDistance}>{selected.distance}</Text>
            <Text style={styles.providerAvailability}>
              {t('Service availability:')} {t(selected.availabilityStatus === 'busy' ? 'Busy' : 'Available')}
            </Text>
            <Text style={[styles.providerConnectivity, !selected.isOnline && styles.providerOffline]}>
              {t(selected.isOnline ? 'Online' : 'Offline')}
              {selected.lastSeenAt
                ? ` · ${t('Last seen')}: ${formatMapTimestamp(selected.lastSeenAt, t)}`
                : ` · ${t('No online update yet')}`}
            </Text>
            <Text style={styles.providerLocationTimestamp}>
              {t('Location last updated')}: {formatMapTimestamp(selected.locationUpdatedAt, t)}
            </Text>
            <Text style={styles.providerBio}>{selected.bio || t('No introduction provided.')}</Text>
            <Text style={styles.providerDetails}>
              {formatLocalizedExperience(selected.experience, t('years of experience'))}
            </Text>
            <Text style={styles.serviceHeading}>{t('Services and prices')}</Text>
            {selected.services.length ? selected.services.map((service) => (
              <View key={service.name} style={styles.serviceRow}>
                <Text style={styles.serviceName}>{service.name}</Text>
                <Text style={styles.servicePrice}>
                  {service.startingFrom ? `${t('From')} ` : ''}Rs. {service.price.toLocaleString()}
                  {service.negotiable ? ` · ${t('Negotiable')}` : ''}
                </Text>
              </View>
            )) : <Text style={styles.noServices}>{t('No services or prices listed.')}</Text>}
            <View style={styles.contactActions}>
              <Pressable accessibilityRole="button" onPress={() => void callProvider()} style={styles.contactButton}>
                <Text style={styles.contactButtonText}>{t('Call')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void chatWithProvider()} style={styles.contactButtonPrimary}>
                <Text style={styles.contactButtonTextPrimary}>{t('Chat')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F5F5' },
  topBadge: { position: 'absolute', left: 16, maxWidth: '80%', backgroundColor: colors.white, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11, shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  topBadgeRtl: { left: undefined, right: 16, alignItems: 'flex-end' },
  topBadgeTitle: { color: colors.ink, fontWeight: '900', letterSpacing: 1, fontSize: 9 },
  topBadgeSubtext: { color: colors.muted, fontSize: 10, marginTop: 4 },
  mapSearch: { position: 'absolute', left: 16, right: 16, minHeight: 46, backgroundColor: colors.white, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', elevation: 4, shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 7, shadowOffset: { width: 0, height: 2 } },
  mapSearchInput: { flex: 1, minHeight: 46, color: colors.ink, fontSize: 13, paddingVertical: 0 },
  rtlInput: { textAlign: 'right' },
  clearMapSearch: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 9 },
  clearMapSearchText: { color: colors.muted, fontSize: 23, lineHeight: 26 },
  mapError: { position: 'absolute', left: 16, right: 16, backgroundColor: colors.white, borderRadius: 12, padding: 11 },
  mapErrorText: { color: colors.coral, fontSize: 11, lineHeight: 16 },
  emptyProviders: { position: 'absolute', left: 18, right: 18, backgroundColor: colors.white, borderRadius: 13, padding: 13, elevation: 3 },
  emptyProvidersText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  nearMeButton: { position: 'absolute', right: 16, minHeight: 50, backgroundColor: colors.green, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 17, elevation: 5, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  nearMeButtonRtl: { right: undefined, left: 16 },
  nearMeContent: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  nearMeText: { color: colors.buttonText, fontSize: 12, fontWeight: '800' },
  locationFallback: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.white, padding: 24, justifyContent: 'center', elevation: 8 },
  fallbackTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  fallbackCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  cityInput: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, color: colors.ink, marginTop: 15 },
  fallbackButton: { minHeight: 46, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  fallbackButtonText: { color: colors.buttonText, fontSize: 12, fontWeight: '800' },
  settingsButton: { alignSelf: 'flex-start', backgroundColor: colors.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  settingsButtonText: { color: colors.buttonText, fontSize: 11, fontWeight: '800' },
  loadingBadge: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, paddingHorizontal: 13, paddingVertical: 9, borderRadius: radius.pill, elevation: 3 },
  loadingText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  markerContainer: { alignItems: 'center', width: 66 },
  markerImageRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: '#16A34A', backgroundColor: colors.white, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  markerImageRingOffline: { borderColor: '#737373' },
  markerImage: { width: '100%', height: '100%' },
  markerInitials: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  markerRating: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: -4, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, elevation: 3 },
  markerRatingText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  markerOfflineBadge: { marginTop: 2, backgroundColor: '#525252', borderRadius: radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  markerOfflineText: { color: colors.white, fontSize: 7, fontWeight: '900' },
  providerCard: { position: 'absolute', left: 12, right: 12, bottom: 12, maxHeight: '65%', backgroundColor: colors.white, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8, borderRadius: radius.card, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  detailScroll: { paddingBottom: 10 },
  dismiss: { position: 'absolute', right: 10, top: 6, zIndex: 2, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 9 },
  dismissRtl: { right: undefined, left: 10 },
  providerHeader: { flexDirection: 'row', alignItems: 'center', paddingRight: 20 },
  detailAvatar: { width: 64, height: 64, borderRadius: 21, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  detailAvatarImage: { width: '100%', height: '100%' },
  detailAvatarText: { color: colors.ink, fontWeight: '900', fontSize: 16 },
  providerCopy: { flex: 1, marginLeft: 12 },
  mapNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  providerName: { color: colors.ink, fontWeight: '900', fontSize: 15 },
  providerMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  providerRating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  providerRatingText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  providerDistance: { color: colors.ink, fontSize: 11, fontWeight: '800', marginTop: 12 },
  providerAvailability: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 5 },
  providerConnectivity: { color: colors.green, fontSize: 11, fontWeight: '800', marginTop: 5 },
  providerOffline: { color: '#525252' },
  providerLocationTimestamp: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  providerBio: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  providerDetails: { color: colors.ink, fontSize: 11, fontWeight: '700', marginTop: 7 },
  serviceHeading: { color: colors.ink, fontSize: 12, fontWeight: '900', marginTop: 14, marginBottom: 2 },
  serviceRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9, marginTop: 8, gap: 12 },
  serviceName: { color: colors.ink, fontSize: 11, flex: 1 },
  servicePrice: { color: colors.ink, fontSize: 11, fontWeight: '800', maxWidth: '58%', textAlign: 'right' },
  noServices: { color: colors.muted, fontSize: 11, marginTop: 8 },
  contactActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  contactButton: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.green, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  contactButtonPrimary: { flex: 1, minHeight: 46, backgroundColor: colors.green, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  contactButtonText: { color: colors.buttonText, fontSize: 12, fontWeight: '800' },
  contactButtonTextPrimary: { color: colors.buttonText, fontSize: 12, fontWeight: '800' },
  webScreen: { flex: 1, backgroundColor: colors.paper, padding: 24, justifyContent: 'center', maxWidth: 560, alignSelf: 'center', width: '100%' },
  webTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', textAlign: 'center', marginTop: 10 },
  webCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7, marginBottom: 18 },
  webProvider: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, marginTop: 8 },
  webAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  webCopyBlock: { flex: 1 },
  webName: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  webDetails: { color: colors.muted, fontSize: 11, marginTop: 5 },
  webProviderMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  webDetailsCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, marginTop: 10 },
});
