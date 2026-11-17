import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useLanguage } from '../context/LanguageContext';
import { colors, radius } from '../theme';
import { formatLocalizedExperience } from '../lib/formatLocalizedExperience';
import type { ProviderListing } from '../types';
import { VerifiedBadge } from './VerifiedBadge';

export function ProviderCard({
  provider,
  onPress,
}: {
  provider: ProviderListing;
  onPress: () => void;
}) {
  const { t, isRTL } = useLanguage();
  const startingPrice = Math.min(...provider.services.map((service) => service.price));
  const availability = provider.availabilityStatus
    ?? (provider.active ? 'active' : 'inactive');

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.avatar}>
          {provider.avatarUrl
            ? <Image source={{ uri: provider.avatarUrl }} style={styles.avatarImage} />
            : (
              <>
                <View style={styles.avatarHead} />
                <View style={styles.avatarNeck} />
                <View style={styles.avatarShoulders} />
              </>
            )}
        </View>
        <View style={styles.details}>
          <View style={styles.nameLine}>
            <View style={styles.providerName}>
              <Text style={styles.name}>{provider.name}</Text>
              {provider.isVerified ? <VerifiedBadge /> : null}
            </View>
            <View style={styles.rating}>
              <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={12} />
              <Text style={styles.ratingText}>{provider.rating}</Text>
            </View>
          </View>
          <Text style={[styles.category, isRTL && styles.rtlText]}>{t(provider.category)} · {formatLocalizedExperience(provider.experience, t('years of experience'))}</Text>
          <Text numberOfLines={2} style={[styles.bio, isRTL && styles.rtlText]}>{provider.bio}</Text>
        </View>
      </View>
      <View style={styles.bottom}>
        <View style={styles.distance}>
          <AppIcon color={colors.muted} name="mapPin" size={13} />
          <Text style={styles.distanceText}>{t(provider.distance)}</Text>
        </View>
        <View style={styles.priceLine}>
          {Number.isFinite(startingPrice) ? (
            <>
              <Text style={styles.priceLabel}>{t('From ')}</Text>
              <Text style={styles.price}>Rs. {startingPrice.toLocaleString()}</Text>
              <Text style={styles.perJob}>{t(' / task')}</Text>
            </>
          ) : <Text style={styles.perJob}>{t('No prices listed')}</Text>}
        </View>
        <View style={[styles.status, availability === 'active' ? styles.active : styles.inactive]}>
          <View style={[
            styles.dot,
            availability === 'active' ? styles.activeDot : availability === 'busy' ? styles.busyDot : styles.inactiveDot,
          ]} />
          <Text style={styles.statusText}>
            {t(availability === 'active' ? 'Available' : availability === 'busy' ? 'Busy' : 'Unavailable')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 0,
  },
  rtlText: { textAlign: 'right' },
  pressed: { opacity: 0.88 },
  top: { flexDirection: 'row', gap: 13 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarHead: { position: 'absolute', top: 9, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.white },
  avatarNeck: { position: 'absolute', top: 24, width: 8, height: 8, backgroundColor: colors.white },
  avatarShoulders: { position: 'absolute', bottom: 0, width: 38, height: 23, borderTopLeftRadius: 19, borderTopRightRadius: 19, backgroundColor: colors.white },
  details: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  providerName: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.mint, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.pill, marginLeft: 8 },
  ratingText: { color: colors.ink, fontWeight: '800', fontSize: 11 },
  category: { color: colors.green, fontWeight: '700', fontSize: 12, marginTop: 4 },
  bio: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  bottom: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 15,
    paddingTop: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  distance: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  distanceText: { color: colors.muted, fontSize: 11 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', backgroundColor: colors.mint, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 10 },
  priceLabel: { color: colors.muted, fontSize: 10 },
  price: { color: colors.ink, fontWeight: '800', fontSize: 12 },
  perJob: { color: colors.muted, fontSize: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.pill },
  active: { backgroundColor: colors.mint },
  inactive: { backgroundColor: '#F3F4F6' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  activeDot: { backgroundColor: '#16A34A' },
  busyDot: { backgroundColor: '#DC2626' },
  inactiveDot: { backgroundColor: '#A3A3A3' },
  statusText: { color: colors.ink, fontSize: 10, fontWeight: '700' },
});
