import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Dimensions, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../constants/colors';
import { Typography } from '../../components/Typography';
import CheckoutSummaryBar from '../../components/CheckoutSummaryBar';
import { useCartStore } from '../../store/cartStore';
import { formatPrice } from '../../utils/formatPrice';
import { haptics } from '../../utils/haptics';
import { config, getPaymentApiBaseUrl } from '../../constants/config';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import { Image } from 'expo-image';

const { width } = Dimensions.get('window');

export default function OrderReviewScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const { total, items, clearCart, shippingAddress, buyNowItem, setBuyNowItem } = useCartStore();
  const checkoutItems = buyNowItem ? [buyNowItem] : items;
  const checkoutTotal = buyNowItem ? parseFloat(buyNowItem.price) * buyNowItem.quantity : total();
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'razorpay' | 'cod'>('razorpay');

  // ─── Store Credits State ───────────────────────────────────────────
  const [useStoreCredits, setUseStoreCredits] = useState(false);
  const [availableCredits, setAvailableCredits] = useState(0);

  // ─── Payment State ──────────────────────────────────────────────
  const [pendingOrderData, setPendingOrderData] = useState<any>(null);

  // ─── Promo Code State ────────────────────────────────────────────────
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    type: string;
    value: number;
    discountAmount: number;
  } | null>(null);

  const subtotal = checkoutTotal;
  const shipping = 0;
  const codFee = selectedPaymentMethod === 'cod' ? 99 : 0;
  const discountAmount = appliedDiscount?.discountAmount ?? 0;
  
  // Calculate total before credits
  const totalBeforeCredits = Math.max(0, subtotal + shipping + codFee - discountAmount);
  
  // Applied credits cannot exceed the total
  const creditToApply = useStoreCredits ? Math.min(availableCredits, totalBeforeCredits) : 0;
  const grandTotal = Math.max(0, totalBeforeCredits - creditToApply);

  // ─── Fetch Credits ──────────────────────────────────────────────────
  React.useEffect(() => {
    const fetchCredits = async () => {
      if (!user) return;
      try {
        const token = useAuthStore.getState().token;
        const res = await fetch(`${config.appUrl}/api/app/store-credits?customerId=${user.id}`, {
          headers: { 'Authorization': `Bearer ${token || ''}` }
        });
        if (res.ok) {
          const data = await res.json();
          setAvailableCredits(data.balance || 0);
        }
      } catch (e) {
        console.error('[OrderReview] Fetch credits error:', e);
      }
    };
    fetchCredits();
  }, [user]);

  // ─── Promo Code Handlers ─────────────────────────────────────────────
  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError(null);

    try {
      const res = await fetch(`${config.appUrl}/api/app/discounts/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode.trim(), orderAmount: subtotal }),
      });
      const data = await res.json();

      if (data.success) {
        haptics.success();
        setAppliedDiscount(data.discount);
        setPromoError(null);
      } else {
        haptics.error();
        setPromoError(data.error || 'Invalid promo code');
        setAppliedDiscount(null);
      }
    } catch (e) {
      haptics.error();
      setPromoError('Could not validate code. Please try again.');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRemovePromo = () => {
    haptics.buttonTap();
    setAppliedDiscount(null);
    setPromoCode('');
    setPromoError(null);
  };

  // ─── Build the shared order payload ──────────────────────────────────
  const buildOrderData = () => {
    return {
      customerId: user?.id || 'GUEST',
      customerEmail: user?.email || shippingAddress?.email || 'guest@zicabella.com',
      customerPhone: user?.phone || shippingAddress?.phone || '',
      lineItems: checkoutItems.map((i: any) => ({
        variantId: i.variantId,
        productId: i.productId,
        quantity: i.quantity,
        price: i.price,
        name: i.title,
        image: i.image,
        sku: i.sku || `variant:${i.variantId}`,
      })),
      appliedStoreCredits: creditToApply,
      discountCode: appliedDiscount?.code || null,
      discountAmount,
      shippingAddress: {
        name: shippingAddress?.name || user?.name || 'Zica User',
        first_name: (shippingAddress?.name || user?.name || 'Zica').split(' ')[0],
        last_name: (shippingAddress?.name || user?.name || 'User').split(' ').slice(1).join(' ') || 'User',
        line1: shippingAddress?.street || shippingAddress?.line1 || 'Address not provided',
        line2: shippingAddress?.line2 || '',
        city: shippingAddress?.city || 'New Delhi',
        state: shippingAddress?.state || 'Delhi',
        pincode: shippingAddress?.zip || shippingAddress?.pincode || '110001',
        country: 'India',
        phone: shippingAddress?.phone || user?.phone || '',
        email: user?.email || shippingAddress?.email || '',
      },
      paymentMethod: selectedPaymentMethod === 'cod' ? 'COD' : 'PREPAID',
      paymentStatus: (selectedPaymentMethod === 'cod' || grandTotal > 0) ? 'pending' : 'paid',
      total: grandTotal,
      total_price: grandTotal,
      subtotal,
      deliveryFee: codFee,
      tags: `mobile-app, AppOrder, ${selectedPaymentMethod === 'cod' ? 'COD' : 'Razorpay'}${creditToApply > 0 ? ', StoreCreditUsed' : ''}`,
      note: `Mobile app order | Payment: ${selectedPaymentMethod === 'cod' ? 'COD' : 'Razorpay'}${creditToApply > 0 ? ` | Credits: ₹${creditToApply}` : ''}`,
    };
  };

  // ─── Place Order (COD) or open PaymentSheet (Razorpay) ───────────────
  const handlePlaceOrder = async () => {
    if (loading) return;
    haptics.buttonTap();

    // Strict Address Validation
    const addr = shippingAddress;
    const emailToValidate = addr?.email || user?.email;
    const isEmailValid = emailToValidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToValidate);

    const isAddrComplete = !!(
      (addr?.name || user?.name) && 
      isEmailValid &&
      (addr?.phone || user?.phone) && 
      (addr?.line1 || addr?.street) && 
      addr?.city && 
      (addr?.state || addr?.province) && 
      (addr?.pincode || addr?.zip)
    );

    if (!isAddrComplete) {
      haptics.error();
      Alert.alert(
        "Incomplete Address",
        "Please provide a complete shipping address before placing your order.",
        [{ text: "Update Address", onPress: () => navigation.navigate('DeliveryAddress') }]
      );
      return;
    }

    const token = useAuthStore.getState().token || '';
    const apiBase = getPaymentApiBaseUrl();
    const orderData = buildOrderData();

    // If grandTotal is 0 (fully covered by store credits), treat as paid
    if (grandTotal === 0 && creditToApply > 0) {
      setLoading(true);
      try {
        console.log('[OrderReview] Placing order fully covered by store credits...');
        const res = await fetch(`${apiBase}/api/app/orders/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({
            ...orderData,
            paymentMethod: 'Store Credit',
            paymentStatus: 'paid'
          }),
        });
        
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to place order');
        
        haptics.success();
        buyNowItem ? setBuyNowItem(null) : clearCart();
        
        navigation.getParent()?.reset({
            index: 1,
            routes: [
              { name: 'Main' },
              { name: 'OrderConfirmation', params: { 
                orderId: json.orderId || json.id, 
                paymentMethod: 'Store Credit', 
                estimatedDelivery: '3-5 Business Days',
                orderNumber: json.orderNumber 
              } }
            ],
          });
      } catch (e: any) {
        haptics.error();
        Alert.alert('Order Failed', e.message || 'Something went wrong.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (selectedPaymentMethod === 'cod') {
      setLoading(true);
      try {
        console.log('[OrderReview] Placing COD order...');
        const res = await fetch(`${apiBase}/api/app/orders/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({
            ...orderData,
            paymentMethod: 'COD',
            paymentStatus: 'pending'
          }),
        });
        
        const resText = await res.text();
        let json: any;
        try {
          json = JSON.parse(resText);
        } catch (e) {
          throw new Error(`Server error: ${res.status}. Please check your connection.`);
        }

        if (!res.ok) throw new Error(json.error || 'Failed to place order');
        
        haptics.success();
        buyNowItem ? setBuyNowItem(null) : clearCart();
        
        navigation.getParent()?.reset({
            index: 1,
            routes: [
              { name: 'Main' },
              { name: 'OrderConfirmation', params: { 
                orderId: json.orderId || json.id, 
                paymentMethod: 'COD', 
                estimatedDelivery: '3-5 Business Days',
                orderNumber: json.orderNumber 
              } }
            ],
          });
      } catch (e: any) {
        haptics.error();
        console.error('[OrderReview] COD placement error:', e.message);
        Alert.alert('Order Failed', e.message || 'Something went wrong. Please try again.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Razorpay: Step 1 — create order on backend, then navigate to Payment Screen
    setLoading(true);
    try {
      console.log('[OrderReview] Initiating Razorpay order...');
      const orderRes = await fetch(`${apiBase}/api/app/payment/create-order`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Accept': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ 
          amount: grandTotal, 
          currency: 'INR', 
          receipt: `zb_${Date.now()}`,
          orderData: orderData // Pass the full order data to pre-create the record
        }),
      });
      
      const resText = await orderRes.text();
      let orderJson: any;
      try {
        orderJson = JSON.parse(resText);
      } catch (e) {
        throw new Error('Server returned an invalid response. Please try again.');
      }

      if (!orderRes.ok || !orderJson.order_id) {
        throw new Error(orderJson.error || 'Failed to create payment order.');
      }
      
      setLoading(false);
      
      navigation.navigate('RazorpayPayment', {
        amount: grandTotal,
        orderId: orderJson.order_id,
        razorpayKeyId: orderJson.key_id,
        prefill: {
          name: shippingAddress?.name || user?.name || '',
          email: user?.email || shippingAddress?.email || '',
          contact: (user?.phone || shippingAddress?.phone || '').replace(/^\+91/, ''),
        },
        orderData: orderData,
      });
    } catch (e: any) {
      haptics.error();
      console.error('[OrderReview] Razorpay initiation error:', e.message);
      Alert.alert('Payment Error', e.message || 'Could not start payment. Please try again.');
      setLoading(false);
    }
  };



  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity 
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')} 
          style={[styles.back, { backgroundColor: colors.surface }]}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Typography size={7} color={colors.textExtraLight} weight="600" style={styles.stepTag}>STEP 2 OF 2</Typography>
          <Typography size={14} color={colors.text} weight="700">REVIEW & PAY</Typography>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView 
        contentContainerStyle={[styles.scroll, { paddingBottom: 180 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── ITEMS IN ORDER ─── */}
        <View style={styles.section}>
          <Typography size={7} weight="700" color={colors.textExtraLight} style={styles.sectionLabel}>ITEMS IN ORDER</Typography>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight, padding: 16 }]}>
            {checkoutItems.map((item, idx) => (
              <View key={item.id || idx} style={[styles.itemRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 12, marginTop: 12 }]}>
                <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: colors.background, overflow: 'hidden' }}>
                  {item.image && <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" />}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Typography size={12} weight="600" color={colors.text} numberOfLines={1}>{item.title}</Typography>
                  <Typography size={10} color={colors.textMuted} style={{ marginTop: 4 }}>
                    Qty: {item.quantity}{(item as any).size ? ` · ${(item as any).size}` : ''}
                  </Typography>
                </View>
                <Typography size={13} weight="700" color={colors.text}>{formatPrice(Number(item.price || 0) * Number(item.quantity || 1))}</Typography>
              </View>
            ))}
          </View>
        </View>

        {/* ─── DELIVERY ADDRESS ─── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Typography size={7} weight="700" color={colors.textExtraLight} style={styles.sectionLabel}>DELIVERY</Typography>
            <TouchableOpacity 
              onPress={() => navigation.navigate('DeliveryAddress')}
              accessibilityLabel="Edit shipping address"
              accessibilityRole="button"
            >
              <Typography size={7} weight="600" color={colors.foreground}>EDIT</Typography>
            </TouchableOpacity>
          </View>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
             <Typography size={12} weight="600" color={colors.text}>{shippingAddress?.name || user?.name}</Typography>
             <Typography size={9} weight="600" color={colors.textExtraLight} style={{ marginTop: 2 }}>{shippingAddress?.email || user?.email}</Typography>
             <Typography size={10} color={colors.textSecondary} style={{ marginTop: 6, lineHeight: 16 }}>
                {shippingAddress?.street || shippingAddress?.line1}{'\n'}
                {shippingAddress?.city}, {shippingAddress?.state} {shippingAddress?.zip || shippingAddress?.pincode}
             </Typography>
             <Typography size={10} color={colors.textSecondary} style={{ marginTop: 8 }}>{shippingAddress?.phone || user?.phone}</Typography>
          </View>
        </View>

        {/* ─── PROMO CODE ─── */}
        <View style={styles.section}>
          {appliedDiscount ? (
            <View style={[styles.promoApplied, { backgroundColor: 'rgba(52,199,89,0.08)', borderColor: 'rgba(52,199,89,0.2)' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Ionicons name="checkmark-circle" size={18} color="#34C759" />
                <View>
                  <Typography size={11} weight="800" color="#34C759">{appliedDiscount.code}</Typography>
                  <Typography size={9} color="#34C759" style={{ opacity: 0.8 }}>
                    {appliedDiscount.type === 'percentage'
                      ? `${appliedDiscount.value}% off applied`
                      : `₹${appliedDiscount.value} off applied`}
                    {' · '}Saving {formatPrice(discountAmount)}
                  </Typography>
                </View>
              </View>
              <TouchableOpacity onPress={handleRemovePromo} style={styles.removeBtn}>
                <Ionicons name="close-circle" size={20} color="rgba(52,199,89,0.5)" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.promoRow}>
              <TextInput
                value={promoCode}
                onChangeText={(v) => { setPromoCode(v.toUpperCase()); setPromoError(null); }}
                placeholder="Enter promo code"
                placeholderTextColor={colors.textExtraLight}
                autoCapitalize="characters"
                style={[styles.promoInput, { 
                  backgroundColor: colors.surface, 
                  borderColor: promoError ? 'rgba(255,59,48,0.4)' : colors.borderLight, 
                  color: colors.text 
                }]}
              />
              <TouchableOpacity
                onPress={handleApplyPromo}
                disabled={promoLoading || !promoCode.trim()}
                style={[styles.applyBtn, { 
                  backgroundColor: promoCode.trim() ? colors.foreground : colors.surface,
                  opacity: !promoCode.trim() ? 0.4 : 1,
                  borderColor: colors.borderLight,
                  borderWidth: 1.5,
                }]}
              >
                {promoLoading ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Typography size={10} weight="800" color={promoCode.trim() ? colors.background : colors.textMuted} style={{ letterSpacing: 1 }}>
                    APPLY
                  </Typography>
                )}
              </TouchableOpacity>
            </View>
          )}

          {promoError && (
            <View style={styles.promoErrorRow}>
              <Ionicons name="alert-circle-outline" size={12} color="rgba(255,59,48,0.8)" />
              <Typography size={9} color="rgba(255,59,48,0.8)" weight="600" style={{ marginLeft: 4 }}>
                {promoError}
              </Typography>
            </View>
          )}
        </View>

        {/* ─── STORE CREDITS ─── */}
        {availableCredits > 0 && (
          <View style={styles.section}>
            <Typography size={7} weight="700" color={colors.textExtraLight} style={styles.sectionLabel}>STORE CREDITS</Typography>
            <TouchableOpacity
              style={[
                styles.optionCard,
                { backgroundColor: colors.surface, borderColor: useStoreCredits ? colors.success : colors.borderLight },
              ]}
              onPress={() => { haptics.buttonTap(); setUseStoreCredits(!useStoreCredits); }}
              activeOpacity={0.8}
              accessibilityLabel={`Use store credits. Available: ${formatPrice(availableCredits)}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: useStoreCredits }}
            >
              <View style={[styles.iconBox, { backgroundColor: useStoreCredits ? colors.success : colors.background }]}>
                <Ionicons name="wallet-outline" size={18} color={useStoreCredits ? colors.background : colors.textMuted} />
              </View>
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Typography size={12} weight="800" color={colors.text}>Use Store Credits</Typography>
                <Typography size={9} weight="600" color={colors.textExtraLight} style={{ marginTop: 4 }}>Available Balance: {formatPrice(availableCredits)}</Typography>
              </View>
              <View style={[styles.radio, { borderColor: useStoreCredits ? colors.success : colors.borderLight }]}>
                {useStoreCredits && <View style={[styles.radioInner, { backgroundColor: colors.success }]} />}
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── PAYMENT METHOD ─── */}
        {grandTotal > 0 && (
          <View style={styles.section}>
            <Typography size={7} weight="700" color={colors.textExtraLight} style={styles.sectionLabel}>PAYMENT METHOD</Typography>
            <View style={{ gap: 10 }}>
              <TouchableOpacity
                style={[
                  styles.optionCard,
                  { backgroundColor: colors.surface, borderColor: selectedPaymentMethod === 'razorpay' ? colors.foreground : colors.borderLight },
                ]}
                onPress={() => { haptics.buttonTap(); setSelectedPaymentMethod('razorpay'); }}
                activeOpacity={0.8}
                accessibilityLabel="Pay now with Razorpay"
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedPaymentMethod === 'razorpay' }}
              >
                <View style={[styles.iconBox, { backgroundColor: selectedPaymentMethod === 'razorpay' ? colors.foreground : colors.background }]}>
                  <Ionicons name="flash-outline" size={16} color={selectedPaymentMethod === 'razorpay' ? colors.background : colors.textMuted} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Typography size={11} weight="800" color={colors.text}>Pay Now</Typography>
                  <Typography size={8} weight="600" color={colors.textExtraLight} style={{ marginTop: 2 }}>UPI / Card / Netbanking via Razorpay</Typography>
                </View>
                <View style={[styles.radio, { borderColor: selectedPaymentMethod === 'razorpay' ? colors.foreground : colors.borderLight }]}>
                  {selectedPaymentMethod === 'razorpay' && <View style={[styles.radioInner, { backgroundColor: colors.foreground }]} />}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionCard,
                  { backgroundColor: colors.surface, borderColor: selectedPaymentMethod === 'cod' ? colors.foreground : colors.borderLight },
                ]}
                onPress={() => { haptics.buttonTap(); setSelectedPaymentMethod('cod'); }}
                activeOpacity={0.8}
                accessibilityLabel="Pay with Cash on Delivery"
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedPaymentMethod === 'cod' }}
              >
                <View style={[styles.iconBox, { backgroundColor: selectedPaymentMethod === 'cod' ? colors.foreground : colors.background }]}>
                  <Ionicons name="cash-outline" size={16} color={selectedPaymentMethod === 'cod' ? colors.background : colors.textMuted} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Typography size={11} weight="800" color={colors.text}>Cash on Delivery</Typography>
                  <Typography size={8} weight="600" color={colors.textExtraLight} style={{ marginTop: 2 }}>Extra ₹99 service fee applies</Typography>
                </View>
                <View style={[styles.radio, { borderColor: selectedPaymentMethod === 'cod' ? colors.foreground : colors.borderLight }]}>
                  {selectedPaymentMethod === 'cod' && <View style={[styles.radioInner, { backgroundColor: colors.foreground }]} />}
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ─── ORDER SUMMARY ─── */}
        <View style={styles.section}>
          <Typography size={7} weight="700" color={colors.textExtraLight} style={styles.sectionLabel}>ORDER SUMMARY</Typography>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
             <View style={styles.row}>
               <Typography size={10} color={colors.textSecondary}>Subtotal</Typography>
               <Typography size={10} weight="600" color={colors.text}>{formatPrice(subtotal)}</Typography>
             </View>
             {codFee > 0 && (
               <View style={styles.row}>
                 <Typography size={10} color={colors.textSecondary}>COD Service Fee</Typography>
                 <Typography size={10} weight="600" color={colors.text}>{formatPrice(codFee)}</Typography>
               </View>
             )}
             <View style={styles.row}>
               <Typography size={10} color={colors.textSecondary}>Shipping</Typography>
               <Typography size={10} weight="600" color={colors.success}>FREE</Typography>
             </View>
             {discountAmount > 0 && (
               <View style={styles.row}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                   <Ionicons name="pricetag-outline" size={12} color="#34C759" />
                   <Typography size={10} color="#34C759" weight="700">{appliedDiscount?.code}</Typography>
                 </View>
                 <Typography size={10} color="#34C759" weight="700">−{formatPrice(discountAmount)}</Typography>
               </View>
             )}
             {creditToApply > 0 && (
               <View style={styles.row}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                   <Ionicons name="wallet-outline" size={12} color="#34C759" />
                   <Typography size={10} color="#34C759" weight="700">Store Credits</Typography>
                 </View>
                 <Typography size={10} color="#34C759" weight="700">−{formatPrice(creditToApply)}</Typography>
               </View>
             )}
             <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
             <View style={styles.row}>
               <Typography size={12} weight="700" color={colors.text}>Grand Total</Typography>
               <Typography size={18} weight="800" color={colors.text}>{formatPrice(grandTotal)}</Typography>
             </View>
          </View>
        </View>

        <View style={styles.legalBox}>
          <Typography size={8} color={colors.textMuted} style={{ textAlign: 'center', lineHeight: 14 }}>
            By placing this order, you authorize Zica Bella to charge your payment method and agree to our Terms of Service & Refund Policy.
          </Typography>
        </View>
      </ScrollView>

      {/* Summary Bar */}
      <CheckoutSummaryBar 
        itemCount={checkoutItems.length}
        total={grandTotal}
        primaryLabel={loading ? "PROCESSING..." : "PLACE ORDER"}
        onPrimaryPress={handlePlaceOrder}
        loading={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16 },
  back: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { alignItems: 'center' },
  stepTag: { letterSpacing: 2, marginBottom: 2 },
  scroll: { paddingHorizontal: 24, paddingTop: 20 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionLabel: { letterSpacing: 2, marginLeft: 4, marginBottom: 12 },
  card: { padding: 24, borderRadius: 28, borderWidth: 1.5 },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 },
  divider: { height: 1, marginVertical: 16, opacity: 0.5 },
  legalBox: { marginTop: 12, paddingHorizontal: 30, opacity: 0.6 },
  // Payment option styles
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  radioInner: { width: 8, height: 8, borderRadius: 4 },
  // Promo Code styles
  promoRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  promoInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  applyBtn: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  promoApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  removeBtn: { padding: 4 },
  promoErrorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingLeft: 2 },
});
