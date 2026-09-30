import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Dimensions, ActivityIndicator, Platform, KeyboardAvoidingView, Animated,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { haptics } from '../../utils/haptics';
import { useColors } from '../../constants/colors';
import { Typography } from '../../components/Typography';
import { useRazorpay, PaymentMethod } from '../../hooks/useRazorpay';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { getPaymentApiBaseUrl } from '../../constants/config';
import { TOP_BANKS } from '../../constants/bankCodes';
import { WALLETS } from '../../constants/walletCodes';

const UPI_LOGOS: Record<string, string> = {
  'com.google.android.apps.nbu.paisa.user': 'https://cdn.razorpay.com/app/google_pay.png',
  'com.phonepe.app': 'https://cdn.razorpay.com/app/phonepe.png',
  'net.one97.paytm': 'https://cdn.razorpay.com/app/paytm.png',
  'in.org.npci.upiapp': 'https://cdn.razorpay.com/app/bhim.png',
  'com.amazon.mShop.android.shopping': 'https://cdn.razorpay.com/app/amazon_pay.png',
  'phonepe://': 'https://cdn.razorpay.com/app/phonepe.png',
  'tez://': 'https://cdn.razorpay.com/app/google_pay.png',
  'paytmmp://': 'https://cdn.razorpay.com/app/paytm.png',
};

const { width: SW } = Dimensions.get('window');

