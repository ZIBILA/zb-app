import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, Dimensions, ActivityIndicator, Animated, Alert, Modal, Pressable, InteractionManager
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { GlassView, GlassBackdrop } from '../components/GlassView';
import { Image } from 'expo-image';
import OptimizedImage from '../components/OptimizedImage';
import Carousel from 'react-native-reanimated-carousel';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { haptics } from '../utils/haptics';
import { useProductByHandle, useProducts } from '../hooks/useProducts';
import { useCartStore } from '../store/cartStore';
import { useAuthStore } from '../store/authStore';
import { useWishlistStore } from '../store/wishlistStore';
import { RootStackParamList } from '../navigation/types';
import { Typography } from '../components/Typography';
import { formatPrice } from '../utils/formatPrice';
import { useUIStore } from '../store/uiStore';
import ProductCard from '../components/ProductCard';
import { useRecentStore } from '../store/recentStore';
import StorefrontFooter from '../components/StorefrontFooter';
import { SizeChartModal } from '../components/SizeChartModal';
import { config } from '../constants/config';
import QuickAddModal from '../components/QuickAddModal';
import { FlatProduct } from '../api/types';

import { resolveImageUrl } from '../utils/imageUtils';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/**
 * Custom ImageViewerModal for premium zooming experience
 */
const ImageViewerModal = ({ visible, images, activeIndex, onClose }: any) => {
  const [index, setIndex] = useState(activeIndex);
  const colors = useColors();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';

  useEffect(() => { setIndex(activeIndex); }, [activeIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <GlassView intensity={isDark ? 80 : 100} tint={isDark ? "dark" : "light"} style={[StyleSheet.absoluteFill, { borderWidth: 0, borderRadius: 0 }]}>
        <View style={styles.viewerHeader}>
          <Typography size={7} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 2 }}>
            {index + 1} / {images.length}
          </Typography>
          <TouchableOpacity onPress={onClose} style={styles.viewerClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        
        <ScrollView 
          horizontal 
          pagingEnabled 
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
            setIndex(newIndex);
          }}
          contentOffset={{ x: index * SCREEN_W, y: 0 }}
        >
          {images.map((img: any, idx: number) => (
            <View key={idx} style={styles.viewerItem}>
              <ScrollView
                maximumZoomScale={4}
                minimumZoomScale={1}
                bouncesZoom={true}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  flexGrow: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  width: SCREEN_W,
                  height: SCREEN_H,
                }}
              >
                <Image 
                  source={resolveImageUrl(img) || undefined} 
                  style={styles.viewerImage} 
                  contentFit="contain" 
                  transition={400} 
                />
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      </GlassView>
    </Modal>
  );
};

/**
 * CuratedItem component for the "Curated Pairs" section
 */
const CuratedItem = React.memo(({ product, onPress, onQuickAdd, colors }: { product: FlatProduct, onPress: () => void, onQuickAdd: () => void, colors: any }) => {
  const featuredImage = useMemo(() => {
    return product.featuredImage || (product.images && product.images.length > 0 ? product.images[0] : '');
  }, [product.featuredImage, product.images]);

  return (
    <TouchableOpacity 
      onPress={onPress} 
      activeOpacity={0.9}
    >
      <View style={styles.curatedItem}>
      <View style={styles.curatedCard}>
        <View style={{ flex: 1 }}>
          <Image 
            source={resolveImageUrl(featuredImage) ? { uri: resolveImageUrl(featuredImage) as string } : undefined} 
            style={StyleSheet.absoluteFill} 
            contentFit="cover" 
            cachePolicy="memory-disk"
          />
        </View>
      </View>
      <View style={styles.curatedMeta}>
         <View style={{ flex: 1 }}>
           <Typography size={7.5} weight="400" color={colors.text} numberOfLines={1} style={curatedStyles.titleText}>{String(product?.title || '').toUpperCase()}</Typography>
           <Typography size={7.5} weight="300" color={colors.textSecondary}>{formatPrice(product?.price)}</Typography>
         </View>
         <TouchableOpacity 
           onPress={(e) => { 
             e.stopPropagation(); 
             onQuickAdd();
           }}
           style={styles.plusBtn}
         >
            <Ionicons name="add" size={16} color={colors.text} style={curatedStyles.plusIcon} />
         </TouchableOpacity>
      </View>
    </View>
    </TouchableOpacity>
  );
});

