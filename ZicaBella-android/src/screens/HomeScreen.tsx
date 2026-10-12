import React, { useCallback, useState, useRef, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, Dimensions,
  RefreshControl, TouchableOpacity, ActivityIndicator,
  InteractionManager, Platform, NativeSyntheticEvent, NativeScrollEvent
} from 'react-native';
import Animated, { useSharedValue, useAnimatedScrollHandler, runOnJS } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { config } from '../constants/config';
import { haptics } from '../utils/haptics';
import { getOptimizedImageUrl } from '../utils/imageUtils';
import ProductCard from '../components/ProductCard';
import CollectionCarousel from '../components/CollectionCarousel';
import HeroVideo from '../components/HeroVideo';
import GlassHeader from '../components/GlassHeader';
import QuickAddModal from '../components/QuickAddModal';
import RingCarouselSection from '../components/RingCarouselSection';
import { useProducts, useCollections, useCollectionByHandle } from '../hooks/useProducts';
import { FlatProduct } from '../api/types';
import MenuDrawer from '../components/MenuDrawer';
import SpotlightSection from '../components/SpotlightSection';
import FlipbookSection from '../components/FlipbookSection';
import CommunitySection from '../components/CommunitySection';
import { useAdminSettings } from '../hooks/useAdminFeatures';
import { useUIStore } from '../store/uiStore';
import { Typography } from '../components/Typography';
import StorefrontFooter from '../components/StorefrontFooter';

const { width, height: windowHeight } = Dimensions.get('window');
const HERO_HEIGHT = windowHeight;

type VideoSlot = 'hero' | 'collections' | 'featured' | 'flipbook' | 'spotlight' | 'footer' | null;

/**
 * At most ONE live video player on screen at a time.
 * Inactive slots render instant posters only — zero hardware codec / memory thrashing.
 * Slot updates only on scroll settle (no state updates or player allocations during fling).
 */
function pickActiveSlot(scrollY: number): VideoSlot {
  if (scrollY < HERO_HEIGHT * 0.85) return 'hero';
  if (scrollY < HERO_HEIGHT * 1.5) return 'collections';
  if (scrollY > HERO_HEIGHT * 2.2 && scrollY < HERO_HEIGHT * 3.4) return 'flipbook';
  if (scrollY >= HERO_HEIGHT * 3.4 && scrollY < HERO_HEIGHT * 4.6) return 'featured';
  if (scrollY >= HERO_HEIGHT * 4.6 && scrollY < HERO_HEIGHT * 5.6) return 'spotlight';
  if (scrollY >= HERO_HEIGHT * 5.6) return 'footer';
  return null;
}

const ProductGrid = React.memo(function ProductGrid({
  items,
  onQuickAdd,
}: {
  items: FlatProduct[];
  onQuickAdd: (product: FlatProduct) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <View style={styles.gridContainer}>
      {items.map((product) => (
        <View key={product.id} style={styles.gridItem}>
          <ProductCard 
            product={product} 
            onQuickAdd={onQuickAdd}
          />
        </View>
      ))}
    </View>
  );
});

