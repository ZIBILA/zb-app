import React from 'react';
import { View, StyleSheet, FlatList, Dimensions, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../constants/colors';
import { useWishlistStore } from '../store/wishlistStore';
import GlassHeader from '../components/GlassHeader';
import ProductCard from '../components/ProductCard';
import QuickAddModal from '../components/QuickAddModal';
import { Typography } from '../components/Typography';
import { GlassBackdrop } from '../components/GlassView';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { FlatProduct } from '../api/types';
import { haptics } from '../utils/haptics';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = (width - 48) / 2;

export default function WishlistScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const navigation = useNavigation<any>();
  const { wishlist, removeWishlist, syncWishlist } = useWishlistStore();
  const token = useAuthStore((s) => s.token);

  // QuickAdd modal state
  const [selectedProduct, setSelectedProduct] = React.useState<FlatProduct | null>(null);
  const [modalVisible, setModalVisible] = React.useState(false);

  React.useEffect(() => {
    if (token) {
      syncWishlist(token);
    }
  }, [token, syncWishlist]);

  const handleQuickAdd = React.useCallback((product: FlatProduct) => {
    // If the product has variants with sizes, show the QuickAddModal
    // Otherwise, navigate to the product page for proper size selection
    if (product.variants && product.variants.length > 0) {
      setSelectedProduct(product);
      setModalVisible(true);
    } else if (product.handle) {
      // Navigate to product detail for full variant/size selection
      haptics.buttonTap();
      navigation.navigate('ProductDetail', { handle: product.handle, initialProduct: product });
    } else {
      // No variants and no handle — show an alert
      haptics.error();
      Alert.alert(
        'Size Required',
        'Please view the product page to select a size before adding to bag.',
        [{ text: 'OK' }]
      );
    }
  }, [navigation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader title="WISHLIST" showBack />
      
      <FlatList 
        data={wishlist}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent, 
          { paddingTop: insets.top + 70, paddingBottom: 120 }
        ]}
        ListEmptyComponent={
            <View style={styles.emptyState}>
            <View style={styles.emptyIconWrapper}>
              <GlassBackdrop intensity={isDark ? 40 : 80} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
              <Ionicons name="bookmark-outline" size={32} color={colors.textExtraLight} />
            </View>
            <Typography heading size={12} weight="600" color={colors.text} style={styles.emptyTitle}>YOUR WISHLIST IS EMPTY</Typography>
            <Typography size={11} weight="300" color={colors.textSecondary} style={styles.emptyText}>
              Explore the archive to build your collection.
            </Typography>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrapper}>
            <ProductCard 
              product={item} 
              style={{ width: COLUMN_WIDTH }}
              onQuickAdd={handleQuickAdd}
              onRemove={(id) => removeWishlist(id, token)}
            />
          </View>
        )}
        removeClippedSubviews={true}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
      />

      {/* QuickAdd Modal for size selection */}
      <QuickAddModal 
        visible={modalVisible}
        product={selectedProduct}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  columnWrapper: {
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  cardWrapper: {
    width: COLUMN_WIDTH,
    marginBottom: 16,
  },
  card: {
    width: '100%',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginTop: 60,
  },
  emptyIconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 24,
  },
  emptyTitle: {
    letterSpacing: 2,
    marginBottom: 12,
  },
  emptyText: {
    textAlign: 'center',
    lineHeight: 18,
  },
});