const curatedStyles = StyleSheet.create({
  titleText: {
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  plusIcon: {
    opacity: 0.4,
  },
});

export default function ProductDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'ProductDetail'>>();
  const { handle } = route.params || { handle: '' };
  const colors = useColors();
  const theme = useThemeStore((state) => state.theme);
  const isDark = theme === 'dark';

  const { product, loading } = useProductByHandle(handle);
  const { products: allProducts, loading: recommendedLoading } = useProducts(24);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  
  // Randomly shuffle products for "Curated Pairs" on each visit
  const recommended = useMemo(() => {
    if (!allProducts || allProducts.length === 0) return [];
    return [...allProducts]
      .filter(p => p.id !== product?.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 8);
  }, [allProducts, product?.id]);
  const { addItem, setBuyNowItem } = useCartStore();
  const cartCount = useCartStore(s => s.itemCount());

  const { addWishlist, removeWishlist, isWishlisted: checkWishlisted } = useWishlistStore();
  const isWishlisted = product ? checkWishlisted(product.id) : false;

  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'DESCRIPTION' | 'DETAILS' | 'CARE' | 'BRAND'>('DESCRIPTION');
  const [sizeChartVisible, setSizeChartVisible] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);

  const mainScrollRef = useRef<ScrollView>(null);
  const carouselRef = useRef<any>(null);
  const thumbnailCarouselRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [showMinimalSticky, setShowMinimalSticky] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<FlatProduct | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isStickySizeExpanded, setIsStickySizeExpanded] = useState(false);
  const [moodBoardImages, setMoodBoardImages] = useState<string[]>([]);

  // Fetch mood board images (same API as webstore PDP, with gallery fallback)
  useEffect(() => {
    if (!product) return;
    const rawId = (product.id || '').toString();
    const numericId = rawId.replace(/^gid:\/\/shopify\/Product\//i, '');
    const BASE_URL = config.appUrl.replace(/\/$/, '');

    let isMounted = true;

    const tryFetch = async () => {
      // 1. Try DB lookup by numericId, rawId, and handle
      const idsToTry = [numericId, rawId, product.handle].filter(Boolean);

      for (const idToTry of idsToTry) {
        try {
          const res = await fetch(`${BASE_URL}/api/mood-board?productId=${encodeURIComponent(idToTry!)}`);
          if (res.ok) {
            const data = await res.json();
            if (isMounted && Array.isArray(data.images) && data.images.length > 0) {
              setMoodBoardImages(data.images.filter(Boolean));
              return;
            }
          }
        } catch (e) {}
      }

      // 2. Fallback: if no custom mood board in DB, use product gallery images
      if (isMounted) {
        let galleryImages: string[] = [];
        if (product.images && Array.isArray(product.images) && product.images.length > 0) {
          galleryImages = product.images.filter(Boolean);
        } else if (product.featuredImage) {
          galleryImages = [product.featuredImage];
        }

        if (galleryImages.length > 0) {
          setMoodBoardImages(galleryImages.slice(0, 5));
        }
      }
    };

    tryFetch();

    return () => {
      isMounted = false;
    };
  }, [product?.id, product?.handle, product?.images, product?.featuredImage]);

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      if (value > 480 && !showMinimalSticky) setShowMinimalSticky(true);
      if (value <= 480 && showMinimalSticky) setShowMinimalSticky(false);
    });
    return () => scrollY.removeListener(id);
  }, [showMinimalSticky]);

  const stickyOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(stickyOpacity, {
      toValue: showMinimalSticky ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [showMinimalSticky]);

  const setCartOpen = useUIStore(s => s.setCartOpen);
  const setWishlistOpen = useUIStore(s => s.setWishlistOpen);
  const { addProduct: recordVisit, recentProducts } = useRecentStore();

  const player = useVideoPlayer(product?.productVideo ?? null, (player) => {
    player.loop = false;
    player.muted = true;
  });

  const isFocused = useNavigation().isFocused();

  const isAppActive = useUIStore(s => s.isAppActive);

  useEffect(() => {
    if (!player) return;
    if (!isFocused || !isAppActive) {
      player.pause();
    } else {
      // Small delay to ensure smooth transition
      const task = InteractionManager.runAfterInteractions(() => {
        player.play();
      });
      return () => task.cancel();
    }
  }, [isFocused, isAppActive, player]);

  useEffect(() => {
    if (player) {
      player.muted = isMuted;
    }
  }, [isMuted, player]);

  const options = useMemo(() => {
    if (!product) return { sizes: [], colors: [] };
    const sizesSet = new Set<string>();
    const colorsSet = new Set<string>();
    product.variants.forEach(v => {
      if (v.size) sizesSet.add(v.size);
      if (v.color) colorsSet.add(v.color);
    });

    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'ONE SIZE'];
    const sortSizes = (a: string, b: string) => {
      const idxA = sizeOrder.indexOf(a.toUpperCase());
      const idxB = sizeOrder.indexOf(b.toUpperCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    };

    return { 
      sizes: Array.from(sizesSet).sort(sortSizes), 
      colors: Array.from(colorsSet).sort() 
    };
  }, [product]);

  useEffect(() => {
    if (options.sizes.length === 1) setSelectedSize(options.sizes[0]);
    if (options.colors.length > 0) setSelectedColor(options.colors[0]);
    if (product) recordVisit(product);
  }, [options, product, recordVisit]);

  const requireSize = (): boolean => {
    if (options.sizes.length > 0 && !selectedSize) {
      setSizeError(true);
      haptics.buttonTap();
      setTimeout(() => setSizeError(false), 2000);
      return false;
    }
    return true;
  };

  const handleAddToCart = () => {
    if (!product) return;
    if (!requireSize()) return;

    if (!isAuthenticated) {
      haptics.buttonTap();
      Alert.alert('Sign In Required', 'Please sign in to add products to your bag and access your cart.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => navigation.navigate('Auth') }
      ]);
      return;
    }

    const variant = product.variants.find(v => 
      (v.size === selectedSize || !v.size) && 
      (v.color === selectedColor || !v.color)
    ) || product.variants.find(v => v.size === selectedSize) || product.variants[0];
    
    addItem({
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      size: selectedSize,
      handle: product.handle,
      price: variant.price,
      image: product.featuredImage,
    });
    setIsStickySizeExpanded(false);
    haptics.addToCart();
    setCartOpen(true);
  };

  const handleBuyNow = () => {
    if (!product) return;
    if (!requireSize()) return;
    
    const variant = product.variants.find(v => 
      (v.size === selectedSize || !v.size) && 
      (v.color === selectedColor || !v.color)
    ) || product.variants.find(v => v.size === selectedSize) || product.variants[0];
    
    setBuyNowItem({
      id: `${product.id}_${variant.id}_${selectedSize || 'one-size'}`,
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      size: selectedSize,
      // color: selectedColor,
      handle: product.handle,
      price: variant.price,
      image: product.featuredImage,
      quantity: 1,
    });

    haptics.buttonTap();
    
    if (!isAuthenticated) {
      Alert.alert('Login Required', 'Please log in to proceed with checkout and payment.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => navigation.navigate('Auth') }
      ]);
      return;
    }
    
    navigation.navigate('CheckoutFlow');
  };

  const handleWishlistToggle = () => {
    if (!product) return;
    
    if (!isAuthenticated) {
      haptics.buttonTap();
      Alert.alert('Sign In Required', 'Please sign in to add items to your wishlist and sync them across your devices.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => navigation.navigate('Auth') }
      ]);
      return;
    }

    const token = useAuthStore.getState().token;
    haptics.buttonTap();
    if (isWishlisted) {
      removeWishlist(product.id, token);
    } else {
      if (!requireSize()) return;
      addWishlist(product, token);
    }
  };

  const images = product ? (product.images.length > 0 ? product.images : [product.featuredImage]) : [];

  const renderHeroItem = useCallback(({ item, index }: any) => (
    <TouchableOpacity 
      activeOpacity={0.9} 
      onPress={() => { haptics.buttonTap(); setViewerVisible(true); }}
      style={styles.heroContainer}
    >
      <OptimizedImage 
        source={String(item)} 
        style={styles.heroImage} 
        shopifyWidth={800}
      />
      <View style={styles.zoomPulse}>
        <Ionicons name="expand-outline" size={12} color="#FFF" />
      </View>
      
      {/* Background preloading of adjacent image */}
      {index === activeImageIndex && images[index + 1] && (
        <View style={{ width: 0, height: 0, opacity: 0 }}>
          <OptimizedImage source={String(images[index + 1])} shopifyWidth={800} />
        </View>
      )}
    </TouchableOpacity>
  ), [activeImageIndex, images]);

  if (loading || !product) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.textExtraLight} />
      </View>
    );
  }


  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── TOP NAV ACTIONS ── */}
      <View style={[styles.topActions, { top: insets.top + 10 }]}>
        <TouchableOpacity 
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')}
          style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}
        >
          <GlassBackdrop intensity={20} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.topRightActions}>
          <TouchableOpacity 
            onPress={() => { haptics.buttonTap(); setWishlistOpen(true); }} 
            style={[styles.actionBtnSmall, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}
          >
            <Ionicons name="bookmark-outline" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => { haptics.buttonTap(); setCartOpen(true); }} 
            style={[styles.actionBtnSmall, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}
          >
            <Ionicons name="bag-outline" size={14} color={colors.textSecondary} />
            {cartCount > 0 && <View style={[styles.cartBadge, { backgroundColor: colors.text }]} />}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        ref={mainScrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 160 + insets.bottom }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      >
        {/* ── HERO GALLERY: CAROUSEL EXPERIENCE ── */}
        <View style={styles.heroWrapper}>
           <Carousel
              ref={carouselRef}
              data={images}
              renderItem={renderHeroItem}
              width={SCREEN_W}
              height={SCREEN_H * 0.72} // Much taller for full screen feel
              onSnapToItem={(index) => {
                setActiveImageIndex(index);
                thumbnailCarouselRef.current?.scrollTo({ index, animated: true });
              }}
              loop
              autoPlay={false}
              onConfigurePanGesture={(panGesture: any) => panGesture.activeOffsetX([-10, 10])}
              windowSize={3}
           />
        </View>

        <View style={{ height: 180, marginTop: 16 }}>
          <Carousel
            ref={thumbnailCarouselRef}
            data={images}
            width={120}
            height={165}
            style={{ width: SCREEN_W }}
            loop
            autoPlay={false}
            onConfigurePanGesture={(panGesture: any) => panGesture.activeOffsetX([-10, 10])}
            renderItem={({ index }) => (
              <TouchableOpacity 
                key={index} 
                activeOpacity={0.8}
                onPress={() => { 
                  haptics.buttonTap(); 
                  setActiveImageIndex(index);
                  carouselRef.current?.scrollTo({ index, animated: true });
                  thumbnailCarouselRef.current?.scrollTo({ index, animated: true });
                }}
                style={[
                  styles.thumbnail, 
                  activeImageIndex === index && {
                    borderWidth: 1.5,
                    borderColor: colors.text,
                  },
                  { width: 110 }
                ]}
              >
                <OptimizedImage source={String(images[index])} style={StyleSheet.absoluteFill} shopifyWidth={200} />
              </TouchableOpacity>
            )}
          />
        </View>

        {/* ── PRODUCT INFO ── */}
        <View style={styles.infoSection}>
           <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <Typography 
                  size={15} 
                  weight="300" 
                  color={colors.text} 
                  style={[styles.title, { letterSpacing: 4, lineHeight: 22 }]}
                >
                  {String(product?.title || '').toUpperCase()}
                </Typography>
                <Typography size={11} weight="400" color={colors.textSecondary} style={[styles.price, { marginTop: 2, opacity: 0.6 }]}>
                  {formatPrice(product.price)}
                </Typography>
              </View>
              <TouchableOpacity 
                style={[styles.wishlistToggle, { backgroundColor: isWishlisted ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent' }]}
                onPress={handleWishlistToggle}
              >
                <Ionicons 
                  name={isWishlisted ? "bookmark" : "bookmark-outline"} 
                  size={16} 
                  color={isWishlisted ? colors.text : colors.textExtraLight} 
                />
              </TouchableOpacity>
           </View>

           {/* SIZE SELECTOR */}
           <View style={styles.selectorSection}>
              <View style={styles.selectorHeader}>
                <Typography size={6.5} weight="600" color={sizeError ? '#FF3B30' : colors.textExtraLight} style={styles.selectorLabel}>
                  SELECT SIZE{sizeError ? '  ·  REQUIRED' : ''}
                </Typography>
                <TouchableOpacity onPress={() => { haptics.buttonTap(); setSizeChartVisible(true); }}>
                   <Typography size={6.5} weight="700" color={colors.textExtraLight} style={{ textDecorationLine: 'underline', opacity: 0.4 }}>SIZE GUIDE</Typography>
                </TouchableOpacity>
              </View>
               <View style={styles.sizeGrid}>
                {options.sizes.map(s => {
                  const variant = product.variants.find(v => v.size === s && (v.color === selectedColor || !selectedColor));
                  const isOutOfStock = variant?.quantityAvailable === 0;
                  return (
                    <TouchableOpacity 
                      key={s} 
                      onPress={() => { haptics.buttonTap(); setSelectedSize(s); setSizeError(false); }}
                      disabled={isOutOfStock}
                      style={[
                        styles.sizeOption, 
                        { 
                          borderColor: sizeError ? 'rgba(255,59,48,0.3)' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), 
                          backgroundColor: selectedSize === s ? colors.text : 'transparent'
                        },
                        isOutOfStock && { opacity: 0.25 }
                      ]}
                    >
                      <Typography 
                        size={8.5} 
                        weight="500" 
                        color={selectedSize === s ? colors.background : colors.textSecondary}
                      >
                        {s.toUpperCase()}
                      </Typography>
                      {isOutOfStock && (
                        <View style={[styles.diagonalLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }]} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
           </View>

           {/* COLOR SELECTOR */}
           {options.colors.length > 1 && (
             <View style={styles.selectorSection}>
                <View style={styles.selectorHeader}>
                  <Typography size={6.5} weight="600" color={colors.textExtraLight} style={styles.selectorLabel}>
                    SELECT COLOR
                  </Typography>
                </View>
                <View style={styles.sizeGrid}>
                  {options.colors.map(c => (
                    <TouchableOpacity 
                      key={c} 
                      onPress={() => { haptics.buttonTap(); setSelectedColor(c); }}
                      style={[
                        styles.sizeOption, 
                        { 
                          borderColor: (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), 
                          backgroundColor: selectedColor === c ? colors.text : 'transparent',
                          width: 'auto',
                          paddingHorizontal: 16
                        }
                      ]}
                    >
                      <Typography 
                        size={8.5} 
                        weight="500" 
                        color={selectedColor === c ? colors.background : colors.textSecondary}
                      >
                        {c.toUpperCase()}
                      </Typography>
                    </TouchableOpacity>
                  ))}
                </View>
             </View>
           )}

           {/* PRIMARY ACTIONS */}
           <View style={styles.inlineActions}>
              <TouchableOpacity 
                style={[styles.ghostBtn, { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}
                onPress={handleAddToCart}
                activeOpacity={0.8}
              >
                <Typography size={8} weight="700" color={colors.text} style={{ letterSpacing: 4 }}>ADD TO BAG</Typography>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.primaryBtn, { backgroundColor: colors.foreground }]}
                onPress={handleBuyNow}
                activeOpacity={0.8}
              >
                <Typography size={8} weight="800" color={colors.background} style={{ letterSpacing: 5 }}>BUY NOW</Typography>
              </TouchableOpacity>
           </View>

            {/* INFO ACCORDION */}
           <View style={[styles.tabsBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)', borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
              <View style={[styles.tabsPillContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]}>
                {(['DESCRIPTION', 'DETAILS', 'CARE', 'BRAND'] as const).map(tab => (
                  <TouchableOpacity 
                    key={tab} 
                    onPress={() => { haptics.buttonTap(); setActiveTab(tab); }}
                    style={[styles.tabBtn, activeTab === tab && { backgroundColor: isDark ? 'white' : 'white' }]}
                  >
                    <Typography size={6} weight="700" color={activeTab === tab ? '#000' : colors.textExtraLight} style={{ opacity: activeTab === tab ? 1 : 0.6 }}>
                      {tab}
                    </Typography>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.tabContentArea}>
                <Typography 
                  size={9} 
                  color={colors.textSecondary} 
                  numberOfLines={activeTab === 'DESCRIPTION' && !isDescriptionExpanded ? 3 : undefined}
                  style={{ lineHeight: 18, fontWeight: '300' }}
                >
                  {activeTab === 'DESCRIPTION' ? (product.description ? product.description.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n+/g, '\n\n').trim() : '') : 
                   activeTab === 'DETAILS' ? (product.details || "High-density weight. Signature Zica Bella custom cut. Reinforced seams for architectural durability.") :
                   activeTab === 'CARE' ? (product.care || "Dry clean only recommended. Hand wash cold if necessary. Lay flat to dry away from direct sunlight.") :
                   "Founded on the principle of 'Liquid Architecture'. Each piece is a curated artifact of modern luxury."}
                </Typography>
                {activeTab === 'DESCRIPTION' && !isDescriptionExpanded && (
                  <TouchableOpacity 
                    onPress={() => { haptics.buttonTap(); setIsDescriptionExpanded(true); }}
                    style={[styles.viewMorePill, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]}
                  >
                     <Typography size={6} weight="800" color={colors.text}>VIEW MORE</Typography>
                  </TouchableOpacity>
                )}
              </View>
           </View>

           {/* PRODUCT VIDEO */}
           {product.productVideo && (
             <View style={styles.videoSection}>
                <Typography size={7} color={colors.textExtraLight} weight="700" style={styles.sectionTag}>EXPERIMENTAL REFERENCE</Typography>
                <Pressable 
                  style={[styles.videoWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]}
                  onPress={() => { haptics.buttonTap(); setIsMuted(!isMuted); }}
                >
                  <VideoView
                    player={player}
                    style={StyleSheet.absoluteFill}
                    nativeControls={false}
                    contentFit="cover"
                  />
                  <View style={styles.videoOverlay} />
                  <Ionicons 
                    name={isMuted ? "volume-mute-outline" : "volume-medium-outline"} 
                    size={20} 
                    color="#FFF" 
                    style={{ position: 'absolute', bottom: 12, right: 12, opacity: 0.8 }} 
                  />
                </Pressable>
             </View>
           )}

            {/* MOOD BOARD */}
            {moodBoardImages.length > 0 && (
              <View style={styles.moodBoardSection}>
                <Typography size={7} color={colors.textExtraLight} weight="700" style={styles.sectionTag}>MOOD BOARD</Typography>
                <View style={styles.moodBoardGrid}>
                  {moodBoardImages.slice(0, 10).map((img, idx) => {
                    const resolvedUri = resolveImageUrl(img);
                    if (!resolvedUri) return null;
                    return (
                      <View
                        key={`mb-${idx}`}
                        style={[styles.moodBoardItem, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}
                      >
                        <Image
                          source={{ uri: resolvedUri }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          transition={300}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* CURATED PAIRS */}
            {recommended.length > 0 && (
             <View style={styles.curatedSection}>
                <View style={[styles.curatedHeaderFixed, { paddingBottom: 12 }]}>
                  <Typography rocaston size={12} color={colors.text} style={{ letterSpacing: 4 }}>CURATED PAIRS</Typography>
                  <View style={styles.headerArrows}>
                    <TouchableOpacity onPress={() => haptics.buttonTap()} style={{ opacity: 0.3 }}><Ionicons name="arrow-back" size={14} color={colors.text} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => haptics.buttonTap()} style={{ opacity: 0.3, marginLeft: 16 }}><Ionicons name="arrow-forward" size={14} color={colors.text} /></TouchableOpacity>
                  </View>
                </View>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false} 
                  contentContainerStyle={styles.curatedScroll}
                  snapToInterval={SCREEN_W * 0.85}
                  decelerationRate="fast"
                >
                  {recommended.slice(0, 6).map((p) => (
                    <CuratedItem 
                      key={p.id}
                      product={p}
                      colors={colors}
                      onPress={() => navigation.push('ProductDetail', { handle: p.handle })}
                      onQuickAdd={() => {
                        setSelectedProduct(p);
                        setQuickAddVisible(true);
                      }}
                    />
                  ))}
                </ScrollView>
             </View>
            )}

            {recentProducts.length > 1 && (
               <View style={styles.recentSection}>
                 <Typography size={7} color={colors.textExtraLight} weight="700" style={[styles.sectionTag, { marginLeft: 20 }]}>RECENTLY VIEWED</Typography>
                 <View style={styles.recentGrid}>
                  {recentProducts.filter(p => p.id !== product.id).slice(0, 9).map(p => (
                    <View key={p.id} style={styles.recentCardWrapper}>
                      <ProductCard 
                        product={p} 
                        style={{ width: SCREEN_W / 2 }}
                        onQuickAdd={(item) => {
                          setSelectedProduct(item);
                          setQuickAddVisible(true);
                        }}
                      />
                    </View>
                  ))}
                </View>
              </View>
           )}

           <StorefrontFooter />
        </View>
      </ScrollView>

      {/* ── MINIMAL STICKY ACTION ── */}
      <Animated.View style={[styles.minimalStickyFooter, { paddingBottom: insets.bottom + 8, opacity: stickyOpacity, transform: [{ translateY: stickyOpacity.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
         {isStickySizeExpanded && !selectedSize ? (
           <View style={[styles.stickySizeSelector, { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
             <GlassBackdrop intensity={isDark ? 80 : 100} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
             <View style={styles.stickySizeHeader}>
               <Typography size={6} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 2 }}>SELECT SIZE</Typography>
               <TouchableOpacity onPress={() => setIsStickySizeExpanded(false)}>
                 <Ionicons name="close-circle" size={20} color={colors.textExtraLight} />
               </TouchableOpacity>
             </View>
             <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 10, paddingVertical: 10 }}>
               {options.sizes.map(s => {
                 const variant = product.variants.find(v => v.size === s);
                 const isOutOfStock = variant?.quantityAvailable === 0;
                 return (
                   <TouchableOpacity 
                     key={s} 
                     disabled={isOutOfStock}
                     onPress={() => { haptics.buttonTap(); setSelectedSize(s); setIsStickySizeExpanded(false); }}
                     style={[
                       styles.stickySizeBtn, 
                       { 
                         backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                         borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' 
                       },
                       isOutOfStock && { opacity: 0.3 }
                     ]}
                   >
                     <Typography size={8} weight="700" color={colors.text}>{s.toUpperCase()}</Typography>
                   </TouchableOpacity>
                 );
               })}
             </ScrollView>
           </View>
         ) : (
           <TouchableOpacity 
             style={[styles.minimalAddBtn, { backgroundColor: colors.foreground }]}
             onPress={() => {
               if (!selectedSize && options.sizes.length > 0) {
                 setIsStickySizeExpanded(true);
                 haptics.buttonTap();
               } else {
                 handleAddToCart();
               }
             }}
             activeOpacity={0.9}
           >
             <Typography size={8} weight="800" color={colors.background} style={{ letterSpacing: 3 }}>
               {selectedSize ? `ADD ${selectedSize.toUpperCase()}` : 'ADD TO BAG'}
             </Typography>
             <View style={{ width: 1, height: 10, backgroundColor: colors.background, opacity: 0.25, marginHorizontal: 12 }} />
             <Typography size={8} weight="300" color={colors.background} style={{ opacity: 0.7 }}>{formatPrice(product.price)}</Typography>
           </TouchableOpacity>
         )}
      </Animated.View>

      <SizeChartModal 
        visible={sizeChartVisible} 
        onClose={() => setSizeChartVisible(false)}
        imageUrl={product.sizeChart}
      />

      <QuickAddModal 
        visible={quickAddVisible}
        product={selectedProduct}
        onClose={() => setQuickAddVisible(false)}
      />

      <ImageViewerModal 
        visible={viewerVisible} 
        images={images} 
        activeIndex={activeImageIndex}
        onClose={() => setViewerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topActions: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 1000,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  actionBtnSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  topRightActions: {
    flexDirection: 'row',
    gap: 6,
  },
  cartBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  videoSection: {
    marginBottom: 24,
  },
  sectionTag: {
    letterSpacing: 4,
    marginBottom: 10,
    opacity: 0.3,
    paddingHorizontal: 0,
  },
  videoWrapper: {
    width: SCREEN_W - 40,
    alignSelf: 'center',
    aspectRatio: 10 / 14,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  heroWrapper: {
    paddingHorizontal: 0, 
    marginTop: 0, // Ensure it bleeds to top
  },
  heroContainer: {
    width: '100%',
    height: '100%', 
  },
  heroImage: { flex: 1 },
  zoomPulse: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailScroll: {
    paddingHorizontal: 20,
    gap: 10,
  },
  thumbnail: {
    width: 110, 
    height: 165, // Recalibrated for proper portrait aspect
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  activeDot: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  infoSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: { letterSpacing: 0.5, marginBottom: 2, lineHeight: 20 },
  price: { letterSpacing: 2 },
  wishlistToggle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectorSection: {
    marginBottom: 16,
  },
  selectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  selectorLabel: { letterSpacing: 3, opacity: 0.4, fontWeight: '500' },
  sizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sizeOption: {
    width: (SCREEN_W - 48 - 30) / 6, 
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
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
  tabsBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 20,
  },
  tabsPillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 12,
    marginBottom: 14,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabContentArea: {
    paddingHorizontal: 2,
  },
  viewMorePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 10,
  },
  curatedSection: {
    marginBottom: 32,
    marginHorizontal: -20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.03)',
    borderBottomColor: 'rgba(0,0,0,0.03)',
  },
  curatedHeaderFixed: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    marginBottom: 4,
  },
  headerArrows: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  curatedScroll: {
    paddingLeft: 0,
  },
  curatedItem: {
    width: SCREEN_W * 0.85,
  },
  curatedCard: {
    aspectRatio: 3 / 5, 
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.01)',
  },
  curatedMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.03)',
  },
  plusBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recentSection: {
    marginBottom: 36,
    marginHorizontal: -20, // Break out of infoSection padding
  },
  recentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 0,
  },
  recentCardWrapper: {
    width: SCREEN_W / 2,
    marginBottom: 0,
  },
  inlineActions: {
    marginBottom: 20,
    marginTop: 4,
    gap: 8,
  },
  minimalStickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2000,
    paddingHorizontal: 20,
    paddingTop: 10,
    alignItems: 'center',
  },
  minimalAddBtn: {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  stickySizeSelector: {
    width: SCREEN_W - 40,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  stickySizeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  stickySizeBtn: {
    width: 50,
    height: 50,
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ghostBtn: {
    width: '100%',
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtn: {
    width: '100%',
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  viewerHeader: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewerClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerItem: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: SCREEN_W,
    height: SCREEN_H * 0.8,
  },
  moodBoardSection: {
    paddingHorizontal: 10,
    marginTop: 32,
    marginBottom: 8,
  },
  moodBoardGrid: {
    gap: 10,
    marginTop: 12,
  },
  moodBoardItem: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(150,150,150,0.08)',
  },
});
