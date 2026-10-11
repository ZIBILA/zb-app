import React, { useCallback, useState, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, Dimensions,
  RefreshControl, TouchableOpacity, ActivityIndicator,
  InteractionManager
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
import { useAdminSettings, useFeaturedUsers } from '../hooks/useAdminFeatures';
import { useUIStore } from '../store/uiStore';
import { Typography } from '../components/Typography';
import StorefrontFooter from '../components/StorefrontFooter';

const { width } = Dimensions.get('window');

const HomeScreen = React.memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore((state) => state.theme);
  const isDark = theme === 'dark';

  const { settings, loading: settingsLoading } = useAdminSettings();
  const { users: communityUsers } = useFeaturedUsers(); // Pre-fetch community data early
  
  // Ring carousel reads from admin settings instead of hardcoded values
  const ringHandle = 'accessories';
  const ringTitle = settings?.ringCarousel?.title || 'ACCESSORIES';

  const heroVideoSrc = settingsLoading ? null : (settings?.hero?.video || config.heroVideoUrl);
  const heroImageSrc = settings?.hero?.image;
  // Use exact admin values — null/empty = show nothing
  const heroTitle = settings?.hero?.title ?? null;
  const heroSubtitle = settings?.hero?.subtitle ?? null;
  const showHeroText = settings?.hero?.showText ?? true;

  const latestCurationTitle = settings?.latestCuration?.title ?? null;
  const latestCurationSubtitle = settings?.latestCuration?.subtitle ?? null;

  const { products, loading, error, isError, refetch } = useProducts(24);
  const { collections, refetch: refetchCollections } = useCollections(20, 'page');
  const { products: accessories } = useCollectionByHandle(ringHandle);

  const homepageCollectionHandle = settings?.homepage?.collection ?? (settings as any)?.homepageCollection ?? null;
  const { products: homepageCollectionProducts } = useCollectionByHandle(homepageCollectionHandle ?? "");
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

  const [refreshing, setRefreshing] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<FlatProduct | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [renderBelowFold, setRenderBelowFold] = useState(false);

  React.useEffect(() => {
    // Delay rendering heavy sections below the fold to avoid locking the UI thread and overheating on launch
    let isCancelled = false;
    
    const task = InteractionManager.runAfterInteractions(() => {
      if (isCancelled) return;
      setRenderBelowFold(true);
      
      // Cache warm-up: Prefetch top 2 collections silently
      if (collections && collections.length > 0) {
        const topHandles = collections.slice(0, 2).map(c => c.handle);
        const { apiGet } = require('../api/shopify');
        const { ENDPOINTS } = require('../api/queries');
        
        topHandles.forEach(handle => {
          apiGet(ENDPOINTS.collectionByHandle(handle), { limit: '50', fields: 'id,title,handle,priceRange,featuredImage' }).catch(() => {});
        });
      }
    });

    // Safety fallback: Ensure below-fold content renders after 1.5s regardless of interactions
    const safetyTimer = setTimeout(() => {
      if (!isCancelled) setRenderBelowFold(true);
    }, 1500);

    return () => {
      isCancelled = true;
      task.cancel();
      clearTimeout(safetyTimer);
    };
  }, [collections]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchCollections()]);
    setRefreshing(false);
  }, [refetch, refetchCollections]);

  const scrollY = useSharedValue(0);
  const lastScrollY = useRef(0);
  const setTabBarVisible = useUIStore(s => s.setTabBarVisible);

  const updateTabBar = (currentY: number) => {
    const diff = currentY - lastScrollY.current;
    if (Math.abs(diff) > 10) {
      const isVisible = useUIStore.getState().isTabBarVisible;
      if (diff > 0 && currentY > 120) {
        if (isVisible) setTabBarVisible(false);
      } else if (diff < -10 || currentY < 50) {
        if (!isVisible) setTabBarVisible(true);
      }
      lastScrollY.current = currentY;
    }
  };

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      runOnJS(updateTabBar)(event.contentOffset.y);
    },
  });

  const handleQuickAdd = useCallback((product: FlatProduct) => {
    setSelectedProduct(product);
    setModalVisible(true);
  }, []);

  const renderProductGrid = (items: FlatProduct[]) => {
    if (!items || items.length === 0) return null;
    return (
      <View style={styles.gridContainer}>
        {items.map((product) => (
          <View key={product.id} style={styles.gridItem}>
            <ProductCard 
              product={product} 
              onQuickAdd={handleQuickAdd}
            />
          </View>
        ))}
      </View>
    );
  };

  const [isHeroMuted, setIsHeroMuted] = useState(true);

  const toggleHeroMute = useCallback(() => {
    setIsHeroMuted(prev => !prev);
    haptics.buttonTap();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader 
        onPressMenu={() => setMenuVisible(true)}
        onPressCenter={toggleHeroMute}
      />
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor={colors.textExtraLight}
          />
        }
        onScroll={scrollHandler}
        scrollEventThrottle={16}
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
              key={heroVideoSrc || heroImageSrc || 'hero-loading'}
              source={heroVideoSrc} 
              isMuted={isHeroMuted}
              onToggleMute={toggleHeroMute}
              imageFallback={heroImageSrc}
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
                <TouchableOpacity onPress={() => navigation.navigate('ShopTab')} style={styles.headerRight}>
                  <Typography size={7} color={colors.textExtraLight} weight="400">VIEW ALL</Typography>
                </TouchableOpacity>
              </View>
              )}
              
              {/* ═══ PRODUCT GRID 1 ═══ */}
              {renderProductGrid(displayHomepageProducts.slice(0, 4))}
            </>
          )}

          {renderBelowFold && (
            <>
              {/* ═══ ARCHIVE SECTION ═══ */}
              {settings?.archive?.show !== false && (
                <>
                  {settings?.media?.collections && (
                    <View style={styles.mediaSection}>
                       <HeroVideo key={settings.media.collections} source={settings.media.collections} height={200} borderRadius={12} />
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
                  products={(accessories || []).slice(0, 15)} 
                />
              )}

              {/* ═══ FLIPBOOK SECTION ═══ */}
              <FlipbookSection scrollY={scrollY} />

              {/* ═══ PRODUCT GRID 2 ═══ */}
              {renderProductGrid(displayHomepageProducts.slice(4, 8))}

              {/* ═══ FEATURED MEDIA / BLUEPRINT ═══ */}
              {(settings?.blueprint?.show !== false && (settings?.media?.featured || settings?.blueprint?.image)) ? (
                <View style={styles.blueprintSection}>
                  {settings?.media?.featured ? (
                   <HeroVideo key={settings.media.featured} source={settings.media.featured} height={520} borderRadius={0} />
                  ) : (
                   <Image 
                    source={settings?.blueprint?.image ? { uri: settings.blueprint.image } : require('../../assets/load-image-4.jpg')} 
                    style={styles.blueprintImage} 
                    contentFit="cover" 
                    placeholder={require('../../assets/load-image-4.jpg')}
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
              />

              {/* ═══ PRODUCT GRID 3 ═══ */}
              {displayHomepageProducts.length > 12 && renderProductGrid(displayHomepageProducts.slice(12, 16))}

              {/* ═══ COMMUNITY SECTION ═══ */}
              <CommunitySection community={settings?.community} />

              {/* ═══ GLOBAL STOREFRONT FOOTER ═══ */}
              <StorefrontFooter />
            </>
          )}
        </View>

        {/* Bottom padding for tab bar */}
        <View style={{ height: 120 + insets.bottom }} />
      </Animated.ScrollView>

      {/* Drawers */}
      <MenuDrawer 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)} 
      />
      {/* Quick Add Modal */}
      <QuickAddModal 
        visible={modalVisible}
        product={selectedProduct}
        onClose={() => setModalVisible(false)}
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
  errorContainer: {
    paddingVertical: 100,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 1,
    lineHeight: 16,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 2,
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
  footerVideoSection: {
    marginTop: 48,
    paddingHorizontal: 16,
  },
});

