import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../constants/colors';
import { useCartStore } from '../../store/cartStore';
import { Typography } from '../../components/Typography';
import CartItem from '../../components/CartItem';
import CheckoutSummaryBar from '../../components/CheckoutSummaryBar';
import { expandCartUnits } from '../../utils/cartUnits';

export default function BagReviewScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const { items, total, updateQuantity, removeItem } = useCartStore();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')} style={[styles.back, { backgroundColor: colors.surface }]}>
          <Ionicons name="close-outline" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Typography size={7} color={colors.textExtraLight} weight="600" style={styles.stepTag}>STEP 1 OF 5</Typography>
          <Typography size={14} color={colors.text} weight="700">SHOPPING BAG</Typography>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView 
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {expandCartUnits(items).map((item) => (
            <CartItem 
              key={item.unitKey}
              item={item}
              onUpdateQuantity={updateQuantity}
              onRemove={removeItem}
              onPress={() => navigation.navigate('ProductDetail', { handle: item.handle })}
            />
          ))}

          {items.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="bag-outline" size={48} color={colors.textMuted} />
              <Typography size={12} color={colors.textMuted} style={{ marginTop: 16 }}>YOUR BAG IS EMPTY</Typography>
            </View>
          )}

          {/* Upsell/Gift Section */}
          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
            <Ionicons name="gift-outline" size={18} color={colors.text} />
            <Typography size={10} color={colors.textSecondary} style={{ flex: 1, marginLeft: 12 }}>
              EVERY ORDER ARRIVES IN OUR SIGNATURE ARCHIVAL ECO-PACKAGING.
            </Typography>
          </View>
        </View>
      </ScrollView>

      {/* Summary Bar */}
      <CheckoutSummaryBar 
        itemCount={items.length}
        total={total()}
        primaryLabel="CONTINUE TO DELIVERY"
        onPrimaryPress={() => navigation.navigate('DeliveryAddress')}
        disabled={items.length === 0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  back: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { alignItems: 'center' },
  stepTag: { letterSpacing: 2, marginBottom: 2 },
  scroll: { paddingHorizontal: 20, paddingTop: 20 },
  content: { gap: 8 },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 20,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 100,
  }
});
