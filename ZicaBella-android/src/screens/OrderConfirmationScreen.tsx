import React from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { RootStackParamList } from '../navigation/types';
import { Typography } from '../components/Typography';
import { haptics } from '../utils/haptics';
import { initPushNotifications } from '../utils/notifications';

export default function OrderConfirmationScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'OrderConfirmation'>>();
  const params = route.params || {};
  const orderId = params.orderId || '';
  const orderNumber = params.orderNumber || '';
  const paymentMethod = params.paymentMethod || 'COD';
  const estimatedDelivery = params.estimatedDelivery || '';
  const isDark = useThemeStore(s => s.theme) === 'dark';

  React.useEffect(() => {
    // Delay push notification request until the user places their first order
    // This is much better for user experience than spamming it on app open
    setTimeout(() => {
      initPushNotifications().catch(() => {});
    }, 1000);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 100 }]}>
        <View style={[styles.checkCircle, { backgroundColor: isDark ? 'rgba(52,199,89,0.1)' : 'rgba(52,199,89,0.05)' }]}>
          <Ionicons name="checkmark-done-circle" size={64} color={colors.success} />
        </View>

        <Typography heading weight="700" size={24} color={colors.text} style={styles.title}>
          ORDER CONFIRMED!
        </Typography>
        <Typography weight="400" size={10} color={colors.textMuted} style={styles.orderId}>
          {orderNumber ? `ORDER: ${orderNumber}` : orderId ? `ORDER ID: ${String(orderId).toUpperCase()}` : 'ORDER PLACED'}
        </Typography>
        
        <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

        <Typography size={12} color={colors.textSecondary} style={styles.message}>
          {paymentMethod === 'COD'
            ? `Your order ${orderNumber || ''} has been confirmed! Our team will contact you before dispatch.`
            : `Payment confirmed! Your order ${orderNumber || ''} will be processed shortly.`}
        </Typography>
        <View style={[styles.pill, { backgroundColor: 'rgba(52,199,89,0.12)', borderColor: 'rgba(52,199,89,0.25)' }]}>
          <Typography heading weight="700" size={9} color={colors.success}>ORDER CONFIRMED</Typography>
        </View>

        <View style={[styles.emailNotice, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
          <Typography size={10} color={colors.textSecondary} weight="500" style={{ letterSpacing: 0.5, textAlign: 'center' }}>
            ✉ A confirmation email has been sent to your registered email address.
          </Typography>
        </View>

        {!!estimatedDelivery && (
          <Typography size={10} color={colors.textMuted} style={[styles.note, { marginTop: 14 }]}>
            Estimated delivery: {estimatedDelivery}
          </Typography>
        )}

        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.primaryButton, { backgroundColor: colors.foreground }]} 
            onPress={() => { haptics.buttonTap(); navigation.navigate('Main'); }} 
            activeOpacity={0.85}
          >
            <Typography heading weight="700" size={11} color={colors.background}>CONTINUE SHOPPING</Typography>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.secondaryButton, { borderColor: colors.borderLight }]} 
            onPress={() => { haptics.buttonTap(); navigation.navigate('Main', { screen: 'OrdersTab' }); }} 
            activeOpacity={0.7}
          >
            <Typography heading weight="700" size={9} color={colors.text}>TRACK YOUR ORDER</Typography>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Removed signature branding as requested */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { alignItems: 'center', paddingHorizontal: 32 },
  checkCircle: { width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center', marginBottom: 40 },
  title: { letterSpacing: 4, marginBottom: 8, textAlign: 'center' },
  orderId: { letterSpacing: 2, marginBottom: 32 },
  divider: { height: 1, width: 40, marginBottom: 32 },
  message: { textAlign: 'center', lineHeight: 22, opacity: 0.8, marginBottom: 24, letterSpacing: 0.5 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginTop: 8 },
  emailNotice: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, marginTop: 24, width: '100%', alignItems: 'center', justifyContent: 'center' },
  note: { textAlign: 'center', lineHeight: 18, opacity: 0.8, letterSpacing: 0.5 },
  actions: { width: '100%', gap: 16, marginTop: 32 },
  primaryButton: { width: '100%', paddingVertical: 24, borderRadius: 24, alignItems: 'center' },
  secondaryButton: { width: '100%', paddingVertical: 20, borderRadius: 24, alignItems: 'center', borderWidth: 1 },
  footer: { alignItems: 'center', position: 'absolute', bottom: 0, left: 0, right: 0 },
});
