import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Dimensions, Animated, Platform, PanResponder } from 'react-native';
import { haptics } from '../utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { useCollectionByHandle, useCollections } from '../hooks/useProducts';
import { RootStackParamList } from '../navigation/types';
import ProductCard from '../components/ProductCard';
import GlassHeader from '../components/GlassHeader';
import CollectionFilters from '../components/CollectionFilters';
import QuickAddModal from '../components/QuickAddModal';
import CollectionHeaderCarousel from '../components/CollectionHeaderCarousel';
import StorefrontFooter from '../components/StorefrontFooter';
import { useUIStore } from '../store/uiStore';
import { FlatProduct } from '../api/types';
import { Typography } from '../components/Typography';

const { width } = Dimensions.get('window');

// Logic to group products into layout rows for high-performance virtualization
function groupIntoRows(products: FlatProduct[], viewMode: string) {
  if (!products.length) return [];
  
  const rows: any[] = [];
  if (viewMode === 'large') {
    return products.map(p => ({ type: 'large', products: [p] }));
  }
  
  if (viewMode === 'grid4') {
    for (let i = 0; i < products.length; i += 4) {
      rows.push({ type: 'grid4', products: products.slice(i, i + 4) });
    }
    return rows;
  }

  // Standard 'grid' mode with a recurring pattern (pair, pair, large)
  let i = 0;
  while (i < products.length) {
    // Row 1: Pair
    if (i < products.length) {
      rows.push({ type: 'pair', products: products.slice(i, i + 2) });
      i += 2;
    }
    // Row 2: Pair
    if (i < products.length) {
      rows.push({ type: 'pair', products: products.slice(i, i + 2) });
      i += 2;
    }
    // Row 3: Large (featured)
    if (i < products.length) {
      rows.push({ type: 'large', products: [products[i]] });
      i += 1;
    }
  }
  return rows;
}

