import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/context/AppSessionContext';
import { useLanguage } from '../../src/context/LanguageContext';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ChatMessage = {
  id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
};

export default function ChatScreen() {
  const { chatId, otherProfileId, providerName } = useLocalSearchParams<{
    chatId: string;
    otherProfileId: string;
    providerName: string;
  }>();
  const { profile } = useAppSession();
  const { t, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const isNearLatestMessage = useRef(true);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      if (isNearLatestMessage.current) {
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      }
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const loadMessages = useCallback(async () => {
    if (!supabase || typeof chatId !== 'string') {
      setError(t('Unable to load this chat.'));
      setLoading(false);
      return;
    }
    const { data, error: loadError } = await supabase
      .from('messages')
      .select('id,sender_id,content,created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    if (loadError) {
      setError(loadError.message);
    } else {
      setError('');
      setMessages((data ?? []) as ChatMessage[]);
    }
    setLoading(false);
  }, [chatId, t]);

  useEffect(() => {
    const loadTimer = setTimeout(() => { void loadMessages(); }, 0);
    const client = supabase;
    if (!client || typeof chatId !== 'string') return () => clearTimeout(loadTimer);
    const channel = client
      .channel(`chat:${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      }, () => { void loadMessages(); })
      .subscribe();
    return () => {
      clearTimeout(loadTimer);
      void client.removeChannel(channel);
    };
  }, [chatId, loadMessages]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !profile || !supabase || !chatId || !otherProfileId || sending) return;
    setSending(true);
    setError('');
    const { error: sendError } = await supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: profile.id,
      receiver_id: otherProfileId,
      content,
    });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    isNearLatestMessage.current = true;
    setDraft('');
    void loadMessages();
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={[styles.header, isRTL && styles.headerRtl]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{isRTL ? '›' : '‹'}</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>{providerName || t('Chat')}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={colors.ink} style={styles.loader} /> : (
        <ScrollView
          contentContainerStyle={styles.messageList}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (isNearLatestMessage.current) scrollRef.current?.scrollToEnd({ animated: true });
          }}
          onScroll={({ nativeEvent }) => {
            const distanceFromEnd = nativeEvent.contentSize.height
              - nativeEvent.layoutMeasurement.height
              - nativeEvent.contentOffset.y;
            isNearLatestMessage.current = distanceFromEnd < 80;
          }}
          ref={scrollRef}
          style={styles.messages}
          scrollEventThrottle={16}
        >
          {messages.length === 0 ? <Text style={styles.empty}>{t('Start the conversation with a message.')}</Text> : null}
          {messages.map((message) => {
            const ownMessage = message.sender_id === profile?.id;
            return (
              <View key={message.id} style={[styles.messageRow, ownMessage && styles.ownMessageRow]}>
                <View style={[styles.messageBubble, ownMessage ? styles.ownMessageBubble : styles.otherMessageBubble]}>
                  <Text style={[styles.messageText, ownMessage && styles.ownMessageText]}>{message.content}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={[styles.composer, { paddingBottom: keyboardVisible ? 12 : Math.max(insets.bottom, 12) }]}>
        <TextInput
          accessibilityLabel={t('Write a message')}
          maxLength={5000}
          multiline
          onChangeText={setDraft}
          onSubmitEditing={() => void sendMessage()}
          placeholder={t('Write a message')}
          placeholderTextColor={colors.muted}
          style={styles.messageInput}
          textAlignVertical="top"
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!draft.trim() || sending}
          onPress={() => void sendMessage()}
          style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
        >
          {sending ? <ActivityIndicator color={colors.buttonText} size="small" /> : <Text style={styles.sendText}>{t('Send')}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 14 },
  headerRtl: { flexDirection: 'row-reverse' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 12 },
  backText: { color: colors.buttonText, fontSize: 32, lineHeight: 36 },
  headerTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '900', marginHorizontal: 6 },
  error: { color: colors.coral, fontSize: 12, margin: 14 },
  loader: { marginTop: 24 },
  messages: { flex: 1 },
  messageList: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 14, paddingVertical: 16 },
  empty: { alignSelf: 'center', color: colors.muted, fontSize: 12, marginVertical: 20 },
  messageRow: { flexDirection: 'row', marginVertical: 4 },
  ownMessageRow: { justifyContent: 'flex-end' },
  messageBubble: { maxWidth: '82%', borderRadius: radius.card, paddingHorizontal: 13, paddingVertical: 9 },
  ownMessageBubble: { backgroundColor: colors.ink, borderBottomRightRadius: 5 },
  otherMessageBubble: { backgroundColor: '#F1F1F1', borderBottomLeftRadius: 5 },
  messageText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  ownMessageText: { color: colors.white },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white },
  messageInput: { flex: 1, maxHeight: 120, minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 13 },
  sendButton: { minWidth: 62, height: 44, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  sendButtonDisabled: { opacity: 0.45 },
  sendText: { color: colors.buttonText, fontSize: 12, fontWeight: '800' },
});
