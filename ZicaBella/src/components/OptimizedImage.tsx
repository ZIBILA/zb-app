import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image, ImageProps } from 'expo-image';

interface OptimizedImageProps extends Omit<ImageProps, 'source'> {
  source: any;
  shopifyWidth?: number;
  priority?: 'low' | 'normal' | 'high';
}

export default function OptimizedImage({ 
  source, 
  style, 
  shopifyWidth,
  contentFit = 'cover',
  transition = 100,
  priority = 'normal',
  ...props 
}: OptimizedImageProps) {

  let finalSource = source;
  if (typeof source === 'string' && source.includes('cdn.shopify.com') && shopifyWidth) {
    const separator = source.includes('?') ? '&' : '?';
    finalSource = `${source}${separator}width=${shopifyWidth}&format=webp`;
  }

  const imageSource = typeof finalSource === 'string' ? { uri: finalSource } : finalSource;

  return (
    <View style={[styles.container, style]}>
      <Image
        source={imageSource}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        transition={transition}
        priority={priority}
        cachePolicy="memory-disk"
        recyclingKey={typeof finalSource === 'string' ? finalSource : undefined}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
});