function detectCardType(num: string): string {
  const n = num.replace(/\s/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'Mastercard';
  if (/^6/.test(n) || /^81/.test(n) || /^82/.test(n)) return 'RuPay';
  return '';
}

function formatCardNumber(val: string): string {
  const n = val.replace(/\D/g, '').slice(0, 16);
  return n.replace(/(.{4})/g, '$1 ').trim();
}

export default function RazorpayPaymentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { amount, orderId, razorpayKeyId, prefill, orderData } = route.params || {};
  const { clearCart, buyNowItem, setBuyNowItem } = useCartStore();
  const isDark = colors.background === '#000000';

  const {
    status, error, successData, startPayment, reset,
    upiApps, installedWallets, isLoadingApps, fetchInstalledUPIApps, fetchInstalledWallets,
  } = useRazorpay();
  const isProcessing = status === 'processing' || status === 'verifying' || status === 'creating_order';

  const [tab, setTab] = useState<PaymentMethod>('upi');
  const [upiSubTab, setUpiSubTab] = useState<'apps' | 'id'>('apps');
  const [selectedUPIApp, setSelectedUPIApp] = useState<string | null>(null);
  const [upiId, setUpiId] = useState('');

  const [cardNum, setCardNum] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');

  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [bankSearch, setBankSearch] = useState('');

  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  const orderRecordedRef = useRef(false);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const tabIndicator = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const failScale = useRef(new Animated.Value(0)).current;

  const TABS: PaymentMethod[] = ['upi', 'card', 'netbanking', 'wallet'];
  const TAB_LABELS = ['UPI', 'Card', 'Bank', 'Wallets'];
  const tabWidth = (SW - 48) / 4;

  // Fetch installed apps
  useEffect(() => {
    fetchInstalledUPIApps();
    fetchInstalledWallets();
  }, []);

  useEffect(() => {
    if (tab === 'upi') {
      const firstAvailableApp = upiApps.find(app => app.is_available !== false);
      if (firstAvailableApp && !selectedUPIApp) {
          setSelectedUPIApp(firstAvailableApp.package_name);
      }
    }
  }, [tab, upiApps]);

  useEffect(() => {
    Animated.spring(tabIndicator, { toValue: TABS.indexOf(tab) * tabWidth, friction: 8, tension: 40, useNativeDriver: true }).start();
  }, [tab]);

  useEffect(() => {
    if (isProcessing) {
      Animated.loop(Animated.timing(spinAnim, { toValue: 1, duration: 1200, useNativeDriver: true })).start();
    } else {
      spinAnim.setValue(0);
    }
  }, [status]);

  // ── Success/Fail animations ──
  useEffect(() => {
    if (status === 'success' && successData) {
      Animated.parallel([
        Animated.spring(successScale, { toValue: 1, friction: 4, useNativeDriver: true }),
        Animated.timing(successOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
      recordOrderOnBackend(successData.paymentId, successData.orderId);
    }
  }, [status, successData]);

  useEffect(() => {
    if (status === 'failed') {
      Animated.spring(failScale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
    }
  }, [status]);

  // ── Record order on backend ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [createdOrderNumber, setCreatedOrderNumber] = useState<string | null>(null);

  const recordOrderOnBackend = useCallback(async (paymentId: string, rzpOrderId: string) => {
    if (orderRecordedRef.current) return;
    setIsRecording(true);
    setRecordError(null);

    try {
      const token = useAuthStore.getState().token || '';
      const apiBase = getPaymentApiBaseUrl();

      if (orderData) {
        const orderPayload = {
          ...orderData,
          paymentId: paymentId,
          razorpayOrderId: rzpOrderId,
          razorpay_order_id: rzpOrderId,
          paymentStatus: 'paid',
          paymentMethod: 'PREPAID',
        };

        const res = await fetch(`${apiBase}/api/app/orders/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify(orderPayload),
        });

        const resText = await res.text();
        let resJson: any = {};
        try {
          resJson = resText ? JSON.parse(resText) : {};
        } catch {
          throw new Error(`Order sync returned an invalid response (${res.status})`);
        }

        if (!res.ok || resJson.success === false) {
          throw new Error(resJson.error || 'Failed to sync order');
        }
        setCreatedOrderId(resJson.orderId || resJson.id || null);
        setCreatedOrderNumber(resJson.orderNumber || null);
        orderRecordedRef.current = true;
      } else {
        throw new Error('Missing order details for backend sync');
      }
      buyNowItem ? setBuyNowItem(null) : clearCart();
      setIsRecording(false);
    } catch (e: any) {
      console.error('[RazorpayPayment] Error recording order:', e.message);
      setRecordError(e.message || 'Sync failed');
      setIsRecording(false);
      setTimeout(() => recordOrderOnBackend(paymentId, rzpOrderId), 3000);
    }
  }, [orderData, buyNowItem, setBuyNowItem, clearCart]);

  const isPayReady = (): boolean => {
    if (tab === 'upi') return upiSubTab === 'apps' ? !!selectedUPIApp : upiId.includes('@');
    if (tab === 'card') return cardNum.replace(/\s/g, '').length === 16 && cardExpiry.length === 5 && cardCvv.length >= 3;
    if (tab === 'netbanking') return !!selectedBank;
    if (tab === 'wallet') return !!selectedWallet;
    return false;
  };

  const onPay = async () => {
    if (!isPayReady()) return;
    haptics.success();
    
    const opts: any = {
      amount,
      orderId,
      razorpayKeyId,
      prefill,
      selectedAppPackage: upiSubTab === 'apps' ? (selectedUPIApp || undefined) : undefined,
      vpa: upiSubTab === 'id' ? upiId : undefined,
      cardNumber: cardNum,
      cardExpiry,
      cardCvv,
      cardName: cardName || prefill?.name || 'Customer',
      bankCode: selectedBank || undefined,
      walletCode: selectedWallet || undefined,
      orderData: orderData,
      notes: { app: 'zicabella', version: '2.0', ui: 'glass' },
    };

    try {
      await startPayment(tab, opts);
    } catch (e: any) {
      console.error('[RazorpayPayment] Payment failed:', e.message);
      // Optional: show alert if status doesn't catch it
    }
  };

  const goToOrders = () => {
    nav.getParent()?.reset({
      index: 1,
      routes: [{ name: 'Main' }, { name: 'OrderConfirmation', params: { orderId: createdOrderId || orderId, orderNumber: createdOrderNumber || undefined, paymentMethod: 'PREPAID' } }],
    });
  };

  const filteredBanks = TOP_BANKS.filter(b => b.name.toLowerCase().includes(bankSearch.toLowerCase()));
  const filteredWallets = WALLETS.filter(w => installedWallets.includes(w.id));
  const displayUpiApps = upiApps.filter(a => a.is_available !== false).slice(0, 6);
  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── Success State ──
  if (status === 'success') {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={s.overlay}>
          <Animated.View style={[s.resultCircle, { backgroundColor: 'rgba(52,199,89,0.1)', transform: [{ scale: successScale }], opacity: successOpacity }]}>
            <Ionicons name="checkmark-done" size={64} color={colors.success} />
          </Animated.View>
          <Typography size={24} weight="800" color={colors.text} style={{ marginTop: 40, letterSpacing: 4 }}>PAID SUCCESSFULLY</Typography>
          <Typography size={11} color={colors.textMuted} style={{ marginTop: 12 }}>
            {recordError ? 'Payment received. Syncing your order again.' : 'Your order has been recorded and synced.'}
          </Typography>
          
          {isRecording ? (
             <View style={{ marginTop: 32, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
               <ActivityIndicator size="small" color={colors.textMuted} />
               <Typography size={10} color={colors.textMuted} weight="800">SYNCING WITH STORE...</Typography>
             </View>
          ) : recordError && successData ? (
            <TouchableOpacity
              style={[s.ctaBtn, { backgroundColor: colors.foreground, marginTop: 40 }]}
              onPress={() => recordOrderOnBackend(successData.paymentId, successData.orderId)}
            >
              <Typography size={11} weight="800" color={colors.background} style={{ letterSpacing: 1 }}>SYNC ORDER</Typography>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.ctaBtn, { backgroundColor: colors.foreground, marginTop: 60 }]} onPress={goToOrders}>
              <Typography size={12} weight="800" color={colors.background} style={{ letterSpacing: 2 }}>CONTINUE</Typography>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ── Failed State ──
  if (status === 'failed') {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={s.overlay}>
          <Animated.View style={[s.resultCircle, { backgroundColor: 'rgba(255,59,48,0.1)', transform: [{ scale: failScale }] }]}>
            <Ionicons name="close" size={64} color={colors.error} />
          </Animated.View>
          <Typography size={22} weight="800" color={colors.text} style={{ marginTop: 32, letterSpacing: 2 }}>TRANSACTION FAILED</Typography>
          <Typography size={11} color={colors.textMuted} style={{ marginTop: 12, textAlign: 'center', paddingHorizontal: 40 }}>{error || 'The payment could not be completed.'}</Typography>
          <TouchableOpacity style={[s.ctaBtn, { backgroundColor: colors.foreground, marginTop: 40 }]} onPress={() => reset()}>
            <Typography size={11} weight="800" color={colors.background} style={{ letterSpacing: 1 }}>RETRY PAYMENT</Typography>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={s.headerBar}>
        <TouchableOpacity style={[s.backBtn, { backgroundColor: colors.surface }]} onPress={() => nav.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Typography size={14} weight="800" color={colors.text} style={{ letterSpacing: 1 }}>PAYMENT</Typography>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140, paddingHorizontal: 20 }}>
          <View style={[s.amountCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
             <Typography size={8} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 3 }}>GRAND TOTAL</Typography>
             <Typography size={36} weight="800" color={colors.text} style={{ marginTop: 8 }}>₹{(amount || 0).toLocaleString('en-IN')}</Typography>
              <View style={[s.orderIdTag, { backgroundColor: colors.surface }]}>
                <Typography size={8} weight="700" color={colors.textMuted}>
                  ORDER ID: {orderId?.startsWith('order_') ? orderId.slice(-12).toUpperCase() : orderId}
                </Typography>
              </View>
          </View>

          <View style={[s.tabBar, { backgroundColor: colors.surface }]}>
            <Animated.View style={[s.tabIndicator, { width: tabWidth - 8, backgroundColor: colors.foreground, transform: [{ translateX: Animated.add(tabIndicator, 4) }] }]} />
            {TABS.map((t, i) => (
              <TouchableOpacity key={t} style={[s.tabItem, { width: tabWidth }]} onPress={() => { haptics.tabPress(); setTab(t); }}>
                <Typography size={9} weight={tab === t ? '800' : '600'} color={tab === t ? colors.background : colors.textMuted}>{TAB_LABELS[i].toUpperCase()}</Typography>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── UPI PANEL ── */}
          {tab === 'upi' && (
            <View style={s.panel}>
              <View style={s.subTabRow}>
                <TouchableOpacity style={[s.subTab, upiSubTab === 'apps' && { backgroundColor: colors.surface, borderColor: colors.borderLight }]} onPress={() => setUpiSubTab('apps')}>
                   <Typography size={10} weight="800" color={upiSubTab === 'apps' ? colors.text : colors.textMuted}>UPI APPS</Typography>
                </TouchableOpacity>
                <TouchableOpacity style={[s.subTab, upiSubTab === 'id' && { backgroundColor: colors.surface, borderColor: colors.borderLight }]} onPress={() => setUpiSubTab('id')}>
                   <Typography size={10} weight="800" color={upiSubTab === 'id' ? colors.text : colors.textMuted}>UPI ID</Typography>
                </TouchableOpacity>
              </View>

              {upiSubTab === 'apps' ? (
                <>
                  <Typography size={8} weight="800" color={colors.textExtraLight} style={s.panelLabel}>SELECT APP</Typography>
                  {isLoadingApps ? (
                    <View style={s.loadingBox}><ActivityIndicator color={colors.textMuted} /></View>
                  ) : displayUpiApps.length === 0 ? (
                    <View style={s.emptyBox}>
                       <Typography size={10} color={colors.textMuted} style={{ textAlign: 'center', lineHeight: 18 }}>No UPI apps detected on this device.</Typography>
                    </View>
                  ) : (
                    <View style={s.methodGrid}>
                      {displayUpiApps.map(app => {
                        const isSelected = selectedUPIApp === app.package_name;
                        return (
                          <TouchableOpacity key={app.package_name} style={[s.glassCard, { borderColor: isSelected ? colors.foreground : colors.borderLight }]} onPress={() => { haptics.buttonTap(); setSelectedUPIApp(app.package_name); }}>
                             <View style={s.glassIconContainer}>
                               <Image source={{ uri: UPI_LOGOS[app.package_name] || (app.app_icon ? (app.app_icon.startsWith('http') || app.app_icon.startsWith('data:') ? app.app_icon : `data:image/png;base64,${app.app_icon}`) : 'https://cdn.razorpay.com/app/bhim.png') }} style={s.glassIcon} contentFit="contain" />
                             </View>
                             <Typography size={9} weight="800" color={colors.text} style={{ marginTop: 10 }}>{app.app_name.toUpperCase()}</Typography>
                             {isSelected && <View style={[s.selectedDot, { backgroundColor: colors.foreground }]} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </>
              ) : (
                <View style={{ marginTop: 20 }}>
                   <Typography size={8} weight="800" color={colors.textExtraLight} style={s.panelLabel}>ENTER UPI ID</Typography>
                   <View style={[s.glassInputContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight, paddingHorizontal: 20 }]}>
                     <TextInput style={[s.glassInput, { color: colors.text, marginLeft: 0 }]} placeholder="example@upi" placeholderTextColor={colors.textExtraLight} value={upiId} onChangeText={setUpiId} autoCapitalize="none" autoCorrect={false} spellCheck={false} />
                   </View>
                   <Typography size={9} color={colors.textExtraLight} style={{ marginTop: 14, textAlign: 'center', opacity: 0.7 }}>A payment request will be sent to your UPI app.</Typography>
                </View>
              )}
            </View>
          )}

          {/* ── CARD PANEL ── */}
          {tab === 'card' && (
            <View style={s.panel}>
              <Typography size={8} weight="800" color={colors.textExtraLight} style={s.panelLabel}>CREDIT / DEBIT CARD</Typography>
              <View style={[s.glassInputContainer, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                <Ionicons name="card-outline" size={18} color={colors.textMuted} />
                <TextInput style={[s.glassInput, { color: colors.text }]} placeholder="0000 0000 0000 0000" placeholderTextColor={colors.textExtraLight} value={cardNum} onChangeText={(v) => setCardNum(formatCardNumber(v))} keyboardType="number-pad" maxLength={19} />
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                <View style={[s.glassInputContainer, { flex: 1, backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                  <TextInput style={[s.glassInput, { color: colors.text }]} placeholder="MM/YY" placeholderTextColor={colors.textExtraLight} value={cardExpiry} onChangeText={(v) => { const c = v.replace(/\D/g, '').slice(0, 4); setCardExpiry(c.length > 2 ? c.slice(0, 2) + '/' + c.slice(2) : c); }} keyboardType="number-pad" maxLength={5} />
                </View>
                <View style={[s.glassInputContainer, { flex: 1, backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                  <TextInput style={[s.glassInput, { color: colors.text }]} placeholder="CVV" placeholderTextColor={colors.textExtraLight} value={cardCvv} onChangeText={(v) => setCardCvv(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} />
                </View>
              </View>
            </View>
          )}

          {/* ── BANK PANEL ── */}
          {tab === 'netbanking' && (
            <View style={s.panel}>
              <Typography size={8} weight="800" color={colors.textExtraLight} style={s.panelLabel}>POPULAR BANKS</Typography>
              <View style={s.methodGrid}>
                {TOP_BANKS.map(bank => (
                  <TouchableOpacity key={bank.code} style={[s.glassCard, { borderColor: selectedBank === bank.code ? colors.foreground : colors.borderLight }]} onPress={() => { haptics.buttonTap(); setSelectedBank(bank.code); }}>
                    <View style={s.glassIconContainer}>
                      <Image source={{ uri: bank.icon }} style={s.glassIcon} contentFit="contain" />
                    </View>
                    <Typography size={8} weight="700" color={colors.text} style={{ marginTop: 8 }}>{bank.name.toUpperCase()}</Typography>
                    {selectedBank === bank.code && <View style={[s.selectedDot, { backgroundColor: colors.foreground }]} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── WALLET PANEL ── */}
          {tab === 'wallet' && (
            <View style={s.panel}>
              <Typography size={8} weight="800" color={colors.textExtraLight} style={s.panelLabel}>AVAILABLE WALLETS</Typography>
              {filteredWallets.length === 0 ? (
                <View style={s.emptyBox}>
                   <Typography size={10} color={colors.textMuted} style={{ textAlign: 'center', lineHeight: 18 }}>No matching wallet apps found.{'\n'}Try paying via UPI or Card.</Typography>
                </View>
              ) : (
                <View style={s.methodGrid}>
                  {filteredWallets.map(wallet => (
                    <TouchableOpacity key={wallet.id} style={[s.glassCard, { borderColor: selectedWallet === wallet.id ? colors.foreground : colors.borderLight }]} onPress={() => { haptics.buttonTap(); setSelectedWallet(wallet.id); }}>
                      <View style={s.glassIconContainer}>
                        <Image source={{ uri: wallet.icon }} style={s.glassIcon} contentFit="contain" />
                      </View>
                      <Typography size={9} weight="800" color={colors.text} style={{ marginTop: 8 }}>{wallet.name.toUpperCase()}</Typography>
                      {selectedWallet === wallet.id && <View style={[s.selectedDot, { backgroundColor: colors.foreground }]} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 20, backgroundColor: colors.background }]}>
        <TouchableOpacity style={[s.payBtn, { backgroundColor: isPayReady() ? colors.foreground : colors.surface, opacity: isPayReady() ? 1 : 0.4 }]} onPress={onPay} disabled={isProcessing || !isPayReady()}>
          {isProcessing ? <ActivityIndicator color={colors.background} /> :
            <Typography size={13} weight="800" color={isPayReady() ? colors.background : colors.textMuted} style={{ letterSpacing: 2 }}>PLACE ORDER</Typography>
          }
        </TouchableOpacity>
      </View>

      {/* Remove custom processing overlay to let Razorpay's native UI handle feedback */}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  amountCard: { borderRadius: 32, padding: 32, alignItems: 'center', borderWidth: 1.5, marginVertical: 12 },
  orderIdTag: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, marginTop: 16 },
  tabBar: { flexDirection: 'row', marginTop: 24, borderRadius: 24, height: 52, overflow: 'hidden', position: 'relative', padding: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  tabIndicator: { position: 'absolute', top: 6, height: 40, borderRadius: 18 },
  tabItem: { height: 40, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  panel: { marginTop: 32 },
  panelLabel: { letterSpacing: 4, marginBottom: 20, marginLeft: 8 },
  subTabRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  subTab: { flex: 1, height: 44, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyBox: { padding: 40, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  glassCard: { width: (SW - 64) / 3, height: 105, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  glassIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  glassIcon: { width: 30, height: 30 },
  selectedDot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
  glassInputContainer: { height: 60, borderRadius: 20, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  glassInput: { flex: 1, height: '100%', fontSize: 16, fontWeight: '700', marginLeft: 12 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  payBtn: { height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, elevation: 8 },
  processOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', zIndex: 9999 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  resultCircle: { width: 140, height: 140, borderRadius: 70, justifyContent: 'center', alignItems: 'center' },
  ctaBtn: { height: 60, borderRadius: 30, width: 240, justifyContent: 'center', alignItems: 'center' },
});
