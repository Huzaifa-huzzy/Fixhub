import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon } from '../components/AppIcon';
import { useAppSession } from '../context/AppSessionContext';
import { useLanguage } from '../context/LanguageContext';
import { getLayoutDirectionStyle } from '../lib/layoutDirection';
import { supabase } from '../lib/supabase';
import { colors, radius } from '../theme';

type Review = {
  id: string;
  reviewer: string;
  rating: number;
  comment: string | null;
};

export function MyReviewsScreen() {
  const { activeProfile, demoMode } = useAppSession();
  const { t, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (demoMode || !supabase || !activeProfile) return;

    let active = true;
    async function loadReviews() {
      setLoading(true);
      setError('');
      const { data: reviewRows, error: reviewError } = await supabase!
        .from('reviews')
        .select('id,from_profile_id,rating,comment')
        .eq('to_profile_id', activeProfile!.id)
        .order('created_at', { ascending: false });
      if (reviewError) {
        if (active) {
          setError(reviewError.message);
          setLoading(false);
        }
        return;
      }

      const reviewerIds = (reviewRows ?? []).map((review) => review.from_profile_id);
      const { data: reviewerProfiles, error: reviewersError } = reviewerIds.length
        ? await supabase!.from('public_profiles').select('id,name').in('id', reviewerIds)
        : { data: [], error: null };
      if (reviewersError) {
        if (active) {
          setError(reviewersError.message);
          setLoading(false);
        }
        return;
      }

      const reviewerById = new Map((reviewerProfiles ?? []).map((item) => [item.id, item.name]));
      if (active) {
        setReviews((reviewRows ?? []).map((review) => ({
          id: review.id,
          reviewer: reviewerById.get(review.from_profile_id)?.trim() || t('FixHub user'),
          rating: review.rating,
          comment: review.comment,
        })));
        setLoading(false);
      }
    }

    void loadReviews();
    return () => { active = false; };
  }, [activeProfile, demoMode, t]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }, getLayoutDirectionStyle(isRTL)]}>
        <Pressable accessibilityLabel={t('Back')} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <AppIcon color={colors.buttonText} name={isRTL ? 'arrowRight' : 'arrowLeft'} size={20} />
        </Pressable>
        <Text style={[styles.title, isRTL && styles.rtlText]}>{t('My Reviews')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && !error && reviews.length === 0 ? (
          <View style={styles.empty}>
            <AppIcon color={colors.green} name="star" size={24} />
            <Text style={styles.emptyText}>{t('Reviews from completed connections will appear here.')}</Text>
          </View>
        ) : null}
        {reviews.map((review) => (
          <View key={review.id} style={styles.reviewCard}>
            <View style={[styles.reviewHeader, getLayoutDirectionStyle(isRTL)]}>
              <Text style={[styles.reviewer, isRTL && styles.rtlText]}>{t('Review by')} {review.reviewer}</Text>
              <View style={styles.rating}>
                <AppIcon color={colors.greenDark} fill={colors.greenDark} name="star" size={13} />
                <Text style={styles.ratingText}>{review.rating}</Text>
              </View>
            </View>
            <Text style={[styles.comment, isRTL && styles.rtlText]}>{review.comment || t('No written comment.')}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.green },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  rtlText: { textAlign: 'right' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18, paddingBottom: 32 },
  loader: { marginVertical: 28 },
  error: { color: colors.coral, fontSize: 12, lineHeight: 18 },
  empty: { alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: radius.card, padding: 24 },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  reviewCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, marginBottom: 10 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reviewer: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: '800' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  comment: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
