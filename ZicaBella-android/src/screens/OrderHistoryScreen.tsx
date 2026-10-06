import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, RefreshControl, FlatList, Dimensions,
  Animated, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import GlassHeader from '../components/GlassHeader';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { useAuth } from '../hooks/useAuth';
import { config } from '../constants/config';
import { formatPrice } from '../utils/formatPrice';
import { haptics } from '../utils/haptics';
import { Typography } from '../components/Typography';
import { OrderSkeleton } from '../components/OrderSkeleton';

import { resolveImageUrl } from '../utils/imageUtils';
import { getOrderStatusLabel, getOrderStatusProgressStep, resolveOrderDisplayStatus } from '../utils/orderStatus';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
type OrderTab = 'ACTIVE' | 'HISTORY';

const TAB_CONFIG: { key: OrderTab; label: string; icon: string }[] = [
  { key: 'ACTIVE', label: 'Active', icon: 'time-outline' },
  { key: 'HISTORY', label: 'History', icon: 'receipt-outline' },
];

export default function OrderHistoryScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';
  const { user } = useAuth();

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<OrderTab>('ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  const fetchOrders = useCallback(async () => {
    try {
      if (!user?.id && !user?.phone && !user?.email) {
        setOrders([]);
        setLoading(false);
        return;
      }

      // Build query params for customer lookup
      const params = new URLSearchParams();
      if (user?.id) params.set('customerId', user.id);
      if (user?.phone) params.set('phone', user.phone);
      if (user?.email) params.set('email', user.email);

      const url = `${config.appUrl}/api/app/orders?${params.toString()}`;

      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      const contentType = res.headers.get('content-type') || '';

      // Guard against HTML error pages from the server
      if (!contentType.includes('application/json')) {
        const preview = await res.text();
        throw new Error(`Server returned non-JSON response (${res.status})`);
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch orders');

      setOrders(json.orders || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, user?.phone, user?.email]);

  useFocusEffect(
    useCallback(() => {
      fetchOrders();
    }, [fetchOrders])
  );

  const onRefresh = useCallback(() => {
    haptics.buttonTap();
    setRefreshing(true);
    fetchOrders();
  }, [fetchOrders]);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const getVal = (v: any) => String(v || '').toLowerCase();
      const finStatus = getVal(o.financialStatus || o.financial_status || o.paymentStatus || o.payment_status);
      const mainStatus = getVal(o.status || o.rawStatus);
      const payMethod = getVal(o.paymentMethod || o.paymentMethod2 || o.payment_method);
      const isCOD = ['cod', 'cash on delivery'].includes(payMethod);
      
      const isPaymentUnsuccessful = isCOD
        ? ['failed', 'voided'].includes(finStatus) || ['failed', 'voided'].includes(mainStatus)
        : ['failed', 'pending', 'voided', 'unpaid', 'payment_failed', 'payment_pending'].includes(finStatus) ||
          ['failed', 'pending', 'voided', 'unpaid', 'payment_failed', 'payment_pending'].includes(mainStatus);
        
      if (isPaymentUnsuccessful) return false;
      
      const timeline = Array.isArray(o.statusTimeline) ? o.statusTimeline : [];
      const deliveredAt = timeline.find((t: any) => t.step === 'delivered')?.completedAt;
      
      const deliveryStatus = getVal(o.deliveryStatus);
      const fulfillmentStatus = getVal(o.fulfillmentStatus);
      const isCancelled =
        mainStatus.includes('cancel') ||
        deliveryStatus.includes('cancel') ||
        fulfillmentStatus.includes('cancel');
      const isDelivered = !!deliveredAt;
      const isReturnActive = ['return_initiated', 'return_approved', 'exchange_initiated', 'exchange_approved'].includes(mainStatus) ||
                             o.returnRequests?.some((r: any) => !['cancelled', 'rejected', 'refunded'].includes(r.status)) ||
                             o.exchangeRequests?.some((e: any) => !['cancelled', 'rejected', 'new_order_created'].includes(e.status));
      
      if (activeTab === 'HISTORY') return true;
      return !isCancelled && (!isDelivered || isReturnActive);
    });
  }, [orders, activeTab]);

  const getStatusConfig = (order: any) => {
    const label = resolveOrderDisplayStatus(order);
    
    switch (label) {
      case 'Cancelled':
      case 'Cancelled by Zica Bella':
        return { color: '#FF3B30', bg: 'rgba(255,59,48,0.06)', label, icon: 'close-circle' as const };
      case 'Return Requested':
      case 'Exchange Requested':
      case 'Return / Exchange Requested':
      case 'Return Approved':
      case 'Exchange Approved':
      case 'Refund Pending':
      case 'Pickup Scheduled':
      case 'Return Item Received':
      case 'Exchange Item Received':
        return { color: '#FF9F0A', bg: 'rgba(255,159,10,0.06)', label, icon: 'swap-horizontal' as const };
      case 'Returned':
      case 'Exchanged':
        return { color: '#8E8E93', bg: 'rgba(142,142,147,0.06)', label, icon: 'checkmark-circle-outline' as const };
      case 'Delivered':
        return { color: '#34C759', bg: 'rgba(52,199,89,0.06)', label: 'Delivered', icon: 'checkmark-circle' as const };
      case 'Shipped / Out for Delivery':
        return { color: '#AF52DE', bg: 'rgba(175,82,222,0.06)', label: 'Shipped / Out for Delivery', icon: 'airplane' as const };
      case 'Ready for Dispatch':
        return { color: '#FF9500', bg: 'rgba(255,149,0,0.06)', label: 'Ready for Dispatch', icon: 'gift' as const };
      case 'Order Placed':
        return { color: '#007AFF', bg: 'rgba(0,122,255,0.06)', label: 'Order Placed', icon: 'checkmark-done' as const };
      case 'Processing':
      default:
        return { color: colors.textSecondary, bg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', label: 'Processing', icon: 'hourglass-outline' as const };
    }
  };

  const renderProgressBar = (order: any) => {
    const displayStatus = resolveOrderDisplayStatus(order);
    const step = getOrderStatusProgressStep(displayStatus);
    if (step === -1) {
      return null;
    }
    const stages = ['Placed', 'Processing', 'Ready', 'Shipped', 'Delivered'];
    
    return (
      <View style={{ marginTop: 16, marginBottom: 8, paddingHorizontal: 4 }}>
        <View style={{ height: 3, borderRadius: 1.5, position: 'relative', top: 4, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }}>
          <View style={{ height: 3, borderRadius: 1.5, backgroundColor: colors.iosBlue, width: (((step / 4) * 100) + '%') as any }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', position: 'relative', top: -3 }}>
          {stages.map((stage, idx) => {
            const isCompleted = idx <= step;
            const isCurrent = idx === step;
            return (
              <View key={stage} style={{ alignItems: 'center', width: 50 }}>
                <View style={[{ width: 10, height: 10, borderRadius: 5, justifyContent: 'center', alignItems: 'center', backgroundColor: isCompleted ? colors.iosBlue : (isDark ? '#1C1C1E' : '#E5E5EA') }, isCurrent && { borderColor: '#FFFFFF', borderWidth: 1.5 }]}>
                  {isCompleted && idx < step && <Ionicons name="checkmark" size={6} color="#FFFFFF" />}
                </View>
                <Typography size={8} weight={isCurrent ? "700" : "500"} color={isCurrent ? colors.text : colors.textMuted} style={{ marginTop: 4, textAlign: 'center' }}>
                  {stage}
                </Typography>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderOrder = ({ item: order }: { item: any }) => {
    const { color, label } = getStatusConfig(order);
    const orderNumber = order.orderNumber || order.id?.slice(0, 8);
    const items = order.items || [];
    const totalPrice = formatPrice(order.totalPrice || order.total || 0);
    const isSingle = items.length === 1;
    
    const estimatedDelivery = order.timeline?.estimatedDelivery || order.estimatedDelivery || order.shipments?.[0]?.estimatedDelivery;
    const formattedDelivery = estimatedDelivery ? new Date(estimatedDelivery).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const trackingNumber = order.trackingNumber || order.shipments?.[0]?.trackingNumber;

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          haptics.buttonTap();
          navigation.navigate('OrderDetails', { orderId: order.id });
        }}
        style={[
          styles.orderCard,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          }
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1, marginBottom: 4 }}>
              #{orderNumber} • {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase()}
            </Typography>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              <View style={[styles.statusDot, { backgroundColor: color }]} />
              <Typography size={14} weight="700" color={colors.text}>{label}</Typography>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Typography size={16} weight="800" color={colors.text}>{totalPrice}</Typography>
            <Typography size={9} weight="600" color={colors.textMuted}>{items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}</Typography>
          </View>
        </View>

        <View style={styles.contentSection}>
          {isSingle ? (
            <View style={styles.singleItemRow}>
              <View style={[styles.largeThumb, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
                {resolveImageUrl(items[0].image) ? (
                  <Image source={{ uri: resolveImageUrl(items[0].image)! }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Ionicons name="bag-handle-outline" size={20} color={colors.textExtraLight} />
                )}
              </View>
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Typography size={13} weight="700" color={colors.text} numberOfLines={1}>{items[0].title}</Typography>
                <Typography size={11} color={colors.textMuted} style={{ marginTop: 2 }}>Premium Quality Item</Typography>
              </View>
            </View>
          ) : (
            <View style={styles.multiItemRow}>
              <View style={styles.imageStack}>
                {items.slice(0, 3).map((item: any, idx: number) => (
                  <View 
                    key={item.id || idx} 
                    style={[
                      styles.stackedThumb, 
                      { 
                        left: idx * 28, 
                        zIndex: 10 - idx,
                        backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
                        borderColor: isDark ? '#000' : '#FFF',
                        borderWidth: 2,
                        transform: [{ rotate: ((idx - 1) * 2) + 'deg' }]
                      }
                    ]}
                  >
                    {resolveImageUrl(item.image) ? (
                      <Image source={{ uri: resolveImageUrl(item.image)! }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <Ionicons name="bag-outline" size={14} color={colors.textExtraLight} />
                    )}
                  </View>
                ))}
                {items.length > 3 && (
                  <View style={[styles.moreThumb, { left: 3 * 28, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
                    <Typography size={10} weight="800" color={colors.textSecondary}>+{items.length - 3}</Typography>
                  </View>
                )}
              </View>
            </View>
          )}
          
          <View style={{ marginTop: 12, gap: 4 }}>
            <Typography size={11} color={colors.textSecondary}>
              {formattedDelivery ? 'Estimated delivery: ' + formattedDelivery : "Estimated delivery date will be updated soon."}
            </Typography>
            {trackingNumber && (
              <Typography size={11} color={colors.textSecondary} style={{ fontWeight: '600' }}>
                Track your order: {trackingNumber}
              </Typography>
            )}
          </View>

          {renderProgressBar(order)}
          
          <View style={[styles.cardFooter, { marginTop: 16 }]}>
             <Typography size={10} weight="800" color={colors.iosBlue} style={{ letterSpacing: 0.5 }}>VIEW ORDER DETAILS</Typography>
             <Ionicons name="chevron-forward" size={12} color={colors.iosBlue} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const orderCounts = useMemo(() => {
    const getVal = (v: any) => String(v || '').toLowerCase();
    
    const active = orders.filter(o => {
      const finStatus = getVal(o.financialStatus || o.financial_status || o.paymentStatus || o.payment_status);
      const s = getVal(o.status || o.rawStatus);
      const payMethod = getVal(o.paymentMethod || o.paymentMethod2 || o.payment_method);
      const isCOD = ['cod', 'cash on delivery'].includes(payMethod);
      
      const isPaymentUnsuccessful = isCOD
        ? ['failed', 'voided'].includes(finStatus) || ['failed', 'voided'].includes(s)
        : ['failed', 'pending', 'voided', 'unpaid', 'payment_failed', 'payment_pending'].includes(finStatus) ||
          ['failed', 'pending', 'voided', 'unpaid', 'payment_failed', 'payment_pending'].includes(s);
      
      if (isPaymentUnsuccessful) return false;
      
      const timeline = Array.isArray(o.statusTimeline) ? o.statusTimeline : [];
      const deliveredAt = timeline.find((t: any) => t.step === 'delivered')?.completedAt;
      const d = getVal(o.deliveryStatus);
      const f = getVal(o.fulfillmentStatus);
      const isCancelled = s.includes('cancel') || d.includes('cancel') || f.includes('cancel');
      const isDelivered = !!deliveredAt;
      const isReturnActive = ['return_initiated', 'return_approved', 'exchange_initiated', 'exchange_approved'].includes(s) ||
                             o.returnRequests?.some((r: any) => !['cancelled', 'rejected', 'refunded'].includes(r.status)) ||
                             o.exchangeRequests?.some((e: any) => !['cancelled', 'rejected', 'new_order_created'].includes(e.status));
      
      return !isCancelled && (!isDelivered || isReturnActive);
    }).length;
    
    const history = orders.filter(o => {
      const finStatus = getVal(o.financialStatus || o.financial_status || o.paymentStatus || o.payment_status);
      const s = getVal(o.status || o.rawStatus);
      const payMethod = getVal(o.paymentMethod || o.paymentMethod2 || o.payment_method);
      const isCOD = ['cod', 'cash on delivery'].includes(payMethod);
      
      const isPaymentUnsuccessful = isCOD
        ? ['failed', 'voided'].includes(finStatus) || ['failed', 'voided'].includes(s)
        : ['failed', 'pending', 'voided', 'unpaid', 'payment_failed', 'payment_pending'].includes(finStatus) ||
          ['failed', 'pending', 'voided', 'unpaid', 'payment_failed', 'payment_pending'].includes(s);
      
      return !isPaymentUnsuccessful;
    }).length;
    
    return { ACTIVE: active, HISTORY: history };
  }, [orders]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader title="Orders" showBack />
      
      <View style={[styles.tabContainer, { paddingTop: insets.top + 64 }]}>
        <View style={[styles.tabTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}>
          {TAB_CONFIG.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => { haptics.buttonTap(); setActiveTab(tab.key); }}
                style={[styles.tabBtn, isActive && { backgroundColor: colors.background, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 }]}
              >
                <Typography size={11} weight={isActive ? '700' : '600'} color={isActive ? colors.text : colors.textExtraLight}>
                  {tab.label}
                </Typography>
                {isActive && orderCounts[tab.key] > 0 && (
                  <View style={[styles.dot, { backgroundColor: colors.foreground }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.listContent}>
          {[1, 2, 3].map(i => <OrderSkeleton key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={item => item.id}
          renderItem={renderOrder}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.foreground} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
                <Ionicons name="bag-outline" size={32} color={colors.textExtraLight} />
              </View>
              <Typography size={16} weight="700" color={colors.text} style={{ marginTop: 20 }}>No orders yet</Typography>
              <Typography size={13} color={colors.textMuted} style={{ marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
                Your orders will appear here once you make a purchase
              </Typography>
              <TouchableOpacity
                style={[styles.shopBtn, { backgroundColor: colors.foreground }]}
                onPress={() => navigation.navigate('ShopTab')}
              >
                <Typography size={13} weight="700" color={colors.background}>Start Shopping</Typography>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabContainer: { paddingHorizontal: 20, paddingBottom: 16 },
  tabTrack: { flexDirection: 'row', padding: 4, borderRadius: 14 },
  tabBtn: { flex: 1, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  orderCard: {
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16,
    padding: 20,
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 8 },
  emailBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2.5, borderRadius: 6, marginLeft: 4 },
  contentSection: { gap: 16 },
  singleItemRow: { flexDirection: 'row', alignItems: 'center' },
  largeThumb: { width: 64, height: 64, borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  multiItemRow: { flexDirection: 'row', alignItems: 'center' },
  imageStack: { height: 54, width: 160, position: 'relative' },
  stackedThumb: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 14,
    overflow: 'hidden',
  },
  moreThumb: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 4
  },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center' },
  shopBtn: { marginTop: 32, paddingHorizontal: 24, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
});