const HomeScreen = React.memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore((state) => state.theme);
  const isDark = theme === 'dark';

  const { settings, loading: settingsLoading } = useAdminSettings();
  
  const ringHandle = 'accessories';
  const ringTitle = settings?.ringCarousel?.title || 'ACCESSORIES';

  const heroVideoSrc = settingsLoading ? null : (settings?.hero?.video || config.heroVideoUrl);
  const heroImageSrc = settings?.hero?.image || null;

  const latestCurationTitle = settings?.latestCuration?.title ?? null;
  const latestCurationSubtitle = settings?.latestCuration?.subtitle ?? null;

  const [renderStage1, setRenderStage1] = useState(false);
  const [renderStage2, setRenderStage2] = useState(false);

  const { products, loading, isError, refetch } = useProducts(24);
  const { collections, refetch: refetchCollections } = useCollections(renderStage1 ? 20 : 0, 'page');
  const { products: accessories } = useCollectionByHandle(renderStage1 ? ringHandle : '');

  const homepageCollectionHandle = settings?.homepage?.collection ?? (settings as any)?.homepageCollection ?? null;
  const { products: homepageCollectionProducts } = useCollectionByHandle(
    renderStage1 && homepageCollectionHandle ? homepageCollectionHandle : ''
  );
  const rawHomepageProducts = settings?.homepage?.products ?? (settings as any)?.homepageProducts ?? null;

  const specifiedHomepageIds = useMemo(() => {
    if (!rawHomepageProducts) return [];
    if (Array.isArray(rawHomepageProducts)) return rawHomepageProducts.map(id => String(id).trim()).filter(Boolean);
    if (typeof rawHomepageProducts === 'string') return rawHomepageProducts.split(',').map(id => id.trim()).filter(Boolean);
    return [];
  }, [rawHomepageProducts]);

  const displayHomepageProducts = useMemo(() => {
    const pool = (homepageCollectionProducts && homepageCollectionProducts.length > 0)
      ? homepageCollectionProducts
      : (products || []);

    if (specifiedHomepageIds.length > 0 && pool.length > 0) {
      const matched = specifiedHomepageIds
        .map((idOrHandle: string) => {
          const numericId = idOrHandle.replace(/^gid:\/\/shopify\/Product\//i, '');
          return pool.find((p: FlatProduct) => {
            const pNumeric = p.id.replace(/^gid:\/\/shopify\/Product\//i, '');
            return p.id === idOrHandle || pNumeric === numericId || p.handle.toLowerCase() === idOrHandle.toLowerCase();
          });
        })
        .filter((p: FlatProduct | undefined): p is FlatProduct => Boolean(p));

      if (matched.length > 0) {
        const matchedSet = new Set(matched.map((m: FlatProduct) => m.id));
        const remaining = pool.filter((p: FlatProduct) => !matchedSet.has(p.id));
        return [...matched, ...remaining];
      }
    }

    return pool;
  }, [specifiedHomepageIds, homepageCollectionProducts, products]);

  const homeGrid1 = useMemo(() => displayHomepageProducts.slice(0, 4), [displayHomepageProducts]);
  const homeGrid2 = useMemo(() => displayHomepageProducts.slice(4, 8), [displayHomepageProducts]);
  const homeGrid3 = useMemo(() => displayHomepageProducts.slice(12, 16), [displayHomepageProducts]);
  const accessoriesItems = useMemo(() => (accessories || []).slice(0, Platform.OS === 'android' ? 8 : 15), [accessories]);

  const [refreshing, setRefreshing] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<FlatProduct | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  // Video player orchestration
  const [activeSlot, setActiveSlot] = useState<VideoSlot>('hero');
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (heroImageSrc) {
      Image.prefetch(heroImageSrc).catch(() => {});
    }
  }, [heroImageSrc]);

  useEffect(() => {
    let cancelled = false;
    const t1 = setTimeout(() => {
      if (!cancelled) setRenderStage1(true);
    }, Platform.OS === 'android' ? 450 : 250);

    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      setRenderStage2(true);
    });

    const t2 = setTimeout(() => {
      if (!cancelled) setRenderStage2(true);
    }, Platform.OS === 'android' ? 1200 : 700);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      task.cancel();
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchCollections()]);
    setRefreshing(false);
  }, [refetch, refetchCollections]);

  const scrollY = useSharedValue(0);
  const isTabBarVisibleShared = useSharedValue(true);
  const lastScrollYShared = useSharedValue(0);
  const setTabBarVisible = useUIStore(s => s.setTabBarVisible);

  const settleScroll = useCallback((y: number) => {
    setActiveSlot((prev) => {
      const next = pickActiveSlot(y);
      return prev === next ? prev : next;
    });
  }, []);

  const scheduleSettle = useCallback((y: number) => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    // Debounce player allocation so scrolling is never interrupted by heavy MediaCodec initialization
    scrollEndTimer.current = setTimeout(() => settleScroll(y), Platform.OS === 'android' ? 250 : 150);
  }, [settleScroll]);

  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scheduleSettle(e.nativeEvent.contentOffset.y);
  }, [scheduleSettle]);

  // Zero bridge crossing per frame — only triggers on state flip with hysteresis
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const currentY = event.contentOffset.y;
      scrollY.value = currentY;
      const diff = currentY - lastScrollYShared.value;

      if (diff > 20 && currentY > 150) {
        if (isTabBarVisibleShared.value) {
          isTabBarVisibleShared.value = false;
          runOnJS(setTabBarVisible)(false);
        }
      } else if (diff < -20 || currentY < 40) {
        if (!isTabBarVisibleShared.value) {
          isTabBarVisibleShared.value = true;
          runOnJS(setTabBarVisible)(true);
        }
      }
      lastScrollYShared.value = currentY;
    },
  });

  const handleQuickAdd = useCallback((product: FlatProduct) => {
    setSelectedProduct(product);
    setModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => setModalVisible(false), []);
  const handleCloseMenu = useCallback(() => setMenuVisible(false), []);
  const handleOpenMenu = useCallback(() => setMenuVisible(true), []);
  const handleNavigateShop = useCallback(() => navigation.navigate('ShopTab'), [navigation]);

  const [isHeroMuted, setIsHeroMuted] = useState(true);

  const toggleHeroMute = useCallback(() => {
    setIsHeroMuted(prev => !prev);
    haptics.buttonTap();
  }, []);

  const isVideoActive = useCallback((slot: VideoSlot) => activeSlot === slot, [activeSlot]);

  const collectionsVideoSrc = settings?.media?.collections;
  const featuredVideoSrc = settings?.media?.featured;
  const blueprintImageSrc = settings?.blueprint?.image || settings?.media?.featuredImage;
  const optimizedBlueprintImage = useMemo(
    () => blueprintImageSrc ? getOptimizedImageUrl(blueprintImageSrc, 800) : null,
    [blueprintImageSrc]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader 
        onPressMenu={handleOpenMenu}
        onPressCenter={toggleHeroMute}
      />
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS === 'android'}
        overScrollMode="never"
        nestedScrollEnabled={true}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor={colors.textExtraLight}
          />
        }
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onScrollEndDrag={onScrollEnd}
        onMomentumScrollEnd={onScrollEnd}
      >
        {isError && (
          <View style={[styles.errorBanner, { backgroundColor: isDark ? 'rgba(255, 59, 48, 0.1)' : 'rgba(255, 59, 48, 0.05)', borderColor: colors.error + '40', borderWidth: 1 }]}>
            <Ionicons name="warning-outline" size={16} color={colors.error} />
            <Typography size={8} color={colors.text} weight="500" style={{ marginLeft: 8 }}>
              Unable to load products. Pull down to refresh.
            </Typography>
          </View>
        )}

        {/* ──═ HERO VIDEO / IMAGE ═══ */}
        {(heroVideoSrc || heroImageSrc) ? (
          <View style={{ position: 'relative' }}>
            <HeroVideo 
              key={heroVideoSrc || 'hero'}
              source={heroVideoSrc} 
              isMuted={isHeroMuted}
              onToggleMute={toggleHeroMute}
              imageFallback={heroImageSrc}
              active={isVideoActive('hero')}
            />
          </View>
        ) : null}

        {/* ═══ CONTENT BELOW HERO ═══ */}
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          {loading && products.length === 0 && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.textExtraLight} />
            </View>
          )}

          {/* ═══ SECTION LABEL: Latest ═══ */}
          {(settings?.latestCuration?.show !== false && products && products.length > 0) && (
            <>
              {(latestCurationTitle || latestCurationSubtitle) && (
              <View style={styles.sectionHeader}>
                <View style={styles.headerLeft}>
                  {latestCurationSubtitle ? <Typography size={6} color={colors.textExtraLight} weight="300" style={styles.sectionTag}>{latestCurationSubtitle}</Typography> : null}
                  {latestCurationTitle ? <Typography size={8} color={colors.text} weight="700" style={styles.sectionTitle}>{latestCurationTitle}</Typography> : null}
                </View>
                <TouchableOpacity onPress={handleNavigateShop} style={styles.headerRight}>
                  <Typography size={7} color={colors.textExtraLight} weight="400">VIEW ALL</Typography>
                </TouchableOpacity>
              </View>
              )}
              
              {/* ═══ PRODUCT GRID 1 ═══ */}
              <ProductGrid items={homeGrid1} onQuickAdd={handleQuickAdd} />
            </>
          )}

          {/* ═══ STAGE 1: CAROUSELS ═══ */}
          {renderStage1 && (
            <>
              {/* ═══ ARCHIVE SECTION ═══ */}
              {settings?.archive?.show !== false && (
                <>
                  {collectionsVideoSrc && (
                    <View style={styles.mediaSection}>
                       <HeroVideo 
                         key={collectionsVideoSrc} 
                         source={collectionsVideoSrc} 
                         height={200} 
                         borderRadius={12} 
                         active={isVideoActive('collections')}
                       />
                    </View>
                  )}

                  <View style={styles.collectionsSection}>
                    {settings?.archive?.title ? (
                    <View style={styles.archiveLabel}>
                      <Typography size={7.5} color={colors.textExtraLight} weight="300" style={styles.archiveLabelText}>— {settings.archive.title} —</Typography>
                    </View>
                    ) : null}

                    <CollectionCarousel collections={collections} />

                    {settings?.archive?.subtitle ? (
                    <View style={styles.archiveLabel}>
                      <Typography size={7} color={colors.textExtraLight} weight="300" style={styles.archiveSubtext}>{settings.archive.subtitle}</Typography>
                    </View>
                    ) : null}
                  </View>
                </>
              )}

              {/* ═══ RING COLLECTION CAROUSEL ═══ */}
              {settings?.ringCarousel?.show !== false && (
                 <RingCarouselSection 
                  title={ringTitle} 
                  handle={ringHandle}
                  products={accessoriesItems} 
                />
              )}
            </>
          )}

          {/* ═══ STAGE 2: HEAVY LOWER SECTIONS ═══ */}
          {renderStage2 && (
            <>
              {/* ═══ FLIPBOOK SECTION ═══ */}
              <FlipbookSection 
                imgUrl={settings?.flipbook?.image ?? null}
                videoUrl={settings?.flipbook?.video ?? null}
                tag={settings?.flipbook?.tag ?? null}
                title={settings?.flipbook?.title ?? null}
                desc={settings?.flipbook?.desc ?? null}
                scrollY={Platform.OS === 'android' ? undefined : scrollY}
                active={isVideoActive('flipbook')}
              />

              {/* ═══ PRODUCT GRID 2 ═══ */}
              <ProductGrid items={homeGrid2} onQuickAdd={handleQuickAdd} />

              {/* ═══ FEATURED MEDIA / BLUEPRINT ═══ */}
              {(settings?.blueprint?.show !== false && (featuredVideoSrc || blueprintImageSrc)) ? (
                <View style={styles.blueprintSection}>
                  {featuredVideoSrc ? (
                   <HeroVideo 
                     key={featuredVideoSrc} 
                     source={featuredVideoSrc} 
                     height={520} 
                     borderRadius={0} 
                     imageFallback={blueprintImageSrc}
                     active={isVideoActive('featured')}
                   />
                  ) : (
                   <Image 
                    source={optimizedBlueprintImage ? { uri: optimizedBlueprintImage } : require('../../assets/load-image-4.jpg')} 
                    style={styles.blueprintImage} 
                    contentFit="cover" 
                    cachePolicy="memory-disk"
                    recyclingKey={optimizedBlueprintImage || 'blueprint-default'}
                    transition={0}
                  />
                  )}
                    <View style={styles.blueprintOverlay}>
                      {settings?.blueprint?.subtitle ? (
                      <Typography size={8} weight="700" color="rgba(255,255,255,0.6)" style={styles.blueprintOverlaySubtitle}>
                        {settings.blueprint.subtitle.toUpperCase()}
                      </Typography>
                      ) : null}
                      {settings?.blueprint?.title ? (
                      <Typography size={22} weight="800" color="#fff" style={styles.blueprintOverlayTitle}>
                        {settings.blueprint.title.toUpperCase()}
                      </Typography>
                      ) : null}
                    </View>
                </View>
              ) : null}

              {/* ═══ SPOTLIGHT SECTION ═══ */}
              <SpotlightSection 
                collectionHandle={settings?.spotlight?.collection ?? undefined} 
                title={settings?.spotlight?.title ?? undefined} 
                subtitle={settings?.spotlight?.subtitle ?? undefined}
                media={settings?.spotlight?.media}
                productIds={settings?.spotlight?.products ?? (settings as any)?.spotlightProducts ?? undefined}
                products={displayHomepageProducts}
                mediaActive={isVideoActive('spotlight')}
              />

              {/* ═══ PRODUCT GRID 3 ═══ */}
              {displayHomepageProducts.length > 12 && (
                <ProductGrid items={homeGrid3} onQuickAdd={handleQuickAdd} />
              )}

              {/* ═══ COMMUNITY SECTION ═══ */}
              <CommunitySection community={settings?.community} />

              {/* ═══ GLOBAL STOREFRONT FOOTER ═══ */}
              <StorefrontFooter mediaActive={isVideoActive('footer')} />
            </>
          )}
        </View>

        {/* Bottom padding for tab bar */}
        <View style={{ height: 120 + insets.bottom }} />
      </Animated.ScrollView>

      {/* Drawers */}
      <MenuDrawer 
        visible={menuVisible} 
        onClose={handleCloseMenu} 
      />
      {/* Quick Add Modal */}
      <QuickAddModal 
        visible={modalVisible}
        product={selectedProduct}
        onClose={handleCloseModal}
      />
    </View>
  );
});

