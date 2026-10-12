import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image, ImageProps } from 'expo-image';

interface OptimizedImageProps extends Omit<ImageProps, 'source'> {
  source: any;
  shopifyWidth?: number;
  priority?: 'low' | 'normal' | 'high';
}

const OptimizedImage = React.memo(function OptimizedImage({ 
  source, 
  style, 
  shopifyWidth,
  contentFit = 'cover',
  transition = 60,
  priority = 'normal',
  ...props 
}: OptimizedImageProps) {

  const finalSource = useMemo(() => {
    if (typeof source === 'string' && source.includes('cdn.shopify.com') && shopifyWidth) {
      const separator = source.includes('?') ? '&' : '?';
      return `${source}${separator}width=${shopifyWidth}&format=webp`;
    }
    return source;
  }, [source, shopifyWidth]);

  const imageSource = useMemo(() => {
    return typeof finalSource === 'string' ? { uri: finalSource } : finalSource;
  }, [finalSource]);

  const recyclingKey = useMemo(() => {
    return typeof finalSource === 'string' ? finalSource : undefined;
  }, [finalSource]);

  return (
    <View style={[styles.container, style]}>
      <Image
        source={imageSource}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        transition={transition}
        priority={priority}
        cachePolicy="memory-disk"
        recyclingKey={recyclingKey}
        {...props}
      />
    </View>
  );
});

export default OptimizedImage;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
});

