import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform, FlatList } from 'react-native';
import { GlassBackdrop } from './GlassView';
import { useNavigation } from '@react-navigation/native';
import { FlatProduct } from '../api/types';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { Typography } from './Typography';
import OptimizedImage from './OptimizedImage';
import { resolveImageUrl } from '../utils/imageUtils';

interface Props {
  title?: string;
  handle?: string;
  products: FlatProduct[];
}

const ITEM_SIZE = 110;
const ITEM_GAP = 16;
const SNAP_INTERVAL = ITEM_SIZE + ITEM_GAP;
const PADDING_HORIZONTAL = 20;

const RingItem = React.memo(function RingItem({ 
  item, 
  isDark, 
  onPress 
}: { 
  item: FlatProduct; 
  isDark: boolean; 
  onPress: () => void;
}) {
  const rawImg = item.featuredImage || (item as any).image || (item.images && item.images[0]);
  const imageUri = useMemo(() => resolveImageUrl(rawImg), [rawImg]);

  return (
    <TouchableOpacity 
      style={[
        styles.itemContainer,
        { 
          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F5F5F7',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
        }
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {imageUri ? (
        <OptimizedImage 
          source={imageUri} 
          style={styles.image}
          shopifyWidth={240}
          contentFit="contain"
          transition={60}
        />
      ) : (
        <View style={styles.imagePlaceholder} />
      )}
    </TouchableOpacity>
  );
});

const RingCarouselSection = React.memo(function RingCarouselSection({ 
  title = "ACCESSORIES", 
  handle = "accessories", 
  products 
}: Props) {
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';

  const validProducts = useMemo(() => {
    return (products || []).filter((p) => {
      if (!p || !(p.id || p.handle)) return false;
      const rawImg = p.featuredImage || (p as any).image || (p.images && p.images[0]);
      return Boolean(resolveImageUrl(rawImg));
    });
  }, [products]);

  const handleViewAll = useCallback(() => {
    navigation.navigate('Collection', { handle });
  }, [navigation, handle]);

  const renderItem = useCallback(({ item }: { item: FlatProduct }) => {
    return (
      <RingItem 
        item={item} 
        isDark={isDark} 
        onPress={() => navigation.navigate('ProductDetail', { handle: item.handle })}
      />
    );
  }, [navigation, isDark]);

  const keyExtractor = useCallback((item: FlatProduct, index: number) => {
    return item.id || item.handle || `ring-${index}`;
  }, []);

  if (validProducts.length === 0) return null;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.glassCard,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.85)',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        <GlassBackdrop intensity={isDark ? 48 : 88} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        
        {/* Header */}
        <View style={styles.header}>
          <Typography size={7.5} color={colors.text} weight="500" style={styles.title}>{title}</Typography>
          <TouchableOpacity 
            onPress={handleViewAll}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Typography size={6.5} color={colors.textExtraLight} weight="400">VIEW ALL</Typography>
          </TouchableOpacity>
        </View>

        {/* Horizontal FlatList */}
        <FlatList 
          horizontal 
          data={validProducts}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          snapToInterval={SNAP_INTERVAL}
          decelerationRate="fast"
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={5}
          // Nested in Home ScrollView — clipping blanks image cells on Android
          removeClippedSubviews={false}
          scrollEventThrottle={16}
        />
      </View>
    </View>
  );
});

export default RingCarouselSection;

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  glassCard: {
    borderRadius: 28,
    overflow: 'hidden',
    paddingVertical: 20,
    borderWidth: 0.5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
      },
      android: {},
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 8,
    fontWeight: '400',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  scrollContent: {
    paddingHorizontal: PADDING_HORIZONTAL,
    gap: ITEM_GAP,
  },
  itemContainer: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 0.5,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(150,150,150,0.05)',
  },
});
