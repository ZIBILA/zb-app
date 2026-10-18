import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/colors';
import { formatPrice } from '../utils/formatPrice';
import { useCart } from '../hooks/useCart';
import CartItem from '../components/CartItem';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { Typography } from '../components/Typography';
import { useRef } from 'react';
import { useThemeStore } from '../store/themeStore';


export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const { items, total, count, update, remove, clear } = useCart();
  const isDark = useThemeStore(s => s.theme) === 'dark';

  const isTabBarVisible = useUIStore(s => s.isTabBarVisible);
  const setTabBarVisible = useUIStore(s => s.setTabBarVisible);
  const lastScrollY = useRef(0);

  const onScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const diff = currentY - lastScrollY.current;
    
    if (Math.abs(diff) > 5) {
      if (diff > 0 && currentY > 100) {
        setTabBarVisible(false);
      } else {
        setTabBarVisible(true);
      }
    }
    lastScrollY.current = currentY;
  };

  const discounts = 0;
  const totalAfterDiscount = useMemo(() => total - discounts, [total, discounts]);

  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  const handleCheckout = useCallback(() => {
    if (!isAuthenticated) {
      Alert.alert('Login Required', 'Please log in to proceed with checkout and payment.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => navigation.navigate('Auth') }
      ]);
      return;
    }
    navigation.navigate('CheckoutFlow');
  }, [navigation, isAuthenticated]);

  const handleGoHome = useCallback(() => {
    navigation.navigate('HomeTab' as never);
  }, [navigation]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom, backgroundColor: colors.background }]}>
      {/* Page Title */}
      <View style={styles.titleContainer}>
        <Typography size={7} weight="300" color={colors.textLight} style={styles.titleTag}>YOUR</Typography>
        <View style={styles.titleRow}>
          <Typography heading size={14} color={colors.text} style={styles.title}>CART</Typography>
          {count > 0 && (
            <View style={[styles.countBadge, { backgroundColor: colors.borderLight }]}>
              <Typography size={8} weight="600" color={colors.textMuted}>{count}</Typography>
            </View>
          )}
        </View>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="bag-outline" size={56} color={colors.borderLight} />
          <Typography size={10} weight="600" color={colors.textLight} style={styles.emptyTitle}>Your Cart is Empty</Typography>
          <TouchableOpacity style={[styles.emptyCta, { backgroundColor: colors.foreground }]} onPress={handleGoHome} activeOpacity={0.9}>
            <Typography size={9} weight="700" color={colors.background} style={styles.emptyCtaText}>SHOP NOW</Typography>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.cartContent}>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <CartItem
                item={item}
                onUpdateQuantity={update}
                onRemove={remove}
                onPress={() => navigation.navigate('ProductDetail', { handle: item.handle })}
              />
            )}
            getItemLayout={(data, index) => ({
              length: 102,
              offset: 102 * index,
              index
            })}
            style={styles.list}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={true}
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            updateCellsBatchingPeriod={50}
            windowSize={5}
            contentContainerStyle={styles.listContent}
            onScroll={onScroll}
            scrollEventThrottle={16}
          />

          {/* Bottom Action Area */}
          <View style={[
            styles.bottomActions,
            { paddingBottom: isTabBarVisible ? 85 : insets.bottom + 12 }
          ]}>
            <View style={[styles.summaryCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderExtraLight }]}>
              <View style={styles.summaryRow}>
                <Typography size={8} weight="400" color={colors.textMuted} style={styles.summaryLabel}>SUBTOTAL</Typography>
                <Typography size={10} weight="600" color={colors.text}>{formatPrice(total)}</Typography>
              </View>
              {discounts > 0 && (
                <View style={styles.summaryRow}>
                  <Typography size={8} weight="400" color={colors.textMuted} style={styles.summaryLabel}>DISCOUNTS</Typography>
                  <Typography size={9} weight="400" color={colors.success}>{formatPrice(-discounts)}</Typography>
                </View>
              )}
              <View style={[styles.divider, { backgroundColor: colors.borderExtraLight }]} />
              <View style={styles.summaryRow}>
                <Typography size={10} weight="700" color={colors.text} style={styles.totalLabel}>TOTAL</Typography>
                <Typography size={12} weight="800" color={colors.text}>{formatPrice(totalAfterDiscount)}</Typography>
              </View>
            </View>

            <TouchableOpacity 
              style={[styles.checkoutButton, { backgroundColor: colors.foreground }]} 
              onPress={handleCheckout} 
              activeOpacity={0.9}
            >
              <Typography size={10} weight="800" color={colors.background} style={styles.checkoutText}>
                CHECKOUT NOW
              </Typography>
            </TouchableOpacity>

            {!isAuthenticated && (
              <TouchableOpacity
                style={styles.loginCta}
                onPress={() => navigation.navigate('Auth')}
              >
                <Typography size={7} weight="600" color={colors.textExtraLight} style={{ letterSpacing: 1 }}>ALREADY HAVE AN ACCOUNT? SIGN IN</Typography>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() =>
                Alert.alert('Clear Cart', 'Remove all items?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: clear },
                ])
              }
              style={styles.clearBtn}
            >
              <Typography size={7} weight="500" color={colors.textExtraLight} style={{ letterSpacing: 2 }}>CLEAR CART</Typography>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 12,
  },
  titleContainer: {
    marginBottom: 24,
  },
  titleTag: {
    fontSize: 7,
    fontWeight: '200',
    textTransform: 'uppercase',
    letterSpacing: 4.4,
    marginBottom: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  countText: {
    fontSize: 8,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
  emptyCta: {
    marginTop: 10,
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 14,
  },
  emptyCtaText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cartContent: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  list: {
    flex: 1,
  },
  bottomActions: {
    paddingTop: 16,
    paddingHorizontal: 4,
  },
  summaryCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: {
    letterSpacing: 2,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  totalLabel: {
    letterSpacing: 2,
  },
  checkoutButton: {
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  checkoutText: {
    letterSpacing: 3,
  },
  loginCta: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  clearBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    opacity: 0.6,
  },
});