export default HomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    paddingVertical: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 0,
    borderRadius: 8,
  },
  content: {
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    marginTop: 0,
    width: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 12,
  },
  headerLeft: {
    gap: 2,
  },
  sectionTag: {
    letterSpacing: 4,
    opacity: 0.35,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    letterSpacing: 2,
    textTransform: 'uppercase',
    opacity: 0.75,
  },
  headerRight: {
    paddingBottom: 2,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    marginBottom: 32,
  },
  gridItem: {
    width: Math.floor(width / 2),
    marginBottom: 0,
    backgroundColor: 'transparent',
  },
  collectionsSection: {
    paddingVertical: 24,
  },
  archiveLabel: {
    alignItems: 'center',
    marginBottom: 24,
  },
  archiveLabelText: {
    letterSpacing: 8,
    opacity: 0.22,
  },
  archiveSubtext: {
    fontSize: 7.5,
    fontWeight: '300',
    textTransform: 'uppercase',
    letterSpacing: 5,
    opacity: 0.6,
  },
  mediaSection: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  blueprintSection: {
    marginVertical: 32,
    paddingHorizontal: 0,
    position: 'relative',
  },
  blueprintImage: {
    width: '100%',
    height: 460,
    borderRadius: 0,
  },
  blueprintOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: 36,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  blueprintOverlaySubtitle: {
    letterSpacing: 3,
    marginBottom: 4,
    textAlign: 'left',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  blueprintOverlayTitle: {
    letterSpacing: 1.5,
    lineHeight: 26,
    textAlign: 'left',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});
