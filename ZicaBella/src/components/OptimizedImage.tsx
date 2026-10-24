import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image, ImageProps } from 'expo-image';
import { getOptimizedImageUrl, resolveImageUrl } from '../utils/imageUtils';

interface OptimizedImageProps extends Omit<ImageProps, 'source' | 'placeholder'> {
  source: any;
  shopifyWidth?: number;
  /** Smaller/cached URI shown instantly while the main source decodes. */
  placeholderSource?: any;
  placeholderWidth?: number;
  priority?: 'low' | 'normal' | 'high';
  /** Show a spinner while the image has not loaded yet. Defaults to true. */
  showLoader?: boolean;
  loaderColor?: string;
  loaderSize?: 'small' | 'large';
}

export default function OptimizedImage({ 
  source, 
  style, 
  shopifyWidth,
  placeholderSource,
  placeholderWidth = 240,
  contentFit = 'cover',
  transition = 0,
  priority = 'normal',
  showLoader = true,
  loaderColor = 'rgba(0,0,0,0.28)',
  loaderSize = 'small',
  onLoad,
  onError,
  ...props 
}: OptimizedImageProps) {
  const finalSource = useMemo(() => {
    if (shopifyWidth) {
      return getOptimizedImageUrl(source, shopifyWidth) || resolveImageUrl(source);
    }
    return resolveImageUrl(source);
  }, [source, shopifyWidth]);

  // Only use an explicit placeholder — auto-using a smaller Shopify URL of the same
  // image causes the "tiny then sharp" flash on product hero cards.
  const placeholderUri = useMemo(() => {
    if (!placeholderSource) return undefined;
    return (
      getOptimizedImageUrl(placeholderSource, placeholderWidth) ||
      resolveImageUrl(placeholderSource) ||
      undefined
    );
  }, [placeholderSource, placeholderWidth]);

  const imageSource = finalSource ? { uri: finalSource } : undefined;
  const placeholder =
    placeholderUri && placeholderUri !== finalSource ? { uri: placeholderUri } : undefined;

  const [loading, setLoading] = useState(Boolean(imageSource));

  useEffect(() => {
    setLoading(Boolean(finalSource));
  }, [finalSource]);

  return (
    <View style={[styles.container, style]}>
      {imageSource ? (
        <Image
          source={imageSource}
          placeholder={placeholder}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={transition}
          priority={priority}
          cachePolicy="memory-disk"
          recyclingKey={finalSource}
          onLoad={(e) => {
            setLoading(false);
            onLoad?.(e);
          }}
          onError={(e) => {
            setLoading(false);
            onError?.(e);
          }}
          {...props}
        />
      ) : null}
      {/* Keep the loader mounted — remounting siblings under Fabric causes addViewAt crashes. */}
      {showLoader ? (
        <View
          style={[styles.loader, { opacity: loading ? 1 : 0 }]}
          pointerEvents="none"
          collapsable={false}
        >
          <ActivityIndicator size={loaderSize} color={loaderColor} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
