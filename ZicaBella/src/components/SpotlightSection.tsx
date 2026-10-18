import React from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { useCollectionByHandle, useProducts } from '../hooks/useProducts';
import { useColors } from '../constants/colors';
import { useAdminSettings } from '../hooks/useAdminFeatures';
import { Typography } from './Typography';
import { useThemeStore } from '../store/themeStore';
import HeroVideo from './HeroVideo';
import OptimizedImage from './OptimizedImage';
import { FlatProduct } from '../api/types';

const { width } = Dimensions.get('window');
const GRID_PADDING = 12;
const GRID_SPACING = 8;
const ITEM_WIDTH = (width - (GRID_PADDING * 2) - (GRID_SPACING * 2)) / 3;

interface Props {
  title?: string;
  subtitle?: string;
  collectionHandle?: string;
  media?: string;
  productIds?: string | string[];
}

const SpotlightSection = React.memo(({ 
  title,
  subtitle,
  collectionHandle,
  media,
  productIds
}: Props) => {
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';
  const { settings } = useAdminSettings();

  // Use exact admin values — no hardcoded fallback defaults
  const resolvedTitle = title ?? settings?.spotlight?.title ?? null;
  const resolvedSubtitle = subtitle ?? settings?.spotlight?.subtitle ?? null;
  const resolvedCollectionHandle = collectionHandle ?? settings?.spotlight?.collection ?? null;
  const resolvedMedia = media ?? settings?.media?.featured ?? null;

  const rawProductsSetting = productIds ?? settings?.spotlight?.products ?? (settings as any)?.spotlightProducts ?? null;

  const specifiedIds = React.useMemo(() => {
    if (!rawProductsSetting) return [];
    if (Array.isArray(rawProductsSetting)) {
      return rawProductsSetting.map(id => String(id).trim()).filter(Boolean);
    }
    if (typeof rawProductsSetting === 'string') {
      return rawProductsSetting.split(',').map(id => id.trim()).filter(Boolean);
    }
    return [];
  }, [rawProductsSetting]);

  const { products: collectionProducts, loading: collectionLoading } = useCollectionByHandle(resolvedCollectionHandle ?? "");
  const { products: catalogProducts, loading: catalogLoading } = useProducts(50);

  const displayProducts = React.useMemo(() => {
    const availablePool = (catalogProducts && catalogProducts.length > 0)
      ? catalogProducts
      : (collectionProducts || []);

    if (specifiedIds.length > 0 && availablePool.length > 0) {
      const matched = specifiedIds
        .map(idOrHandle => {
          const numericId = idOrHandle.replace(/^gid:\/\/shopify\/Product\//i, '');
          return availablePool.find(p => {
            const pNumeric = p.id.replace(/^gid:\/\/shopify\/Product\//i, '');
            return p.id === idOrHandle || pNumeric === numericId || p.handle.toLowerCase() === idOrHandle.toLowerCase();
          });
        })
        .filter((p): p is FlatProduct => Boolean(p));

      if (matched.length > 0) {
        return matched.slice(0, 6);
      }
    }

    return (collectionProducts || []).slice(0, 6);
  }, [specifiedIds, catalogProducts, collectionProducts]);

  const loading = collectionLoading || (specifiedIds.length > 0 && catalogLoading);

  if (loading && displayProducts.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.skeletonHeader} />
        <View style={styles.grid}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonItem} />
          ))}
        </View>
      </View>
    );
  }

  // Guard: if content is empty or not ready, return null to avoid blank gap
  if (displayProducts.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Optional Media Background Section */}
      {resolvedMedia && (
        <View style={styles.mediaBackground}>
          <HeroVideo source={resolvedMedia} height={400} borderRadius={0} isMuted />
          <View style={[styles.mediaOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.2)' }]} />
        </View>
      )}

      {/* Centered Header */}
      {(resolvedTitle || resolvedSubtitle) ? (
      <View style={[styles.header, resolvedMedia ? styles.headerWithMedia : null]}>
        {resolvedTitle ? (
        <Typography 
          size={28} 
          color={resolvedMedia ? "#fff" : colors.text} 
          rocaston 
          style={styles.title}
        >
          {resolvedTitle.toUpperCase()}
        </Typography>
        ) : null}
        {resolvedSubtitle ? (
        <Typography 
          size={7.5} 
          color={resolvedMedia ? "rgba(255,255,255,0.7)" : colors.textExtraLight} 
          weight="400" 
          style={styles.subtitle} 
          numberOfLines={3}
        >
          {resolvedSubtitle.toUpperCase()}
        </Typography>
        ) : null}
      </View>
      ) : null}

      {/* Grid - 3 columns, Minimalist style */}
      <View style={styles.grid}>
        {(displayProducts.length > 0 ? displayProducts : Array(3).fill(null)).map((product, idx) => (
          <TouchableOpacity 
            key={product?.id || idx}
            style={styles.item}
            onPress={() => product && navigation.navigate('ProductDetail', { handle: product.handle })}
            activeOpacity={0.8}
          >
            <View style={[
              styles.imageContainer, 
              { 
                backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'
              }
            ]}>
              {product ? (
                <OptimizedImage 
                  source={product.featuredImage} 
                  style={styles.image}
                  shopifyWidth={400}
                />
              ) : (
                <OptimizedImage 
                  source={require('../../assets/load-image-4.jpg')} 
                  style={styles.image}
                />
              )}
            </View>
            <View style={styles.itemInfo}>
              <Typography size={6.5} weight="800" color={colors.textLight} numberOfLines={1} style={styles.itemTitle}>
                {(product?.title || "ZICA BELLA").toUpperCase()}
              </Typography>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
});

export default SpotlightSection;

const styles = StyleSheet.create({
  container: {
    marginVertical: 40,
    width: '100%',
  },
  mediaBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 400,
    zIndex: -1,
  },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    paddingHorizontal: 24,
  },
  headerWithMedia: {
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    letterSpacing: 3,
    marginBottom: 14,
    textAlign: 'center',
    lineHeight: 32,
  },
  subtitle: {
    letterSpacing: 2.5,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 15,
    opacity: 0.8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PADDING,
    justifyContent: 'space-between',
  },
  item: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    marginBottom: 24,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 3 / 4.4,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 0.5,
    marginBottom: 10,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  emptyImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    width: '100%',
    alignItems: 'center',
    gap: 2,
  },
  itemTitle: {
    letterSpacing: 0.8,
    opacity: 0.6,
    textAlign: 'center',
  },
  skeletonHeader: {
    height: 40,
    width: 200,
    backgroundColor: 'rgba(0,0,0,0.03)',
    alignSelf: 'center',
    marginBottom: 30,
    borderRadius: 8,
  },
  skeletonItem: {
    width: ITEM_WIDTH,
    aspectRatio: 3 / 4.4,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 8,
  },
});
