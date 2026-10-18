import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Image } from 'expo-image';
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

const RingCarouselSection = React.memo(({ title = "ACCESSORIES", handle = "accessories", products }: Props) => {
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';

  const validProducts = (products || []).filter(p => p && (p.id || p.handle));

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
            onPress={() => navigation.navigate('Collection', { handle })}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Typography size={6.5} color={colors.textExtraLight} weight="400">VIEW ALL</Typography>
          </TouchableOpacity>
        </View>

        {/* Horizontal Scroll */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          snapToInterval={126} // Item width 110 + Gap 16
          decelerationRate="fast"
        >
          {validProducts.map((item, idx) => {
            const rawImg = item.featuredImage || (item as any).image || (item.images && item.images[0]);
            const imageUri = resolveImageUrl(rawImg);

            return (
              <TouchableOpacity 
                key={item.id || item.handle || `ring-${idx}`}
                style={[
                  styles.itemContainer,
                  { 
                    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F5F5F7',
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                  }
                ]}
                onPress={() => navigation.navigate('ProductDetail', { handle: item.handle })}
                activeOpacity={0.8}
              >
                {imageUri ? (
                  <OptimizedImage 
                    source={imageUri} 
                    style={styles.image}
                    shopifyWidth={300}
                    contentFit="contain"
                  />
                ) : (
                  <View style={styles.imagePlaceholder} />
                )}
              </TouchableOpacity>
            );
          })}
          <View style={{ width: 10 }} />
        </ScrollView>
      </View>
    </View>
  );
});


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
      android: {
        // No Android elevation on container to avoid polygon shadow artifacts
      },
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
    paddingHorizontal: 20,
    gap: 16,
  },
  itemContainer: {
    width: 110,
    height: 110,
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

export default RingCarouselSection;
