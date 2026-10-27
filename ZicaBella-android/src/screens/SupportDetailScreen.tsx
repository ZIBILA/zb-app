import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, StyleSheet, ScrollView, TouchableOpacity, 
  ActivityIndicator, RefreshControl, TextInput, KeyboardAvoidingView, 
  Platform, Keyboard, FlatList
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../components/GlassView';

import { useColors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { Typography } from '../components/Typography';
import { config } from '../constants/config';
import { useAuthStore } from '../store/authStore';

/** Send the login token so the server knows who is asking (no reliance on customerId in the URL). */
const supportAuthHeaders = (): Record<string, string> => {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
import { haptics } from '../utils/haptics';
import { RootStackParamList } from '../navigation/types';
import { useThemeStore } from '../store/themeStore';

type RouteProps = RouteProp<RootStackParamList, 'SupportDetail'>;

export default function SupportDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProps>();
  const colors = useColors();
  const { user } = useAuth();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';
  
  const [ticketId, setTicketId] = useState(route.params.ticketId);
  const [subject, setSubject] = useState(route.params.subject);

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`${config.appUrl}/api/support/tickets?customerId=${user?.id}`, { headers: supportAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const ticket = data.tickets?.find((t: any) => t.id === ticketId);
        if (ticket) {
          setMessages(ticket.messages || []);
        }
      }
    } catch (error) {
      console.error('[SupportDetail] Fetch Messages Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ticketId, user?.id]);

  useEffect(() => {
    fetchMessages();
    // Poll for updates every 3 seconds for "instant" feel
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;

    const content = newMessage.trim();
    
    // Optimistic update
    const optimisticMessage = {
      id: `temp-${Date.now()}`,
      content,
      senderType: 'USER',
      senderName: user?.name || 'You',
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, optimisticMessage]);
    setNewMessage('');
    setIsSending(true);
    haptics.buttonTap();

    try {
      const res = await fetch(`${config.appUrl}/api/support/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...supportAuthHeaders() },
        body: JSON.stringify({
          ticketId,
          content,
          senderType: 'USER',
          senderId: user?.id,
          senderName: user?.name || 'Customer'
        })
      });

      if (!res.ok) {
        // Rollback optimistic update on error
        setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
        setNewMessage(content); 
        throw new Error('Failed to send message');
      } else {
        // Refresh to get the real ID and sync
        fetchMessages();
      }
    } catch (error) {
      console.error('[SupportDetail] Send Error:', error);
      haptics.error();
    } finally {
      setIsSending(false);
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.senderType === 'USER';
    return (
      <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
        <View style={[
          styles.messageBubble, 
          isMe ? 
            { backgroundColor: colors.foreground, borderBottomRightRadius: 4 } : 
            { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderBottomLeftRadius: 4 }
        ]}>
          <Typography size={14} color={isMe ? colors.background : colors.text} style={styles.messageText}>
            {item.content}
          </Typography>
          <Typography size={7} weight="600" color={isMe ? colors.background + '80' : colors.textExtraLight} style={styles.messageTime}>
             {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Typography>
        </View>
        <Typography size={8} weight="700" color={colors.textExtraLight} style={[styles.senderName, isMe ? { textAlign: 'right' } : { textAlign: 'left' }]}>
          {isMe ? 'YOU' : 'SUPPORT AGENT'}
        </Typography>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Custom Header */}
      <GlassView intensity={20} tint={theme} style={[styles.header, { paddingTop: insets.top, borderColor: colors.borderExtraLight }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Typography size={10} weight="700" color={colors.text} numberOfLines={1} style={{ letterSpacing: 1 }}>
              {subject.toUpperCase()}
            </Typography>
            <Typography size={8} color={colors.textExtraLight}>#{ticketId.slice(-6).toUpperCase()}</Typography>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </GlassView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 20 }]}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMessages(); }} tintColor={colors.text} />}
        />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <GlassView intensity={40} tint={theme} style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 16), borderColor: colors.borderExtraLight }]}>
          <View style={[styles.inputWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Type your message..."
              placeholderTextColor={colors.textExtraLight}
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity 
              onPress={handleSend}
              disabled={!newMessage.trim() || isSending}
              style={[styles.sendBtn, { backgroundColor: newMessage.trim() ? colors.foreground : 'transparent' }]}
            >
              {isSending ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Ionicons name="arrow-up" size={20} color={newMessage.trim() ? colors.background : colors.textExtraLight} />
              )}
            </TouchableOpacity>
          </View>
        </GlassView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    zIndex: 100,
    borderBottomWidth: 1,
  },
  headerContent: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: {
    padding: 16,
    gap: 24,
  },
  messageWrapper: {
    maxWidth: '85%',
  },
  myMessageWrapper: {
    alignSelf: 'flex-end',
  },
  theirMessageWrapper: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  messageText: {
    lineHeight: 20,
  },
  messageTime: {
    marginTop: 4,
    textAlign: 'right',
  },
  senderName: {
    marginTop: 6,
    letterSpacing: 1,
    opacity: 0.5,
  },
  inputArea: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    marginRight: 4,
  }
});
