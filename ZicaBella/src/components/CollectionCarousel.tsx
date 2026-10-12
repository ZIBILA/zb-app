import React, { useMemo, useCallback, useContext, createContext } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  useAnimatedScrollHandler, 
  interpolate, 
  Extrapolation,
  SharedValue
} from 'react-native-reanimated';
import { FlatCollection } from '../api/types';
import { Typography } from './Typography';
import { getOptimizedImageUrl } from '../utils/imageUtils';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.72;
const CARD_HEIGHT = CARD_WIDTH * 1.35;
const OVERLAP_FACTOR = 0.58; 
const ITEM_WIDTH = CARD_WIDTH * OVERLAP_FACTOR;

interface Props {
  collections: FlatCollection[];
}

const REPEAT_COUNT = Platform.OS === 'android' ? 2 : 3;
const AnimatedFlatList = Animated.FlatList as any;

const CarouselScrollContext = createContext<SharedValue<number> | null>(null);

/**
 * Static CellRendererComponent:
 * Clean zIndex ordering without continuous per-pixel layout thrashing on Android.
 * Discrete threshold elevation ensures views only switch order when crossing center.
 */
const CarouselCellRenderer = React.memo(function CarouselCellRenderer({ children, index, style, ...props }: any) {
  const scrollX = useContext(CarouselScrollContext);

  const animatedStyle = useAnimatedStyle(() => {
    if (!scrollX) return {};
    const dist = Math.abs(scrollX.value - index * ITEM_WIDTH);
    // Discrete zIndex prevents continuous layout recomputation on Android RenderThread
    const isCenter = dist < ITEM_WIDTH * 0.5;
    return {
      zIndex: isCenter ? 10 : 1,
    };
  });

  return (
    <Animated.View {...props} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
});

const AnimatedCard = React.memo(function AnimatedCard({ item, index, onPress }: any) {
  const scrollX = useContext(CarouselScrollContext);

  const animatedStyle = useAnimatedStyle(() => {
    if (!scrollX) return {};
    const input = [
      (index - 1) * ITEM_WIDTH,
      index * ITEM_WIDTH,
      (index + 1) * ITEM_WIDTH,
    ];

    const scale = interpolate(
      scrollX.value,
      input,
      [0.84, 1, 0.84],
      Extrapolation.CLAMP
    );

    const translateX = interpolate(
      scrollX.value,
      input,
      [ITEM_WIDTH * 0.12, 0, -ITEM_WIDTH * 0.12],
      Extrapolation.CLAMP
    );

    // On Android: stick to pure 2D transforms (scale + translate) to keep RenderNode
    // on fast hardware execution without 3D camera projection overhead.
    if (Platform.OS === 'android') {
      return {
        transform: [{ scale }, { translateX }],
      } as any;
    }

    const rotateY = interpolate(
      scrollX.value,
      input,
      [16, 0, -16],
      Extrapolation.CLAMP
    );

    return {
      transform: [
        { perspective: 1200 },
        { scale },
        { rotateY: `${rotateY}deg` },
        { translateX }
      ],
    } as any;
  });

  const overlayStyle = useAnimatedStyle(() => {
    if (!scrollX) return {};
    const input = [
      (index - 1) * ITEM_WIDTH,
      index * ITEM_WIDTH,
      (index + 1) * ITEM_WIDTH,
    ];
    const opacity = interpolate(
      scrollX.value,
      input,
      [0.45, 0, 0.45],
      Extrapolation.CLAMP
    );
    return { opacity } as any;
  });

  // Downscale Shopify image to card width (600px WebP) to avoid decoding massive 4K bitmaps
  const imageUri = useMemo(() => getOptimizedImageUrl(item.image, 600) || undefined, [item.image]);

  return (
    <Animated.View 
      style={[styles.cardContainer, animatedStyle]}
      renderToHardwareTextureAndroid={true}
    >
      <TouchableOpacity 
        activeOpacity={0.9} 
        onPress={onPress} 
        style={styles.card}
      >
        <Image
          source={{ uri: imageUri }}
          style={styles.image}
          contentFit="cover"
          transition={80}
          cachePolicy="memory-disk"
          recyclingKey={imageUri}
          priority="normal"
        />
        <Animated.View style={[styles.depthOverlay, overlayStyle]} />
        
        <View style={styles.glassBorder} />

        <View style={styles.titleContainer}>
          <Typography 
            rocaston
            size={11} 
            color="#FFFFFF" 
            style={styles.title}
            numberOfLines={1}
          >
            {String(item?.title || '').toUpperCase()}
          </Typography>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

const CollectionCarousel = React.memo(function CollectionCarousel({ collections }: Props) {
  const navigation = useNavigation<any>();
  const scrollX = useSharedValue(0);

  const loopData = useMemo(() => {
    if (!collections || collections.length === 0) return [];
    return Array(REPEAT_COUNT).fill(collections).flat();
  }, [collections]);

  const initialIndex = useMemo(() => {
    if (!collections || collections.length === 0) return 0;
    return Math.floor(REPEAT_COUNT / 2) * collections.length;
  }, [collections]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      scrollX.value = event.contentOffset.x;
    },
  });

  const renderItem = useCallback(({ item, index }: { item: FlatCollection; index: number }) => {
    return (
      <AnimatedCard 
        item={item} 
        index={index} 
        onPress={() => navigation.navigate('Collection', { handle: item.handle })}
      />
    );
  }, [navigation]);

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ITEM_WIDTH,
    offset: ITEM_WIDTH * index,
    index,
  }), []);

  const keyExtractor = useCallback((_item: any, index: number) => `carousel-${index}`, []);

  const contentContainerStyle = useMemo(() => ({
    paddingHorizontal: (width - ITEM_WIDTH) / 2,
    paddingVertical: 32,
  }), []);

  if (!collections || collections.length === 0) return null;

  return (
    <CarouselScrollContext.Provider value={scrollX}>
      <View style={styles.container}>
        <AnimatedFlatList
          id="CollectionFlatList"
          data={loopData}
          renderItem={renderItem}
          CellRendererComponent={CarouselCellRenderer}
          horizontal
          nestedScrollEnabled={true}
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          snapToInterval={ITEM_WIDTH}
          decelerationRate="fast"
          contentContainerStyle={contentContainerStyle}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialIndex}
          onScrollToIndexFailed={() => {}}
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          keyExtractor={keyExtractor}
        />
      </View>
    </CarouselScrollContext.Provider>
  );
});

export default CollectionCarousel;

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    marginTop: -10,
  },
  cardContainer: {
    width: ITEM_WIDTH,
    height: CARD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#000',
    borderRadius: 36,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.45,
        shadowRadius: 24,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  glassBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  depthOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  titleContainer: {
    position: 'absolute',
    bottom: 32,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  title: {
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
});
