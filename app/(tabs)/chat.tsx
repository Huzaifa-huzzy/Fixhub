import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAppSession } from '../../src/context/AppSessionContext';
import { useLanguage } from '../../src/context/LanguageContext';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/theme';
import { ScreenHeading } from '../../src/components/ScreenHeading';
import { getPinnedLtrStyle } from '../../src/lib/layoutDirection';

type Conversation = {
  chat_id: string;
  other_profile_id: string;
  other_profile_name: string | null;
  other_profile_avatar_url: string | null;
  updated_at: string;
  last_message_preview: string | null;
};

function formatConversationDate(value: string, language: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(language === 'ur' ? 'ur-PK' : 'en-US', {
    day: 'numeric',
    month: 'short',
  });
}

export default function ChatInboxScreen() {
  const { profile } = useAppSession();
  const { language, isRTL, t } = useLanguage();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const refreshingRef = useRef(false);

  const loadConversations = useCallback(async (background = false) => {
    if (!profile || !supabase) {
      setConversations([]);
      setError('');
      setLoading(false);
      return;
    }

    if (!background) setLoading(true);
    const { data, error: loadError } = await supabase.rpc('list_my_chats');
    if (loadError) {
      setError(loadError.message);
    } else {
      setError('');
      setConversations((data ?? []) as Conversation[]);
    }
    if (!background) setLoading(false);
  }, [profile]);

  const handleRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await loadConversations(true);
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [loadConversations]);

  useFocusEffect(useCallback(() => {
    void loadConversations();
  }, [loadConversations]));

  function openConversation(conversation: Conversation) {
    router.push({
      pathname: '/chat/[chatId]',
      params: {
        chatId: conversation.chat_id,
        otherProfileId: conversation.other_profile_id,
        providerName: conversation.other_profile_name || t('FixHub user'),
      },
    });
  }

  function renderConversation({ item }: { item: Conversation }) {
    const name = item.other_profile_name || t('FixHub user');
    const preview = item.last_message_preview || t('Start the conversation with a message.');
    return (
      <Pressable
        accessibilityLabel={`${name}, ${preview}`}
        accessibilityRole="button"
        onPress={() => openConversation(item)}
        style={[styles.conversation, getPinnedLtrStyle()]}
      >
        <View style={styles.avatar}>
          {item.other_profile_avatar_url
            ? <Image source={{ uri: item.other_profile_avatar_url }} style={styles.avatarImage} />
            : <Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase() || 'F'}</Text>}
        </View>
        <View style={styles.conversationDetails}>
          <View style={[styles.conversationTopLine, getPinnedLtrStyle()]}>
            <Text numberOfLines={1} style={styles.name}>{name}</Text>
            <Text style={styles.date}>{formatConversationDate(item.updated_at, language)}</Text>
          </View>
          <Text numberOfLines={1} style={styles.preview}>{preview}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.screen, getPinnedLtrStyle()]}>
      <ScreenHeading style={styles.heading}>
        <Text style={[styles.title, isRTL && styles.rtlText]}>{t('Chats')}</Text>
        <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t('Your conversations')}</Text>
      </ScreenHeading>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{t('Could not load chats.')} {error}</Text> : null}
      <FlatList
        contentContainerStyle={conversations.length === 0 ? styles.emptyList : styles.list}
        data={conversations}
        keyExtractor={(item) => item.chat_id}
        refreshControl={<RefreshControl colors={[colors.green]} onRefresh={() => void handleRefresh()} refreshing={refreshing} tintColor={colors.green} />}
        renderItem={renderConversation}
        ListEmptyComponent={() => {
          if (loading) return <ActivityIndicator color={colors.green} style={styles.loader} />;
          if (error) return null;
          return (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>▤</Text>
              <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t('No conversations yet.')}</Text>
              <Text style={[styles.emptyCopy, isRTL && styles.rtlText]}>{t('Start a chat with a provider to see conversations here.')}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  heading: { marginHorizontal: 14, marginTop: 14, marginBottom: 12 },
  rtlText: { textAlign: 'right' },
  title: { color: colors.ink, fontSize: 23, fontWeight: '900' },
  subtitle: { color: colors.ink, opacity: 0.84, fontSize: 12, marginTop: 5 },
  error: { color: colors.coral, fontSize: 12, lineHeight: 18, marginHorizontal: 20, marginBottom: 10 },
  list: { paddingHorizontal: 14, paddingBottom: 20 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingBottom: 30 },
  loader: { marginVertical: 24 },
  empty: { alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.card, padding: 26 },
  emptyIcon: { color: colors.green, fontSize: 28 },
  emptyTitle: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: 10 },
  emptyCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center' },
  conversation: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, marginBottom: 9, padding: 12 },
  avatar: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: colors.greenDark, fontSize: 17, fontWeight: '900' },
  conversationDetails: { flex: 1, marginLeft: 12 },
  conversationTopLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { color: colors.ink, flex: 1, fontSize: 13, fontWeight: '800' },
  date: { color: colors.muted, fontSize: 10 },
  preview: { color: colors.muted, fontSize: 11, marginTop: 5 },
  chevron: { color: colors.green, fontSize: 25, marginLeft: 8 },
});
