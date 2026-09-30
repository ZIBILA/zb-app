import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, Modal, TouchableOpacity, 
  Dimensions, Pressable, Alert, Platform
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import OptimizedImage from './OptimizedImage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useCartStore } from '../store/cartStore';
import { FlatProduct } from '../api/types';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { formatPrice } from '../utils/formatPrice';
import { haptics } from '../utils/haptics';
import { useUIStore } from '../store/uiStore';
import { SizeChartModal } from './SizeChartModal';
import { useWishlistStore } from '../store/wishlistStore';
import { useAuthStore } from '../store/authStore';

interface Props {
  visible: boolean;
  product: FlatProduct | null;
  initialSize?: string;
  onClose: () => void;
}

import { resolveImageUrl } from '../utils/imageUtils';

const QuickAddModal = React.memo(({ visible, product, initialSize, onClose }: Props) => {
  const { addItem } = useCartStore();
  const setCartOpen = useUIStore(s => s.setCartOpen);
  const colors = useColors();
  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';
  const navigation = useNavigation<any>();
  const { addWishlist, removeWishlist, isWishlisted } = useWishlistStore();
  const isAuthenticated = useAuthStore(s => !!s.token);
  
  const [selectedSize, setSelectedSize] = useState<string | null>(initialSize || null);
  const [added, setAdded] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [sizeChartVisible, setSizeChartVisible] = useState(false);

  const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'ONE SIZE'];
  const sortSizes = (a: string, b: string) => {
    const idxA = sizeOrder.indexOf(a.toUpperCase());
    const idxB = sizeOrder.indexOf(b.toUpperCase());
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  };

  const sizes = (product?.variants
    ?.map((v) => {
      const sizeStr = v.size ?? "One Size";
      const sizeVariants = product.variants.filter((x) => (x.size ?? "One Size") === sizeStr);
      const inStockVariant = sizeVariants.find(
        (x) => x.quantityAvailable !== 0 && x.availableForSale !== false
      );
      const chosenVariant = inStockVariant || sizeVariants[0] || v;
      return {
        size: sizeStr,
        variantId: String(chosenVariant.id),
        isOutOfStock: chosenVariant.quantityAvailable === 0 || !chosenVariant.availableForSale,
      };
    })
    .filter((v, i, a) => a.findIndex((x) => x.size === v.size) === i) || [])
    .sort((a, b) => sortSizes(a.size, b.size));

  const price = product?.price || '0';
  const image = resolveImageUrl(product?.featuredImage);

  // Reset state when modal opens with a new product
  useEffect(() => {
    if (visible) {
      setSelectedSize(initialSize || (sizes.length === 1 ? sizes[0]?.size : null));
      setAdded(false);
      setSizeError(false);
    }
  }, [visible, product?.id]);

  // Auto-select if single size
  useEffect(() => {
    if (sizes.length === 1) setSelectedSize(sizes[0].size);
    setSizeError(false);
  }, [sizes.length]);

  if (!product) return null;

  const needsSize = sizes.length > 0;
  const isSelectedOutOfStock = selectedSize
    ? sizes.find((s) => s.size === selectedSize)?.isOutOfStock || false
    : false;
  const isDefaultOutOfStock = !needsSize && product.variants?.[0]
    ? (product.variants[0].quantityAvailable === 0 || !product.variants[0].availableForSale)
    : false;
  const isSoldOut = needsSize ? (selectedSize ? isSelectedOutOfStock : false) : isDefaultOutOfStock;

  const handleNavigateToProduct = () => {
    if (product?.handle) {
      haptics.buttonTap();
      onClose();
      setTimeout(() => {
        navigation.navigate('ProductDetail', { handle: product.handle });
      }, 300);
    }
  };
  
  const handleWishlistToggle = () => {
    if (!product) return;
    
    if (!isAuthenticated) {
      haptics.buttonTap();
      Alert.alert('Sign In Required', 'Please sign in to add items to your wishlist.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => { onClose(); navigation.navigate('Auth'); } }
      ]);
      return;
    }

    const token = useAuthStore.getState().token;
    haptics.buttonTap();
    if (isWishlisted(product.id)) {
      removeWishlist(product.id, token);
    } else {
      if (needsSize && !selectedSize) {
        setSizeError(true);
        haptics.error();
        return;
      }
      addWishlist(product, token);
    }
  };

  const handleAdd = () => {
    // Strictly require login for adding to bag
    if (!isAuthenticated) {
      haptics.buttonTap();
      Alert.alert('Sign In Required', 'Please sign in to add products to your bag.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => { onClose(); navigation.navigate('Auth'); } }
      ]);
      return;
    }

    // Strictly require size selection when product has variants
    if (needsSize && !selectedSize) {
      setSizeError(true);
      haptics.error();
      return;
    }
    
    const variant = sizes.find((s) => s.size === (selectedSize ?? sizes[0]?.size));
    const variantObj = product.variants?.find((v) => String(v.id) === variant?.variantId) || product.variants?.[0];
    
    addItem({
      productId: product.id,
      variantId: variant?.variantId || product.variants?.[0]?.id || product.id,
      title: product.title,
      size: selectedSize,
      handle: product.handle,
      price: variantObj ? variantObj.price : product.price,
      image: product.featuredImage || '',
    });

    haptics.success();
    setAdded(true);
    
    setTimeout(() => {
      setAdded(false);
      onClose();
      // Auto-open cart after modal closes
      setTimeout(() => setCartOpen(true), 300);
    }, 900);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {Platform.OS === 'android' ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.75)' }]} />
        ) : (
          <BlurView intensity={isDark ? 40 : 20} tint={isDark ? 'dark' : 'default'} style={StyleSheet.absoluteFill} />
        )}
        
        <Pressable style={[styles.sheet, { borderColor: colors.borderLight }]} onPress={(e) => e.stopPropagation()}>
          {Platform.OS === 'android' ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(18, 18, 18, 0.95)' : 'rgba(245, 245, 245, 0.97)' }]} />
          ) : (
            <BlurView intensity={isDark ? 30 : 100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          
          {/* Drag Handle */}
          <View style={styles.dragHandleContainer}>
            <View style={[styles.dragHandle, { backgroundColor: colors.textMuted }]} />
          </View>

          {/* Header — tappable product image and name to navigate to product page */}
          <View style={styles.header}>
            <TouchableOpacity 
              style={styles.productInfo} 
              activeOpacity={product.handle ? 0.6 : 1}
              onPress={handleNavigateToProduct}
              accessibilityLabel={`View full details for ${product.title}`}
              accessibilityRole="link"
            >
              <Image source={image ? { uri: image } : undefined} style={[styles.previewImage, { backgroundColor: colors.surface }]} contentFit="cover" />
              <View style={styles.textInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.productTitle, { color: colors.text, flex: 1 }]} numberOfLines={1}>{product.title}</Text>
                </View>
                <Text style={[styles.productPrice, { color: colors.textExtraLight }]}>{formatPrice(price)}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={onClose} 
              style={styles.closeBtn}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={20} color={colors.text} style={{ opacity: 0.3 }} />
            </TouchableOpacity>
          </View>

          {/* Size Selection */}
          {sizes.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: sizeError ? '#FF3B30' : colors.textExtraLight }]}>
                  {sizeError ? 'PLEASE SELECT A SIZE' : 'SELECT SIZE'}
                </Text>
                <TouchableOpacity 
                  onPress={() => { haptics.buttonTap(); setSizeChartVisible(true); }}
                  accessibilityLabel="View size guide"
                  accessibilityRole="button"
                >
                  <Text style={[styles.guideLink, { color: colors.textSecondary }]}>GUIDE</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.sizeRow}>
                {sizes.map(({ size, isOutOfStock }) => {
                  const isActive = selectedSize === size;
                  return (
                    <TouchableOpacity
                      key={size}
                      disabled={isOutOfStock}
                      onPress={() => {
                        setSelectedSize(size);
                        setSizeError(false);
                        haptics.buttonTap();
                      }}
                      style={[
                        styles.sizeBox,
                        { borderColor: sizeError ? 'rgba(255,59,48,0.3)' : colors.borderLight },
                        isActive && { backgroundColor: '#000', borderColor: '#000' },
                        isOutOfStock && { opacity: 0.25 }
                      ]}
                      accessibilityLabel={`Select size ${size}${isOutOfStock ? ' - Out of stock' : ''}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive, disabled: isOutOfStock }}
                    >
                      <Text style={[
                        styles.sizeBoxText,
                        { color: isActive ? '#FFF' : colors.textSecondary }
                      ]}>{size}</Text>
                      {isOutOfStock && (
                        <View style={[styles.diagonalLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }]} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* No variants available — navigate to product page for full details */}
          {sizes.length === 0 && product.handle && (
            <View style={styles.section}>
              <TouchableOpacity 
                onPress={handleNavigateToProduct}
                style={[styles.viewProductBtn, { borderColor: colors.borderLight }]}
                activeOpacity={0.7}
              >
                <Ionicons name="expand-outline" size={14} color={colors.text} />
                <Text style={[styles.viewProductText, { color: colors.text }]}>VIEW FULL PRODUCT DETAILS</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textExtraLight} />
              </TouchableOpacity>
            </View>
          )}

          {/* Add Button */}
          <View style={styles.footerContainer}>
            <TouchableOpacity 
              onPress={handleWishlistToggle} 
              style={[styles.wishlistBtn, { borderColor: colors.borderLight }]}
              accessibilityLabel={isWishlisted(product.id) ? "Remove from wishlist" : "Add to wishlist"}
              accessibilityRole="button"
            >
              <Ionicons 
                name={isWishlisted(product.id) ? "bookmark" : "bookmark-outline"} 
                size={20} 
                color={isWishlisted(product.id) ? colors.text : colors.text} 
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleAdd}
              disabled={added || isSoldOut}
              style={[
                styles.addBtn,
                { backgroundColor: added ? colors.iosGreen : '#000' },
                ((needsSize && !selectedSize) || isSoldOut) && styles.addBtnNeedsSize
              ]}
              activeOpacity={0.8}
              accessibilityLabel={added ? "Item added to bag" : isSoldOut ? "Sold Out" : (needsSize && !selectedSize ? "Select a size before adding to bag" : "Add to bag")}
              accessibilityRole="button"
            >
              {added ? (
                <Text style={styles.addBtnText}>Added to Bag</Text>
              ) : isSoldOut ? (
                <Text style={styles.addBtnText}>Sold Out</Text>
              ) : (
                <View style={styles.btnContent}>
                  <Ionicons name="bag-outline" size={16} color="#FFF" />
                  <Text style={styles.addBtnText}>
                    {needsSize && !selectedSize ? 'Select a Size' : 'Add to Bag'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <SizeChartModal 
            visible={sizeChartVisible} 
            onClose={() => setSizeChartVisible(false)} 
            imageUrl={product.sizeChart}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    overflow: 'hidden',
    paddingBottom: 50,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  productInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  textInfo: {
    marginLeft: 12,
    flex: 1,
  },
  productTitle: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 3,
    marginBottom: 4,
  },
  productPrice: {
    fontSize: 11,
    fontWeight: '300',
    opacity: 0.6,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 7.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 4,
  },
  guideLink: {
    fontSize: 7.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textDecorationLine: 'underline',
  },
  sizeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  sizeBox: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  diagonalLine: {
    position: 'absolute',
    width: '140%',
    height: 1,
    transform: [{ rotate: '150deg' }],
  },
  sizeBoxText: {
    fontSize: 10,
    fontWeight: '600',
  },
  viewProductBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  viewProductText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  footerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  wishlistBtn: {
    width: 60,
    height: 60,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtn: {
    flex: 1,
    height: 60,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addBtnNeedsSize: {
    opacity: 0.4,
  },
  addBtnText: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 4,
    fontWeight: '700',
    color: '#FFF',
  },
});

export default QuickAddModal;