export default function CollectionScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'Collection'>>();
  const { handle } = route.params || { handle: 'all' };
  const colors = useColors();
  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';

  const { collection, products, loading, refetch } = useCollectionByHandle(handle);
  const { collections: allCollections } = useCollections(50);
  
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState('featured');
  const [viewMode, setViewMode] = useState<'grid' | 'grid4' | 'large'>('grid');
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isSizeOpen, setIsSizeOpen] = useState(false);
  const [isColorOpen, setIsColorOpen] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<FlatProduct | null>(null);
  const [isCompact, setIsCompact] = useState(false);

  const setTabBarVisible = useUIStore(s => s.setTabBarVisible);
  const lastScrollY = useRef(0);
  
  // Animation for the sticky filter appearance
  const scrollY = useRef(new Animated.Value(0)).current;

  // Custom edge swipe-back gesture handler
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt, gestureState) => {
        return evt.nativeEvent.pageX < 40;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return evt.nativeEvent.pageX < 40 && gestureState.dx > 10 && Math.abs(gestureState.dy) < 15;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 60 && Math.abs(gestureState.dy) < 50) {
          haptics.buttonTap();
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            const parent = navigation.getParent();
            if (parent && parent.canGoBack()) {
              parent.goBack();
            } else {
              const state = navigation.getState();
              const routeNames = state?.routeNames || [];
              if (routeNames.includes('ShopScreen')) {
                navigation.navigate('ShopScreen');
              } else if (routeNames.includes('SearchScreen')) {
                navigation.navigate('SearchScreen');
              } else if (routeNames.includes('HomeScreen')) {
                navigation.navigate('HomeScreen');
              } else {
                navigation.navigate('HomeTab');
              }
            }
          }
        }
      },
    })
  ).current;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleQuickAdd = useCallback((product: FlatProduct) => {
    setSelectedProduct(product);
    setModalVisible(true);
  }, []);

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { 
      useNativeDriver: false,
      listener: (event: any) => {
        const currentY = event.nativeEvent.contentOffset.y;
        const diff = currentY - lastScrollY.current;

        if (currentY < 150) {
          setIsCompact(false);
        } else {
          setIsCompact(true);
        }

        if (Math.abs(diff) > 15) {
          const isVisible = useUIStore.getState().isTabBarVisible;
          if (diff > 0 && currentY > 200) {
            if (isVisible) setTabBarVisible(false);
          } else {
            if (!isVisible) setTabBarVisible(true);
          }
          if (Math.abs(diff) > 20 && isSizeOpen) setIsSizeOpen(false);
          if (Math.abs(diff) > 20 && isColorOpen) setIsColorOpen(false);
          lastScrollY.current = currentY;
        }
      }
    }
  );

  const productRows = useMemo(() => {
    if (!products || !Array.isArray(products)) return [];
    let list = [...products];
    if (selectedSize) {
      list = list.filter(p => p?.variants?.some(v => v.size === selectedSize));
    }
    if (selectedColor) {
      list = list.filter(p => p?.variants?.some(v => v.color === selectedColor));
    }
    if (sortBy === 'newest') list.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
    else if (sortBy === 'price-asc') list.sort((a, b) => parseFloat(a.price || '0') - parseFloat(b.price || '0'));
    else if (sortBy === 'price-desc') list.sort((a, b) => parseFloat(b.price || '0') - parseFloat(a.price || '0'));
    
    return groupIntoRows(list, viewMode);
  }, [products, selectedSize, selectedColor, sortBy, viewMode]);

  const allSizes = useMemo(() => {
    if (!products || !Array.isArray(products)) return [];
    return Array.from(new Set(
      products.flatMap(p => p?.variants?.map(v => v.size).filter(s => s && s !== 'Default Title') || [])
    )).sort();
  }, [products]);

  const allColors = useMemo(() => {
    if (!products || !Array.isArray(products)) return [];
    const colorsSet = new Set<string>();
    products.forEach(p => {
      p.variants.forEach(v => {
        if (v.color) {
          colorsSet.add(v.color);
        }
      });
    });
    return Array.from(colorsSet).sort();
  }, [products]);

  const toggleView = useCallback(() => {
    setViewMode(prev => {
      if (prev === 'grid') return 'grid4';
      if (prev === 'grid4') return 'large';
      return 'grid';
    });
  }, []);

  const renderRow = useCallback(({ item }: { item: any }) => {
    return (
      <View style={styles.row}>
        {item?.products?.map((p: FlatProduct) => (
          <View 
            key={p.id} 
            style={[
              item.type === 'pair' && styles.gridWrapper,
              item.type === 'grid4' && styles.grid4Wrapper,
              item.type === 'large' && styles.largeWrapper,
            ]}
          >
            <ProductCard 
              product={p} 
              onQuickAdd={handleQuickAdd}
              style={item.type === 'large' ? { width: '100%' } : undefined}
              compact={item.type === 'grid4'}
              isLarge={item.type === 'large'}
            />
          </View>
        ))}
      </View>
    );
  }, [handleQuickAdd]);

  // Sticky Filter Animation Values
  const stickyFilterOpacity = scrollY.interpolate({
    inputRange: [180, 220],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const stickyFilterTranslateY = scrollY.interpolate({
    inputRange: [180, 220],
    outputRange: [-20, 0],
    extrapolate: 'clamp',
  });

  if (loading && !refreshing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.textExtraLight} />
      </View>
    );
  }

  return (
    <View 
      style={[styles.container, { backgroundColor: colors.background }]}
      {...panResponder.panHandlers}
    >
      {/* ── Main List ── */}
      <FlatList
        data={productRows}
        keyExtractor={(item) => item?.products?.[0]?.id?.toString() ?? item?.products?.[0]?.handle ?? item?.products?.[0]?.title ?? Math.random().toString()}
        renderItem={renderRow}
        ListHeaderComponent={
          <View style={{ zIndex: 1000, elevation: 1000 }}>
            <View style={{ paddingTop: insets.top + 60, paddingBottom: 8 }}>
              <CollectionHeaderCarousel currentHandle={handle} collections={allCollections as any[]} />
            </View>
            <View style={styles.inlineFilterContainer}>
              <CollectionFilters 
                allSizes={allSizes as string[]}
                selectedSize={selectedSize}
                onSelectSize={setSelectedSize}
                allColors={allColors}
                selectedColor={selectedColor}
                onSelectColor={setSelectedColor}
                sortBy={sortBy}
                onSelectSort={setSortBy}
                viewMode={viewMode}
                onToggleView={toggleView}
                isTabBarVisible={true}
                isSizeOpen={isSizeOpen}
                setIsSizeOpen={setIsSizeOpen}
                isColorOpen={isColorOpen}
                setIsColorOpen={setIsColorOpen}
                compact={false}
              />
            </View>
            <Typography size={7} weight="300" color={colors.textExtraLight} style={styles.count}>
              {(products || []).length} PRODUCTS
            </Typography>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footerContainer}>
            <StorefrontFooter />
            <View style={{ height: 100 + insets.bottom }} />
          </View>
        }
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#FFF' : '#000'} />
        }
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={true}
      />

      {/* ── Fixed Header ── */}
      <GlassHeader title={collection?.title || 'Collection'} showBack style={{ backgroundColor: 'transparent' }} />

      {/* ── Sticky Advanced Filter ── */}
      <Animated.View 
        pointerEvents={isCompact ? 'box-none' : 'none'}
        style={[
          styles.stickyFilterSection, 
          { 
            top: insets.top + 48,
            opacity: stickyFilterOpacity,
            transform: [{ translateY: stickyFilterTranslateY }],
          }
        ]}
      >
        <CollectionFilters 
          allSizes={allSizes as string[]}
          selectedSize={selectedSize}
          onSelectSize={setSelectedSize}
          allColors={allColors}
          selectedColor={selectedColor}
          onSelectColor={setSelectedColor}
          sortBy={sortBy}
          onSelectSort={setSortBy}
          viewMode={viewMode}
          onToggleView={toggleView}
          isTabBarVisible={true}
          isSizeOpen={isSizeOpen}
          setIsSizeOpen={setIsSizeOpen}
          isColorOpen={isColorOpen}
          setIsColorOpen={setIsColorOpen}
          compact={true} // Always compact when sticky for cleaner look
        />
      </Animated.View>

      <QuickAddModal visible={modalVisible} product={selectedProduct} onClose={() => setModalVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  inlineFilterContainer: {
    paddingVertical: 8,
    zIndex: 10,
    elevation: 10, // For Android support
  },
  stickyFilterSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3000,
    paddingVertical: 8,
    alignItems: 'center',
  },
  count: { letterSpacing: 4, marginBottom: 12, textAlign: 'center', marginTop: 12 },
  row: { flexDirection: 'row', width: '100%' },
  gridWrapper: { width: Math.floor(width / 2) },
  grid4Wrapper: { width: Math.floor(width / 4) },
  largeWrapper: { width: '100%' },
  footerContainer: { marginTop: 40 },
});
