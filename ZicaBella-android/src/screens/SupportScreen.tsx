import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, StyleSheet, ScrollView, TouchableOpacity, 
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
  KeyboardAvoidingView, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
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
import { useThemeStore } from '../store/themeStore';

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const { user } = useAuth();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // New ticket form
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchTickets = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const res = await fetch(`${config.appUrl}/api/support/tickets?customerId=${user.id}`, { headers: supportAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch (error) {
      console.error('[Support] Fetch Tickets Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchTickets();
    // Refresh when screen is focused
    const unsubscribe = navigation.addListener('focus', () => {
      fetchTickets();
    });
    
    // Background polling every 10s
    const interval = setInterval(fetchTickets, 10000);
    
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [fetchTickets, navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTickets();
  };

  const handleCreateTicket = async () => {
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${config.appUrl}/api/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...supportAuthHeaders() },
        body: JSON.stringify({
          customerId: user?.id,
          guestName: user?.name,
          guestEmail: user?.email,
          subject: subject.trim(),
          content: message.trim(),
          priority
        })
      });

      if (res.ok) {
        haptics.success();
        setIsModalOpen(false);
        setSubject('');
        setMessage('');
        fetchTickets();
        Alert.alert('Success', 'Support ticket created successfully');
      } else {
        throw new Error('Failed to create ticket');
      }
    } catch (error) {
      haptics.error();
      Alert.alert('Error', 'Could not create ticket. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const TicketCard = ({ ticket }: { ticket: any }) => {
    const statusColor = ticket.status === 'RESOLVED' ? colors.success : 
                        ticket.status === 'PENDING' ? '#FF9F0A' : colors.textExtraLight;
    
    return (
      <TouchableOpacity 
        style={[styles.ticketCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderExtraLight }]}
        onPress={() => {
          haptics.buttonTap();
          navigation.navigate('SupportDetail', { ticketId: ticket.id, subject: ticket.subject });
        }}
      >
        <View style={styles.ticketHeader}>
          <Typography size={10} weight="700" color={colors.text} numberOfLines={1} style={{ flex: 1, letterSpacing: 1 }}>
            {ticket.subject.toUpperCase()}
          </Typography>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Typography size={7} weight="800" color={statusColor}>{ticket.status}</Typography>
          </View>
        </View>
        
        <Typography size={9} color={colors.textSecondary} numberOfLines={2} style={styles.lastMessage}>
          {ticket.messages?.[ticket.messages.length - 1]?.content || 'No messages yet'}
        </Typography>
        
        <View style={styles.ticketFooter}>
          <Typography size={8} color={colors.textExtraLight}>
            #{ticket.id.slice(-6).toUpperCase()} • {new Date(ticket.updatedAt).toLocaleDateString()}
          </Typography>
          <View style={styles.priorityBox}>
            <View style={[styles.priorityDot, { backgroundColor: ticket.priority === 'HIGH' ? colors.error : ticket.priority === 'MEDIUM' ? '#FF9F0A' : colors.success }]} />
            <Typography size={8} weight="600" color={colors.textExtraLight}>{ticket.priority}</Typography>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20, paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />}
      >
        <View style={styles.headerSection}>
          <Typography heading size={24} weight="700" color={colors.text}>Support</Typography>
          <Typography size={10} color={colors.textLight} style={{ marginTop: 4, letterSpacing: 1 }}>Direct line to Zica Bella</Typography>
        </View>

        {loading && !refreshing ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : tickets.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={64} color={colors.textExtraLight} style={{ opacity: 0.2 }} />
            <Typography color={colors.textMuted} style={{ textAlign: 'center', marginTop: 16 }}>
              No active support tickets.{"\n"}Need help? Create one below.
            </Typography>
          </View>
        ) : (
          <View style={styles.ticketList}>
            {tickets.map(t => <TicketCard key={t.id} ticket={t} />)}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: colors.foreground, bottom: insets.bottom + 20 }]}
        onPress={() => { haptics.buttonTap(); setIsModalOpen(true); }}
      >
        <Ionicons name="add" size={24} color={colors.background} />
      </TouchableOpacity>

      {/* Create Ticket Modal */}
      <Modal visible={isModalOpen} animationType="slide" transparent>
        <GlassView intensity={20} tint={theme} style={[StyleSheet.absoluteFill, { borderWidth: 0, borderRadius: 0 }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={[styles.modalContent, { backgroundColor: colors.background, paddingTop: insets.top + 20 }]}>
              <View style={styles.modalHeader}>
                <Typography heading size={18} weight="700" color={colors.text}>New Ticket</Typography>
                <TouchableOpacity onPress={() => setIsModalOpen(false)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.form}>
                <View style={styles.inputGroup}>
                  <Typography size={8} weight="700" color={colors.textExtraLight} style={styles.label}>SUBJECT</Typography>
                  <TextInput 
                    style={[styles.input, { color: colors.text, borderColor: colors.borderLight }]}
                    placeholder="What can we help with?"
                    placeholderTextColor={colors.textExtraLight}
                    value={subject}
                    onChangeText={setSubject}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Typography size={8} weight="700" color={colors.textExtraLight} style={styles.label}>PRIORITY</Typography>
                  <View style={styles.priorityRow}>
                    {(['LOW', 'MEDIUM', 'HIGH'] as const).map(p => (
                      <TouchableOpacity 
                        key={p}
                        style={[
                          styles.priorityBtn, 
                          { borderColor: priority === p ? colors.text : colors.borderLight },
                          priority === p && { backgroundColor: colors.text }
                        ]}
                        onPress={() => setPriority(p)}
                      >
                        <Typography size={8} weight="700" color={priority === p ? colors.background : colors.text}>{p}</Typography>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Typography size={8} weight="700" color={colors.textExtraLight} style={styles.label}>MESSAGE</Typography>
                  <TextInput 
                    style={[styles.textArea, { color: colors.text, borderColor: colors.borderLight }]}
                    placeholder="Describe your issue in detail..."
                    placeholderTextColor={colors.textExtraLight}
                    multiline
                    numberOfLines={6}
                    value={message}
                    onChangeText={setMessage}
                  />
                </View>

                <TouchableOpacity 
                  style={[styles.submitBtn, { backgroundColor: colors.foreground }]}
                  onPress={handleCreateTicket}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <ActivityIndicator color={colors.background} /> : (
                    <Typography heading size={9} weight="700" color={colors.background}>CREATE TICKET</Typography>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </GlassView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  headerSection: { marginBottom: 32 },
  center: { paddingVertical: 100, alignItems: 'center' },
  emptyState: { paddingVertical: 100, alignItems: 'center' },
  ticketList: { gap: 16 },
  ticketCard: {
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  lastMessage: {
    opacity: 0.7,
    lineHeight: 16,
    marginBottom: 16,
  },
  ticketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priorityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalContent: {
    flex: 1,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  form: {
    paddingHorizontal: 24,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    letterSpacing: 2,
    marginBottom: 8,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  textArea: {
    height: 120,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 12,
  },
  priorityBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtn: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 40,
  }
});
