import React, { useState, useCallback } from 'react';
import {
  View, StyleSheet, TouchableOpacity, RefreshControl, FlatList, Dimensions,
  Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import GlassHeader from '../components/GlassHeader';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../store/authStore';
import { config } from '../constants/config';
import { formatPrice } from '../utils/formatPrice';
import { haptics } from '../utils/haptics';
import { Typography } from '../components/Typography';
import { resolveImageUrl } from '../utils/imageUtils';
import RequestSummaryCard from '../components/RequestSummaryCard';

type ActiveTab = 'RETURNS' | 'EXCHANGES';

const TAB_CONFIG: { key: ActiveTab; label: string; icon: string }[] = [
  { key: 'RETURNS', label: 'Returns', icon: 'arrow-undo-outline' },
  { key: 'EXCHANGES', label: 'Exchanges', icon: 'swap-horizontal-outline' },
];

export default function ReturnsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<ActiveTab>('RETURNS');
  const [returns, setReturns] = useState<any[]>([]);
  const [exchanges, setExchanges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageMap, setImageMap] = useState<{ [key: string]: string }>({});

  const fetchData = useCallback(async () => {
    try {
      if (!user?.id && !user?.phone && !user?.email) {
        setReturns([]);
        setExchanges([]);
        setLoading(false);
        return;
      }

      const params = new URLSearchParams();
      if (user?.id) params.set('customerId', user.id);
      if (user?.phone) params.set('phone', user.phone);
      if (user?.email) params.set('email', user.email);

      const authHeaders = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${useAuthStore.getState().token || ''}`
      };

      const [returnsRes, exchangesRes, ordersRes, productsRes] = await Promise.all([
        fetch(`${config.appUrl}/api/app/returns?${params.toString()}`, { headers: authHeaders }),
        fetch(`${config.appUrl}/api/app/exchanges?${params.toString()}`, { headers: authHeaders }),
        fetch(`${config.appUrl}/api/app/orders?${params.toString()}`, { headers: authHeaders }).catch(() => null),
        fetch(`${config.appUrl}/api/app/products?limit=100`).catch(() => null)
      ]);

      const returnsJson = await returnsRes.json().catch(() => ({ returns: [] }));
      const exchangesJson = await exchangesRes.json().catch(() => ({ exchanges: [] }));
      const ordersJson = ordersRes ? await ordersRes.json().catch(() => ({ orders: [] })) : { orders: [] };
      const productsJson = productsRes ? await productsRes.json().catch(() => ({ products: [] })) : { products: [] };

      // Build unified client-side image cache map
      const imgMap: { [key: string]: string } = {};

      if (productsJson.products && Array.isArray(productsJson.products)) {
        productsJson.products.forEach((p: any) => {
          const img = p.image || p.imageUrl || p.featuredImage || p.images?.[0];
          if (img) {
            if (p.id) imgMap[String(p.id).toLowerCase().trim()] = img;
            if (p.shopifyProductId) imgMap[String(p.shopifyProductId).toLowerCase().trim()] = img;
            if (p.title) imgMap[String(p.title).toLowerCase().trim()] = img;
          }
        });
      }

      if (ordersJson.orders && Array.isArray(ordersJson.orders)) {
        ordersJson.orders.forEach((o: any) => {
          if (o.items && Array.isArray(o.items)) {
            o.items.forEach((item: any) => {
              const img = item.image || item.imageUrl || item.product?.featuredImage || item.product?.image;
              if (img) {
                const cleanTitle = String(item.title || '').replace(/\s*-\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})$/i, '').toLowerCase().trim();
                const fullTitle = String(item.fullTitle || item.title || '').toLowerCase().trim();

                if (o.id && item.productId) {
                  imgMap[`${o.id}_${String(item.productId).toLowerCase().trim()}`] = img;
                }
                if (o.id && item.shopifyProductId) {
                  imgMap[`${o.id}_${String(item.shopifyProductId).toLowerCase().trim()}`] = img;
                }
                if (o.id && cleanTitle) {
                  imgMap[`${o.id}_${cleanTitle}`] = img;
                }
                if (o.id && fullTitle) {
                  imgMap[`${o.id}_${fullTitle}`] = img;
                }

                if (o.orderNumber) {
                  const num = String(o.orderNumber).replace(/^#/, '').toLowerCase().trim();
                  if (item.productId) imgMap[`${num}_${String(item.productId).toLowerCase().trim()}`] = img;
                  if (item.shopifyProductId) imgMap[`${num}_${String(item.shopifyProductId).toLowerCase().trim()}`] = img;
                  if (item.title && cleanTitle) imgMap[`${num}_${cleanTitle}`] = img;
                  if (fullTitle) imgMap[`${num}_${fullTitle}`] = img;
                }
              }
            });
          }
        });
      }

      setImageMap(imgMap);

      if (returnsRes.ok) {
        setReturns(returnsJson.returns || []);
      }
      if (exchangesRes.ok) {
        setExchanges(exchangesJson.exchanges || []);
      }
      
      setError(null);
    } catch (err: any) {
      console.error('[ReturnsScreen] Fetch Error:', err);
      setError(err.message || 'Failed to load requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, user?.phone, user?.email]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = useCallback(() => {
    haptics.buttonTap();
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const getStatusColorAndLabel = (status: string) => {
    const s = String(status).toLowerCase();
    switch (s) {
      case 'requested':
      case 'pending_approval':
      case 'pending':
        return { color: '#FF9F0A', bg: 'rgba(255,159,10,0.08)', label: 'Pending Approval' };
      case 'approved':
      case 'exchange_approved':
      case 'return_approved':
        return { color: '#007AFF', bg: 'rgba(0,122,255,0.08)', label: 'Approved' };
      case 'received':
      case 'qc_passed':
      case 'return_item_received':
        return { color: '#AF52DE', bg: 'rgba(175,82,222,0.08)', label: 'Received' };
      case 'refunded':
      case 'returned':
        return { color: '#34C759', bg: 'rgba(52,199,89,0.08)', label: 'Refunded' };
      case 'new_order_created':
      case 'exchanged':
        return { color: '#34C759', bg: 'rgba(52,199,89,0.08)', label: 'Exchanged' };
      case 'cancelled':
      case 'rejected':
        return { color: '#FF3B30', bg: 'rgba(255,59,48,0.08)', label: 'Cancelled' };
      default:
        return { color: colors.textSecondary, bg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', label: status };
    }
  };

  const getProductImage = (orderId: string, orderNumber: string, product: any) => {
    if (!product) return null;
    const directImage = product.image || product.imageUrl || product.featuredImage;
    if (directImage) return directImage;

    const pId = product.id ? String(product.id).toLowerCase().trim() : '';
    const shopifyId = product.shopifyProductId ? String(product.shopifyProductId).toLowerCase().trim() : '';
    const title = product.title ? String(product.title).toLowerCase().trim() : '';
    const cleanTitle = product.title ? String(product.title).replace(/\s*-\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})$/i, '').toLowerCase().trim() : '';

    if (orderId) {
      const oid = String(orderId).toLowerCase().trim();
      if (pId && imageMap[`${oid}_${pId}`]) return imageMap[`${oid}_${pId}`];
      if (shopifyId && imageMap[`${oid}_${shopifyId}`]) return imageMap[`${oid}_${shopifyId}`];
      if (title && imageMap[`${oid}_${title}`]) return imageMap[`${oid}_${title}`];
      if (cleanTitle && imageMap[`${oid}_${cleanTitle}`]) return imageMap[`${oid}_${cleanTitle}`];
    }

    if (orderNumber) {
      const num = String(orderNumber).replace(/^#/, '').toLowerCase().trim();
      if (pId && imageMap[`${num}_${pId}`]) return imageMap[`${num}_${pId}`];
      if (shopifyId && imageMap[`${num}_${shopifyId}`]) return imageMap[`${num}_${shopifyId}`];
      if (title && imageMap[`${num}_${title}`]) return imageMap[`${num}_${title}`];
      if (cleanTitle && imageMap[`${num}_${cleanTitle}`]) return imageMap[`${num}_${cleanTitle}`];
    }

    if (pId && imageMap[pId]) return imageMap[pId];
    if (shopifyId && imageMap[shopifyId]) return imageMap[shopifyId];
    if (title && imageMap[title]) return imageMap[title];
    if (cleanTitle && imageMap[cleanTitle]) return imageMap[cleanTitle];

    return null;
  };

  const renderRequestSummary = (item: any, dateValue: any, detail: React.ReactNode) => {
    const dateStr = dateValue ? new Date(dateValue).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    return (
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={() => {
          haptics.buttonTap();
          navigation.navigate('OrderDetails', { orderId: item.orderId });
        }}
      >
        <RequestSummaryCard summary={item.summary}>
          <View style={{ marginBottom: 4 }}>
            <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 0.8 }}>
              ORDER #{item.orderNumber?.replace(/^#/, '') || '—'}{dateStr ? `  •  ${dateStr}` : ''}
            </Typography>
            {detail}
          </View>
        </RequestSummaryCard>
      </TouchableOpacity>
    );
  };

  const renderReturnItem = ({ item }: { item: any }) => {
    if (item.summary) {
      const titles = (item.items?.length ? item.items.map((i: any) => i.product?.title) : [item.product?.title]).filter(Boolean).join(', ');
      return renderRequestSummary(
        item,
        item.requestedAt,
        <>
          <Typography size={12} weight="700" color={colors.text} numberOfLines={2} style={{ marginTop: 6 }}>{titles || 'Product'}</Typography>
          {item.reason ? <Typography size={11} color={colors.textMuted} style={{ marginTop: 2 }}>Reason: {item.reason}</Typography> : null}
        </>
      );
    }
    const { color, bg, label } = getStatusColorAndLabel(item.status);
    const dateStr = item.requestedAt ? new Date(item.requestedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const imgUrl = getProductImage(item.orderId, item.orderNumber, item.product);
    const resolvedImg = resolveImageUrl(imgUrl);

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          haptics.buttonTap();
          navigation.navigate('OrderDetails', { orderId: item.orderId });
        }}
        style={[
          styles.card,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          }
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Typography size={9} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 0.8, marginBottom: 4 }}>
              ORDER #{item.orderNumber?.replace(/^#/, '') || '—'}
            </Typography>
            {dateStr && (
              <Typography size={10} color={colors.textMuted}>{dateStr}</Typography>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: bg }]}>
            <Typography size={9} weight="800" color={color}>{label.toUpperCase()}</Typography>
          </View>
        </View>

        <View style={styles.cardContent}>
          <View style={[styles.itemThumb, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
            {resolvedImg ? (
              <Image source={{ uri: resolvedImg }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Ionicons name="shirt-outline" size={20} color={colors.textExtraLight} />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Typography size={13} weight="700" color={colors.text} numberOfLines={1}>{item.product?.title || 'Product'}</Typography>
            {item.sku && (
              <Typography size={10} color={colors.textExtraLight} style={{ marginTop: 2 }}>SKU: {item.sku}</Typography>
            )}
            <Typography size={11} color={colors.textMuted} style={{ marginTop: 4 }}>Reason: {item.reason}</Typography>
          </View>
        </View>

        <View style={[styles.cardFooter, { borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
          <Typography size={11} color={colors.textMuted}>Refund Amount</Typography>
          <Typography size={14} weight="800" color={colors.text}>{formatPrice(item.refundAmount || 0)}</Typography>
        </View>
      </TouchableOpacity>
    );
  };

  const renderExchangeItem = ({ item }: { item: any }) => {
    if (item.summary) {
      const diff = item.priceDifference || 0;
      const titles = (item.items?.length ? item.items.map((i: any) => i.originalProduct?.title) : [item.originalProduct?.title]).filter(Boolean).join(', ');
      return renderRequestSummary(
        item,
        item.createdAt,
        <>
          <Typography size={12} weight="700" color={colors.text} numberOfLines={2} style={{ marginTop: 6 }}>{titles || 'Product'}</Typography>
          <Typography size={11} color={colors.textMuted} style={{ marginTop: 2 }}>
            {diff > 0 ? `Pay ${formatPrice(diff)} difference` : diff < 0 ? `Credit ${formatPrice(Math.abs(diff))}` : 'No price difference'}
          </Typography>
        </>
      );
    }
    const { color, bg, label } = getStatusColorAndLabel(item.status);
    const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const diff = item.priceDifference || 0;

    const originalImgUrl = getProductImage(item.orderId, item.orderNumber, item.originalProduct);
    const resolvedOriginalImg = resolveImageUrl(originalImgUrl);

    const newImgUrl = getProductImage(item.orderId, item.orderNumber, item.newProduct);
    const resolvedNewImg = resolveImageUrl(newImgUrl);

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          haptics.buttonTap();
          navigation.navigate('OrderDetails', { orderId: item.orderId });
        }}
        style={[
          styles.card,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          }
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Typography size={9} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 0.8, marginBottom: 4 }}>
              ORDER #{item.orderNumber?.replace(/^#/, '') || '—'}
            </Typography>
            {dateStr && (
              <Typography size={10} color={colors.textMuted}>{dateStr}</Typography>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: bg }]}>
            <Typography size={9} weight="800" color={color}>{label.toUpperCase()}</Typography>
          </View>
        </View>

        <View style={styles.exchangeFlow}>
          <View style={styles.exchangeProductRow}>
            <View style={[styles.miniThumb, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
              {resolvedOriginalImg ? (
                <Image source={{ uri: resolvedOriginalImg }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="shirt-outline" size={12} color={colors.textExtraLight} />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Typography size={10} color={colors.textExtraLight} weight="600">ORIGINAL</Typography>
              <Typography size={12} weight="700" color={colors.text} numberOfLines={1}>{item.originalProduct?.title || 'Product'}</Typography>
            </View>
          </View>

          <View style={styles.flowArrowContainer}>
            <Ionicons name="arrow-down" size={16} color={colors.textExtraLight} />
          </View>

          <View style={styles.exchangeProductRow}>
            <View style={[styles.miniThumb, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
              {resolvedNewImg ? (
                <Image source={{ uri: resolvedNewImg }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="shirt-outline" size={12} color={colors.textExtraLight} />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Typography size={10} color={colors.iosBlue} weight="700">REPLACEMENT</Typography>
              <Typography size={12} weight="700" color={colors.text} numberOfLines={1}>{item.newProduct?.title || 'Product'}</Typography>
            </View>
          </View>
        </View>

        <View style={[styles.cardFooter, { borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
          <Typography size={11} color={colors.textMuted}>Price Difference</Typography>
          <Typography size={14} weight="800" color={diff > 0 ? '#FF3B30' : diff < 0 ? '#34C759' : colors.text}>
            {diff > 0 ? `+${formatPrice(diff)}` : diff < 0 ? `-${formatPrice(Math.abs(diff))}` : 'No difference'}
          </Typography>
        </View>
      </TouchableOpacity>
    );
  };

  const currentData = activeTab === 'RETURNS' ? returns : exchanges;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader title="Returns & Exchanges" showBack />

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
                <Ionicons name={tab.icon as any} size={14} color={isActive ? colors.text : colors.textExtraLight} style={{ marginRight: 6 }} />
                <Typography size={11} weight={isActive ? '700' : '600'} color={isActive ? colors.text : colors.textExtraLight}>
                  {tab.label}
                </Typography>
                {isActive && currentData.length > 0 && (
                  <View style={[styles.dot, { backgroundColor: colors.foreground }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.foreground} />
        </View>
      ) : (
        <FlatList
          data={currentData}
          keyExtractor={item => item.id}
          renderItem={activeTab === 'RETURNS' ? renderReturnItem : renderExchangeItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.foreground} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
                <Ionicons name="swap-horizontal-outline" size={32} color={colors.textExtraLight} />
              </View>
              <Typography size={16} weight="700" color={colors.text} style={{ marginTop: 20 }}>No requests yet</Typography>
              <Typography size={13} color={colors.textMuted} style={{ marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
                {activeTab === 'RETURNS'
                  ? 'Your return requests will appear here once initiated.'
                  : 'Your product exchange requests will appear here.'}
              </Typography>
              <TouchableOpacity
                style={[styles.policyBtn, { borderColor: colors.borderLight }]}
                onPress={() => navigation.navigate('Policy', { handle: 'refund-policy', title: 'Refund Policy' })}
              >
                <Typography size={11} weight="700" color={colors.text}>Read Refund Policy</Typography>
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
  tabBtn: { flex: 1, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, marginLeft: 4 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  itemThumb: {
    width: 54,
    height: 54,
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center'
  },
  miniThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center'
  },
  exchangeFlow: {
    gap: 8,
    marginVertical: 4
  },
  exchangeProductRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  flowArrowContainer: {
    paddingLeft: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center'
  },
  policyBtn: {
    marginTop: 24,
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
});
