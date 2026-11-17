import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AppIcon } from '../components/AppIcon';
import { ScreenHeading } from '../components/ScreenHeading';
import { useLanguage } from '../context/LanguageContext';
import { demoProviders } from '../data/demo';
import { supabase } from '../lib/supabase';
import { colors, radius } from '../theme';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { formatLocalizedExperience } from '../lib/formatLocalizedExperience';
import { VerifiedBadge } from '../components/VerifiedBadge';
import type { ProviderAvailability, ProviderListing } from '../types';

function getAvailability(provider: ProviderListing): ProviderAvailability {
  return provider.availabilityStatus ?? (provider.active ? 'active' : 'inactive');
}

function availabilityLabel(status: ProviderAvailability, translate: (text: string) => string) {
  return translate(status === 'active' ? 'Available' : status === 'busy' ? 'Busy' : 'Unavailable');
}

export function MapScreen({ demoMode }: { demoMode: boolean }) {
  const { t, isRTL } = useLanguage();
  const [selected, setSelected] = useState<ProviderListing | null>(null);
  const [providers, setProviders] = useState<ProviderListing[]>(demoProviders);
  const [mapError, setMapError] = useState('');

  useFocusEffect(useCallback(() => {
    if (demoMode || !supabase) {
      setProviders(demoProviders);
      return;
    }

    let active = true;

    async function loadMapProviders() {
      setMapError('');
      const { data, error: providerError } = await supabase!
        .from('provider_profiles')
        .select('id,profile_id,category,bio,experience_years,is_active,availability_status,verification_status,lat,lng,provider_services(task_name,price,is_starting_from,is_negotiable)')
        .in('availability_status', ['active', 'busy']);
      if (providerError) {
        if (active) setMapError(providerError.code === '42703'
          ? t('Provider verification database setup is missing. Apply the CNIC verification migration, then reload this screen.')
          : providerError.message);
        return;
      }

      const rows = data ?? [];
      const ids = rows.map((row) => row.profile_id);
      const { data: profiles, error: profileError } = ids.length
        ? await supabase!.from('public_profiles').select('id,name').in('id', ids)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const { data: reviewRows, error: reviewError } = ids.length
        ? await supabase!.from('reviews').select('to_profile_id,rating').in('to_profile_id', ids)
        : { data: [], error: null };
      if (reviewError) throw reviewError;
      const ratingsByProfile = new Map<string, { total: number; count: number }>();
      for (const review of reviewRows ?? []) {
        const rating = ratingsByProfile.get(review.to_profile_id) ?? { total: 0, count: 0 };
        rating.total += Number(review.rating);
        rating.count += 1;
        ratingsByProfile.set(review.to_profile_id, rating);
      }

      const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      if (active) {
        const nextProviders = rows.map((row) => {
          const name = profileById.get(row.profile_id)?.name ?? 'Service provider';
          const rating = ratingsByProfile.get(row.profile_id);
          return {
            id: row.id,
            profileId: row.profile_id,
            name,
            category: row.category,
            bio: row.bio ?? '',
            experience: row.experience_years ?? 0,
            rating: rating ? rating.total / rating.count : 0,
            reviews: rating?.count ?? 0,
            distance: 'Nearby',
            active: row.is_active,
            availabilityStatus: row.availability_status,
            isVerified: row.verification_status === 'verified',
            latitude: row.lat,
            longitude: row.lng,
            avatar: name.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase(),
            services: (row.provider_services ?? []).map((service) => ({
              name: service.task_name,
              price: Number(service.price),
              startingFrom: service.is_starting_from,
              negotiable: service.is_negotiable,
            })),
          };
        });
        setProviders(nextProviders);
        setSelected((current) => current
          ? nextProviders.find((provider) => provider.id === current.id) ?? null
          : null);
      }
    }

    void loadMapProviders().catch((error: unknown) => {
      if (active) setMapError(error instanceof Error ? error.message : t('Unable to load map listings.'));
    });
    return () => { active = false; };
  }, [demoMode, t]));

  return (
    <View style={[styles.screen, getLayoutDirectionStyle(isRTL)]}>
      <ScreenHeading style={styles.headingBox}>
        <AppIcon color={colors.ink} name="mapPin" size={40} />
        <Text style={[styles.title, isRTL && styles.rtlText]}>{t('Map view is available on mobile')}</Text>
        <Text style={[styles.copy, isRTL && styles.rtlText]}>
          {t('Open this Expo project on iOS or Android to explore nearby providers on the map.')}
        </Text>
      </ScreenHeading>
      {mapError ? <Text accessibilityRole="alert" style={styles.error}>{t('Could not load map listings:')} {mapError}</Text> : null}
      {providers.map((provider) => (
        <Pressable
          accessibilityRole="button"
          key={provider.id}
          onPress={() => setSelected(provider)}
          style={[styles.row, getLayoutDirectionStyle(isRTL)]}
        >
          <View style={styles.nameRow}>
            <Text style={[styles.name, isRTL && styles.rtlText]}>{provider.name}</Text>
            {provider.isVerified ? <VerifiedBadge /> : null}
          </View>
          <Text style={[styles.category, isRTL && styles.rtlText]}>{t(provider.category)} · {provider.distance}</Text>
          <Text style={[styles.status, isRTL && styles.rtlText]}>{availabilityLabel(getAvailability(provider), t)}</Text>
        </Pressable>
      ))}
      {selected ? (
        <View style={[styles.details, getLayoutDirectionStyle(isRTL)]}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, isRTL && styles.rtlText]}>{selected.name}</Text>
            {selected.isVerified ? <VerifiedBadge /> : null}
          </View>
          <View style={styles.ratingRow}>
            <Text style={[styles.category, isRTL && styles.rtlText]}>
              {t(selected.category)} · {formatLocalizedExperience(selected.experience, t('years of experience'))} ·
            </Text>
            <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={12} />
            <Text style={styles.category}>{selected.rating.toFixed(1)}</Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={[styles.status, isRTL && styles.rtlText]}>{availabilityLabel(getAvailability(selected), t)}</Text>
          </View>
          <Text style={[styles.bio, isRTL && styles.rtlText]}>{selected.bio || t('No introduction provided.')}</Text>
          {selected.services.map((service) => (
            <Text key={service.name} style={[styles.service, isRTL && styles.rtlText]}>
              {service.name} · Rs. {service.price.toLocaleString()}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: 24,
    justifyContent: 'center',
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headingBox: { alignItems: 'center', marginBottom: 18 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '900', textAlign: 'center', marginTop: 10 },
  copy: { color: colors.ink, opacity: 0.84, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  rtlText: { textAlign: 'right' },
  row: { backgroundColor: colors.white, borderRadius: 14, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: colors.line },
  name: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  category: { color: colors.muted, fontSize: 11, marginTop: 4 },
  status: { color: colors.ink, fontSize: 11, fontWeight: '700', marginTop: 6 },
  details: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  statusBadge: { alignSelf: 'flex-start', backgroundColor: colors.mint, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, marginTop: 8 },
  bio: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  service: { color: colors.ink, fontSize: 11, marginTop: 8 },
  error: { color: colors.coral, fontSize: 12, lineHeight: 18, marginBottom: 12 },
});
