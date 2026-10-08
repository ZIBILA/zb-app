import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Animated, ScrollView, ActivityIndicator, Linking, Share,
  Platform, Alert,
} from 'react-native';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../components/GlassView';
import GlassHeader from '../components/GlassHeader';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { formatPrice } from '../utils/formatPrice';
import { RootStackParamList } from '../navigation/types';
import { haptics } from '../utils/haptics';
import { config } from '../constants/config';
import { Typography } from '../components/Typography';
import { useAuthStore } from '../store/authStore';
import { useCartStore } from '../store/cartStore';
import { useUIStore } from '../store/uiStore';
import { Image } from 'expo-image';
import { trackOrder } from '../services/shipmentService';
import TrackingTimeline from '../components/TrackingTimeline';
import RequestSummaryCard from '../components/RequestSummaryCard';

import { getOrderStatusLabel, resolveOrderDisplayStatus } from '../utils/orderStatus';
import { resolveImageUrl } from '../utils/imageUtils';

export default function OrderDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { orderId } = route.params || {};
  const colors = useColors();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackingLive, setTrackingLive] = useState<any | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [loadingTracking, setLoadingTracking] = useState(false);
  const [trackingFetchError, setTrackingFetchError] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // ─── All hooks MUST be declared before any early return ────────────
  const setTabBarVisible = useUIStore(s => s.setTabBarVisible);


  // Guard inside the callback if `order` might be null.
  const isCancelledMemo = useMemo(() => {
    if (!order) return false;
    const s = String(order.status || '').toLowerCase();
    const f = String(order.fulfillmentStatus || '').toLowerCase();
    return Boolean(order.cancelledBy) || s.includes('cancel') || f.includes('cancel');
  }, [order]);

  const steps = useMemo(() => {
    if (!order) return [];
    const status = String(order.status || '').toLowerCase();
    const hasActiveReturn = order.returnRequests?.some((r: any) => r.status !== 'cancelled') || false;
    const hasActiveExchange = order.exchangeRequests?.some((e: any) => e.status !== 'cancelled') || false;
    const isReturn = status.includes('return') || status.includes('exchange') || status === 'returned' || status === 'exchanged' || hasActiveReturn || hasActiveExchange;
    
    if (isReturn) {
      return [
        { step: 'order_placed', label: 'Order Placed' },
        { step: 'delivered', label: 'Delivered' },
        { step: 'return_requested', label: 'Return/Exchange Requested' },
        { step: 'pickup_approved', label: 'Pickup Manifested' },
        { step: 'refund_completed', label: 'Refund/Exchange Completed' },
      ];
    }

    return [
      { step: 'order_placed', label: 'Order Placed' },
      { step: 'confirmed', label: 'Confirmed' },
      { step: 'shipped', label: 'Shipped' },
      { step: 'out_for_delivery', label: 'Out for Delivery' },
      { step: 'delivered', label: 'Delivered' },
    ];
  }, [order]);
  const timelineByStep = useMemo(() => {
    const tl = Array.isArray(order?.statusTimeline) ? order.statusTimeline : [];
    const m = new Map<string, string | null>();
    tl.forEach((t: any) => m.set(t.step, t.completedAt || null));
    return m;
  }, [order]);

  const reverseShipment = useMemo(() => {
    if (!order || !Array.isArray(order.shipments)) return null;
    return order.shipments.find((s: any) => String(s.awb || s.trackingNumber || '').startsWith('ZBRET') || String(s.status || '').includes('pickup'));
  }, [order]);

  const fetchOrderDetails = useCallback(async (isPolling = false) => {
    if (!orderId) return;
    try {
      if (!isPolling) setLoading(true);
      const token = useAuthStore.getState().token || '';
      const user = useAuthStore.getState().user;
      const guestAddress = useCartStore.getState().shippingAddress;
      
      const params = new URLSearchParams();
      if (user?.id) params.set('customerId', user.id);
      if (user?.phone) params.set('phone', user.phone);
      if (user?.email) params.set('email', user.email);
      
      if (!user?.id) {
        if (guestAddress?.phone) params.set('phone', guestAddress.phone);
        if (guestAddress?.email) params.set('email', guestAddress.email);
      }

      const res = await fetch(`${config.appUrl}/api/app/orders/${orderId}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/json' }
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error(`Server error (${res.status})`);

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch order');
      if (json.order) {
        if (isMounted.current) {
          setOrder(json.order);
          setError(null);
        }
      }
    } catch (e: any) {
      console.error('Fetch Order Detail Error:', e);
      if (!isPolling && isMounted.current) {
        setError(e.message || 'Failed to load order details');
      }
    } finally {
      if (!isPolling && isMounted.current) {
        setLoading(false);
      }
    }
  }, [orderId]);

  useFocusEffect(
    useCallback(() => {
      setTabBarVisible(false);
      fetchOrderDetails();
      return () => {
        setTabBarVisible(true);
      };
    }, [setTabBarVisible, fetchOrderDetails])
  );

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    fetchOrderDetails();
    const interval = setInterval(() => fetchOrderDetails(true), 60000);
    return () => clearInterval(interval);
  }, [fadeAnim, fetchOrderDetails]);

  useEffect(() => {
    const fetchTracking = async () => {
      if (!orderId) return;
      try {
        setLoadingTracking(true);
        setTrackingFetchError(null);
        const token = useAuthStore.getState().token || '';
        const user = useAuthStore.getState().user;
        const guestAddress = useCartStore.getState().shippingAddress;
        
        const params = new URLSearchParams();
        if (user?.id) params.set('customerId', user.id);
        if (user?.phone) params.set('phone', user.phone);
        if (user?.email) params.set('email', user.email);
        
        if (!user?.id) {
          if (guestAddress?.phone) params.set('phone', guestAddress.phone);
          if (guestAddress?.email) params.set('email', guestAddress.email);
        }

        const res = await fetch(`${config.appUrl}/api/orders/${orderId}/tracking?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to fetch tracking');
        setTrackingData(json);
      } catch (e: any) {
        console.error('Fetch Tracking Error:', e);
        setTrackingFetchError(e.message || 'Failed to load tracking data');
      } finally {
        setLoadingTracking(false);
      }
    };

    fetchTracking();
  }, [orderId]);

  const refreshTracking = useCallback(async () => {
    const awb = order?.trackingNumber || order?.tracking?.awb;
    if (!awb) return;
    try {
      setTrackingError(null);
      const data = await trackOrder({ awb });
      if (isMounted.current) {
        setTrackingLive(data);
      }
    } catch (e: any) {
      if (isMounted.current) {
        setTrackingError(e?.message || 'Failed to fetch tracking');
      }
    }
  }, [order]);

  const isReturnWindowOpen = useMemo(() => {
    const isDelivered = (order?.deliveryStatus || '').toLowerCase() === 'delivered';
    if (!isDelivered) return false;
    // Find the 'delivered' step in timeline, fallback to order.updatedAt
    const deliveredAt = timelineByStep.get('delivered') || order?.updatedAt;
    if (!deliveredAt) return false;
    
    const deliveredDate = new Date(deliveredAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - deliveredDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 10;
  }, [order, timelineByStep]);

  if (!orderId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Typography color={colors.text}>Order ID is missing.</Typography>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')} style={{ marginTop: 20 }}>
          <Typography color={colors.iosBlue}>Go Back</Typography>
        </TouchableOpacity>
      </View>
    );
  }

  const contactSupport = () => {
    haptics.buttonTap();
    navigation.navigate('Main', { screen: 'ChatTab' });
  };

  const handleCancelOrder = async () => {
    Alert.alert("Cancel Order", "Are you sure you want to cancel this order?", [
      { text: "No", style: "cancel" },
      { 
        text: "Yes, Cancel", 
        style: "destructive",
        onPress: async () => {
          try {
            setLoading(true);
            const token = useAuthStore.getState().token || '';
            const response = await fetch(`${config.appUrl}/api/app/orders/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ orderId: order.id, reason: 'User cancelled' })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            haptics.success();
            Alert.alert("Success", "Your order has been cancelled.");
            fetchOrderDetails();
          } catch (e: any) {
            haptics.error();
            Alert.alert("Error", e.message || "Failed to cancel order");
          } finally {
            setLoading(false);
          }
        }
      }
    ]);
  };

  if (loading && !order) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="small" color={colors.foreground} />
      </View>
    );
  }

  if (error && !order) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 40 }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Typography size={16} weight="700" color={colors.text} style={{ marginTop: 24, textAlign: 'center' }}>Unable to Load Order</Typography>
        <Typography size={13} color={colors.textMuted} style={{ marginTop: 8, textAlign: 'center' }}>{error}</Typography>
        <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.foreground }]} onPress={() => fetchOrderDetails()}>
          <Typography size={12} weight="800" color={colors.background}>TRY AGAIN</Typography>
        </TouchableOpacity>
      </View>
    );
  }

  if (!order) return null;

  const isCancelled =
    Boolean(order.cancelledBy) ||
    String(order.status || '').toLowerCase().includes('cancel') ||
    String(order.fulfillmentStatus || '').toLowerCase().includes('cancel');
  const isDelivered = (order.deliveryStatus || '').toLowerCase() === 'delivered';
  const orderNumber = order.orderNumber || order.id?.slice(0, 8);
  const displayLabel = resolveOrderDisplayStatus(order);
  const statusColor = (() => {
    if (isCancelled) return '#FF3B30';
    switch (displayLabel) {
      case 'Return Requested':
      case 'Exchange Requested':
      case 'Return / Exchange Requested':
      case 'Return Approved':
      case 'Exchange Approved':
      case 'Refund Pending':
      case 'Pickup Scheduled':
      case 'Return Item Received':
      case 'Exchange Item Received':
        return '#FF9F0A';
      case 'Returned':
      case 'Exchanged':
        return '#8E8E93';
      case 'Delivered':
        return '#34C759';
      case 'Shipped / Out for Delivery':
        return '#AF52DE';
      case 'Ready for Dispatch':
        return '#FF9500';
      case 'Order Placed':
        return '#007AFF';
      default:
        return colors.textSecondary;
    }
  })();
  // New function to cancel pending return or exchange request
  const handleCancelReturnExchange = async () => {
    const pendingReq = order.returnRequests?.find((r: any) => r.status === 'pending_approval')
      || order.exchangeRequests?.find((e: any) => e.status === 'pending_approval');
    if (!pendingReq) {
      Alert.alert('Info', 'No pending return or exchange to cancel.');
      return;
    }
    Alert.alert('Cancel Request', 'Are you sure you want to cancel this return/exchange request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            setLoading(true);
            const token = useAuthStore.getState().token || '';
            const response = await fetch(`${config.appUrl}/api/returns/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ returnRequestId: pendingReq.id })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            haptics.success();
            Alert.alert('Success', 'Return/Exchange request cancelled.');
            fetchOrderDetails();
          } catch (e: any) {
            haptics.error();
            Alert.alert('Error', e.message || 'Failed to cancel request');
          } finally {
            setLoading(false);
          }
        }
      }
    ]);
  };


  const handleReturn = () => {
    haptics.buttonTap();
    navigation.navigate('ReturnRequest', { order });
  };

  const handleExchange = () => {
    haptics.buttonTap();
    navigation.navigate('ExchangeSelectProduct', { order });
  };

  const hasActiveReturn = order.returnRequests?.some((r: any) => r.status !== 'cancelled') || false;
  const hasActiveExchange = order.exchangeRequests?.some((e: any) => e.status !== 'cancelled') || false;
  const hasPendingRequest = order.returnRequests?.some((r: any) => r.status === 'pending_approval') || 
                            order.exchangeRequests?.some((e: any) => e.status === 'pending_approval') || false;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader title={`Order #${orderNumber}`} showBack />

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 74, paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.statusCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.01)' }]}>
          <View style={{ flex: 1 }}>
            <Typography size={10} weight="700" color={colors.textExtraLight} style={{ letterSpacing: 0.5, marginBottom: 4 }}>STATUS</Typography>
            <Typography size={17} weight="800" color={colors.text}>
              {isCancelled
                ? displayLabel
                : (['payment_failed', 'payment_pending', 'failed', 'pending'].includes((order.status || '').toLowerCase()) || (order.status || '').toLowerCase().includes('failed'))
                  ? 'Payment Failed'
                  : displayLabel}
            </Typography>
            <Typography size={11} weight="600" color={colors.textMuted} style={{ marginTop: 6 }}>
              {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </Typography>
          </View>
          <View style={[styles.statusLine, { backgroundColor: statusColor }]} />
        </View>

        {!isCancelled && (
          <View style={styles.stepperBox}>
            {steps.map((s, idx) => {
              const sStatus = (order.status || '').toLowerCase();
              const isPaymentFailed = sStatus.includes('failed') || sStatus === 'payment_pending' || sStatus === 'pending';
              const completedAt = timelineByStep.get(s.step);
              // Only show 'Order Placed' as completed if payment didn't fail
              const isCompleted = !!completedAt && !(isPaymentFailed && s.step === 'order_placed');
              return (
                <View key={s.step} style={styles.stepItem}>
                  <View style={styles.stepIndicator}>
                    <View style={[styles.stepDot, { backgroundColor: isCompleted ? colors.foreground : (isPaymentFailed && s.step === 'order_placed' ? '#FF3B30' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')) }]}>
                      {isCompleted && <Ionicons name="checkmark" size={10} color={colors.background} />}
                      {(isPaymentFailed && s.step === 'order_placed') && <Ionicons name="close" size={10} color="#FFFFFF" />}
                    </View>
                    {idx < steps.length - 1 && <View style={[styles.stepLine, { backgroundColor: isCompleted && timelineByStep.get(steps[idx+1].step) ? colors.foreground : colors.borderExtraLight }]} />}
                  </View>
                  <View style={styles.stepContent}>
                    <Typography size={11} weight={(isCompleted || (isPaymentFailed && s.step === 'order_placed')) ? "700" : "500"} color={isCompleted ? colors.text : (isPaymentFailed && s.step === 'order_placed' ? '#FF3B30' : colors.textExtraLight)}>
                      {(isPaymentFailed && s.step === 'order_placed' ? 'ORDER FAILED' : s.label.toUpperCase())}
                    </Typography>
                    {completedAt && <Typography size={9} color={colors.textMuted} style={{ marginTop: 2 }}>{new Date(completedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Typography>}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {order.trackingNumber && (
          <TouchableOpacity style={[styles.trackingPill, { borderColor: colors.borderExtraLight }]} onPress={() => order.trackingUrl && Linking.openURL(order.trackingUrl)}>
            <View style={{ flex: 1 }}>
              <Typography size={10} weight="700" color={colors.textExtraLight}>TRACKING</Typography>
              <Typography size={13} weight="600" color={colors.text} style={{ marginTop: 2 }}>{order.courier ? `${order.courier} • ` : ''}{order.trackingNumber}</Typography>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textExtraLight} />
          </TouchableOpacity>
        )}

        {reverseShipment && (
          <TouchableOpacity 
            style={[styles.trackingPill, { borderColor: '#E0A96D', borderStyle: 'dashed', borderWidth: 1.5, marginTop: 12, backgroundColor: isDark ? 'rgba(224, 169, 109, 0.05)' : 'rgba(224, 169, 109, 0.02)' }]} 
            onPress={() => reverseShipment.trackingUrl && Linking.openURL(reverseShipment.trackingUrl)}
          >
            <View style={{ flex: 1 }}>
              <Typography size={10} weight="800" color="#E0A96D" style={{ letterSpacing: 0.5 }}>RETURN PICKUP LOGISTICS</Typography>
              <Typography size={13} weight="600" color={colors.text} style={{ marginTop: 2 }}>
                {reverseShipment.courier ? `${reverseShipment.courier} • ` : ''}{reverseShipment.awb || reverseShipment.trackingNumber}
              </Typography>
              <Typography size={11} color={colors.textMuted} style={{ marginTop: 2 }}>
                Status: {reverseShipment.status === 'pickup_pending' ? 'Awaiting Pickup Agent' : reverseShipment.status.toUpperCase()}
              </Typography>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#E0A96D" />
          </TouchableOpacity>
        )}

        <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1, marginTop: 24, marginBottom: 12 }}>ORDER ITEMS</Typography>
        <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }]}>
          {order.items?.map((item: any, idx: number) => (
            <TouchableOpacity 
              key={item.id || idx} 
              style={[styles.itemRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.borderExtraLight, paddingTop: 16, marginTop: 16 }]}
              activeOpacity={item.handle ? 0.6 : 1}
              onPress={() => {
                if (item.handle) {
                  haptics.buttonTap();
                  navigation.navigate('ProductDetail', { handle: item.handle });
                }
              }}
            >
              <View style={[styles.itemThumb, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}>
                {resolveImageUrl(item.image) ? (
                  <Image source={{ uri: resolveImageUrl(item.image)! }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Ionicons name="bag-handle-outline" size={20} color={colors.textExtraLight} />
                )}
              </View>
              <View style={{ flex: 1, marginLeft: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Typography size={12} weight="700" color={colors.text} numberOfLines={1} style={{ textTransform: 'uppercase', flex: 1 }}>{item.title || item.fullTitle}</Typography>
                  {item.handle && <Ionicons name="chevron-forward" size={12} color={colors.textExtraLight} />}
                </View>
                <Typography size={10} color={colors.textMuted} style={{ marginTop: 4 }}>
                  {item.size ? `SIZE: ${item.size} • ` : ''}QTY: {item.quantity} • {formatPrice(item.price)}
                </Typography>
              </View>
              <Typography size={14} weight="800" color={colors.text}>{formatPrice(item.price * item.quantity)}</Typography>
            </TouchableOpacity>
          ))}
        </View>

        <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1, marginTop: 24, marginBottom: 12 }}>DELIVERY ADDRESS</Typography>
        <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }]}>
          <Typography size={13} weight="800" color={colors.text}>{order.shippingAddress?.name || 'CUSTOMER'}</Typography>
          <Typography size={11} color={colors.textMuted} style={{ marginTop: 6, lineHeight: 18 }}>
            {order.shippingAddress?.address1 || order.shippingAddress?.street}
            {order.shippingAddress?.address2 ? `\n${order.shippingAddress.address2}` : ''}
            {`\n${order.shippingAddress?.city}, ${order.shippingAddress?.province || order.shippingAddress?.state}`}
            {`\n${order.shippingAddress?.zip || order.shippingAddress?.pincode}`}
            {`\n${order.shippingAddress?.country || 'INDIA'}`}
          </Typography>
          {(order.shippingAddress?.phone || order.customer?.phone) && (
            <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderExtraLight }}>
              <Typography size={10} weight="700" color={colors.textExtraLight}>CONTACT</Typography>
              <Typography size={12} color={colors.text} style={{ marginTop: 2 }}>{order.shippingAddress?.phone || order.customer?.phone}</Typography>
            </View>
          )}
        </View>

        <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1, marginTop: 24, marginBottom: 12 }}>ORDER INFO</Typography>
        <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }]}>
          <View style={styles.priceRow}>
            <Typography size={11} color={colors.textMuted}>Payment Method</Typography>
            <Typography size={11} weight="700" color={colors.text} style={{ textTransform: 'uppercase' }}>{order.paymentMethod || 'Razorpay'}</Typography>
          </View>
          <View style={[styles.priceRow, { marginTop: 10 }]}>
            <Typography size={11} color={colors.textMuted}>Order Type</Typography>
            <Typography size={11} weight="700" color={colors.text}>Mobile App</Typography>
          </View>
        </View>

        {/* Live Tracking Timeline Section */}
        {(order.delhivery_awb || (trackingData && trackingData.awb)) ? (
          <>
            <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1, marginTop: 24, marginBottom: 12 }}>TRACKING</Typography>
            <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }]}>
              {loadingTracking && !trackingData ? (
                <ActivityIndicator size="small" color={colors.foreground} style={{ paddingVertical: 10 }} />
              ) : trackingFetchError ? (
                <Typography size={12} color={colors.error}>{trackingFetchError}</Typography>
              ) : trackingData ? (
                <>
                  <TrackingTimeline timeline={trackingData.timeline} currentStatus={trackingData.currentStatus} />
                  {trackingData.awb && (
                    <TouchableOpacity 
                      style={{ marginTop: 12, alignItems: 'center' }} 
                      onPress={() => Linking.openURL('https://shiprocket.co/tracking/' + trackingData.awb)}
                    >
                      <Typography color={colors.iosBlue} style={{ textDecorationLine: 'underline', fontSize: 13, fontWeight: '600' }}>
                        Track shipment
                      </Typography>
                    </TouchableOpacity>
                  )}
                </>
              ) : null}
            </View>
          </>
        ) : null}

        {/* Returns & exchanges linked to this order (R_ / E_ ids, pickup, refund, replacement) */}
        {(() => {
          const requestCards = [
            ...(order.returnRequests || []).filter((r: any) => !r.isInternal && r.status !== 'cancelled' && r.summary),
            ...(order.exchangeRequests || []).filter((e: any) => e.status !== 'cancelled' && e.summary),
          ];
          if (requestCards.length === 0) return null;
          return (
            <>
              <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1, marginTop: 24, marginBottom: 12 }}>RETURNS & EXCHANGES</Typography>
              {requestCards.map((req: any) => (
                <RequestSummaryCard key={req.id} summary={req.summary}>
                  {req.createdAt ? (
                    <Typography size={11} color={colors.textMuted} style={{ marginBottom: 2 }}>
                      Requested on {new Date(req.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Typography>
                  ) : null}
                  {req.reason ? <Typography size={11} color={colors.textMuted}>Reason: {req.reason}</Typography> : null}
                </RequestSummaryCard>
              ))}
            </>
          );
        })()}

        <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1, marginTop: 24, marginBottom: 12 }}>BILLING SUMMARY</Typography>
        <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }]}>
          <View style={styles.priceRow}>
            <Typography size={12} color={colors.textMuted}>Subtotal</Typography>
            <Typography size={12} weight="700" color={colors.text}>{formatPrice(order.subtotalPrice || order.totalPrice)}</Typography>
          </View>
          <View style={[styles.priceRow, { marginTop: 10 }]}>
            <Typography size={12} color={colors.textMuted}>Shipping</Typography>
            <Typography size={12} weight="800" color="#34C759">FREE</Typography>
          </View>
          <View style={[styles.totalRow, { borderTopColor: colors.borderExtraLight, marginTop: 16, paddingTop: 16 }]}>
            <Typography size={15} weight="800" color={colors.text}>
              TOTAL
            </Typography>
            <Typography size={20} weight="800" color={colors.text}>{formatPrice(order.totalPrice)}</Typography>
          </View>
        </View>
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={{ gap: 12 }}>
          {isReturnWindowOpen && !hasActiveReturn && !hasActiveExchange ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={handleReturn} activeOpacity={0.7} style={{ flex: 1, borderRadius: 24, overflow: 'hidden' }}>
                <GlassView 
                  intensity={isDark ? 30 : 60} 
                  tint={isDark ? 'dark' : 'light'} 
                  style={[styles.mainBtn, { 
                    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)', 
                    borderWidth: 1, 
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' 
                  }]}
                >
                  <Typography size={13} weight="700" color={colors.text}>Return</Typography>
                </GlassView>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleExchange} activeOpacity={0.7} style={{ flex: 1, borderRadius: 24, overflow: 'hidden' }}>
                <GlassView 
                  intensity={isDark ? 30 : 60} 
                  tint={isDark ? 'dark' : 'light'} 
                  style={[styles.mainBtn, { 
                    backgroundColor: colors.foreground, 
                  }]}
                >
                  <Typography size={13} weight="700" color={colors.background}>Exchange</Typography>
                </GlassView>
              </TouchableOpacity>
            </View>
          ) : null}
          {/* Cancel button for pending return/exchange requests */}
          {hasPendingRequest ? (
            <TouchableOpacity onPress={handleCancelReturnExchange} activeOpacity={0.7} style={{ borderRadius: 24, overflow: 'hidden', marginTop: 12 }}>
              <GlassView 
                intensity={isDark ? 30 : 60} 
                tint={isDark ? 'dark' : 'light'} 
                style={[styles.mainBtn, { 
                  backgroundColor: 'rgba(255, 59, 48, 0.08)', 
                  borderWidth: 1, 
                  borderColor: 'rgba(255, 59, 48, 0.2)' 
                }]}
              >
                <Typography size={13} weight="700" color="#FF3B30">Cancel Return/Exchange</Typography>
              </GlassView>
            </TouchableOpacity>
          ) : null}
          
          {!(isReturnWindowOpen && !hasActiveReturn && !hasActiveExchange) && !hasPendingRequest && (
            <>
              {(
                (order.paymentMethod === 'COD' && (order.status || '').toLowerCase() === 'awaiting_approval') || 
                ((order.status || '').toLowerCase() === 'payment_pending' || (order.status || '').toLowerCase() === 'pending')
              ) && !isDelivered && !['payment_failed', 'failed'].includes((order.status || '').toLowerCase()) ? (
                <TouchableOpacity onPress={handleCancelOrder} activeOpacity={0.7} style={{ borderRadius: 24, overflow: 'hidden' }}>
                  <GlassView 
                    intensity={isDark ? 30 : 60} 
                    tint={isDark ? 'dark' : 'light'} 
                    style={[styles.mainBtn, { 
                      backgroundColor: 'rgba(255, 59, 48, 0.08)', 
                      borderWidth: 1, 
                      borderColor: 'rgba(255, 59, 48, 0.2)' 
                    }]}
                  >
                    <Typography size={13} weight="700" color="#FF3B30">Cancel Order</Typography>
                  </GlassView>
                </TouchableOpacity>
              ) : null}
            </>
          )}

          <TouchableOpacity onPress={contactSupport} activeOpacity={0.7} style={{ borderRadius: 24, overflow: 'hidden' }}>
            <GlassView 
              intensity={isDark ? 30 : 60} 
              tint={isDark ? 'dark' : 'light'} 
              style={[styles.mainBtn, { 
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.4)', 
                borderWidth: 1, 
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' 
              }]}
            >
              <Typography size={13} weight="700" color={colors.text}>Contact Support</Typography>
            </GlassView>
          </TouchableOpacity>
        </View>
      </View>

      {loading && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={{ width: 60, height: 60, borderRadius: 16, backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  statusCard: { padding: 16, borderRadius: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  statusLine: { width: 3, height: 32, borderRadius: 2, marginLeft: 12 },
  stepperBox: { marginBottom: 24, paddingLeft: 8 },
  stepItem: { flexDirection: 'row', gap: 14 },
  stepIndicator: { alignItems: 'center', width: 16 },
  stepDot: { width: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  stepLine: { width: 1.5, flex: 1, marginVertical: 4 },
  stepContent: { flex: 1, paddingBottom: 20 },
  trackingPill: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, borderStyle: 'dashed', borderWidth: 1 },
  infoCard: { padding: 14, borderRadius: 14 },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  itemThumb: { width: 64, height: 64, borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  footer: { padding: 16, position: 'absolute', bottom: 0, left: 0, right: 0 },
  mainBtn: { height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  retryBtn: { marginTop: 20, paddingHorizontal: 24, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
});
