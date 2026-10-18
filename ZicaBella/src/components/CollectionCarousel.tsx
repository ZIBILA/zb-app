import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import Animated, { 
  SharedValue,
  useSharedValue, 
  useAnimatedStyle, 
  useAnimatedScrollHandler, 
  interpolate, 
  Extrapolation 
} from 'react-native-reanimated';
import { FlatCollection } from '../api/types';
import { Typography } from './Typography';
import { resolveImageUrl } from '../utils/imageUtils';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.72;
const CARD_HEIGHT = CARD_WIDTH * 1.35;
const OVERLAP_FACTOR = 0.55; 
const ITEM_WIDTH = CARD_WIDTH * OVERLAP_FACTOR;

interface Props {
  collections: FlatCollection[];
}

const REPEAT_COUNT = 30;
const AnimatedFlatList = Animated.FlatList as any;

/**
 * Standalone CellRendererComponent — extracted outside the parent to avoid
 * the hooks-inside-useCallback violation that crashes Android.
 * React hooks (useAnimatedStyle) must only be called at the top level of a
 * component function, never inside callbacks or conditionals.
 */
function CarouselCellRenderer({ children, index, style, scrollX, ...props }: any) {
  const animatedStyle = useAnimatedStyle(() => {
    const input = [
      (index - 1) * ITEM_WIDTH,
      index * ITEM_WIDTH,
      (index + 1) * ITEM_WIDTH,
    ];
    const zIndex = interpolate(
      scrollX.value,
      input,
      [1, 10000, 1],
      Extrapolation.CLAMP
    );
    return {
      zIndex: Math.floor(zIndex),
      elevation: Math.floor(zIndex / 100), 
    } as any;
  });

  return (
    <Animated.View {...props} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

export default function CollectionCarousel({ collections }: Props) {
  const navigation = useNavigation<any>();
  const scrollX = useSharedValue(0);

  const loopData = useMemo(() => {
    if (!collections) return [];
    return Array(REPEAT_COUNT).fill(collections).flat();
  }, [collections]);

  const initialIndex = collections ? Math.floor(REPEAT_COUNT / 2) * collections.length : 0;

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const renderItem = useCallback(({ item, index }: { item: FlatCollection; index: number }) => {
    return (
      <AnimatedCard 
        item={item} 
        index={index} 
        scrollX={scrollX} 
        onPress={() => navigation.navigate('Collection', { handle: item.handle })}
      />
    );
  }, [navigation, scrollX]);

  // Stable wrapper that injects scrollX into the standalone cell renderer
  const CellRenderer = useCallback((props: any) => {
    return <CarouselCellRenderer {...props} scrollX={scrollX} />;
  }, [scrollX]);

  if (!collections || collections.length === 0) return null;

  return (
    <View style={styles.container}>
      <AnimatedFlatList
        id="CollectionFlatList"
        data={loopData}
        renderItem={renderItem}
        CellRendererComponent={CellRenderer}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={ITEM_WIDTH}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: (width - ITEM_WIDTH) / 2,
          paddingVertical: 60, // Extra space for deep shadows
        }}
        getItemLayout={(_: any, index: number) => ({
          length: ITEM_WIDTH,
          offset: ITEM_WIDTH * index,
          index,
        })}
        initialScrollIndex={initialIndex}
        removeClippedSubviews={false}
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={50}
        windowSize={3}
        keyExtractor={(_item: any, index: number) => `carousel-${index}`}
      />
    </View>
  );
}

function AnimatedCard({ item, index, scrollX, onPress }: any) {
  const animatedStyle = useAnimatedStyle(() => {
    const input = [
      (index - 1) * ITEM_WIDTH,
      index * ITEM_WIDTH,
      (index + 1) * ITEM_WIDTH,
    ];

    const scale = interpolate(
      scrollX.value,
      input,
      [0.72, 1, 0.72],
      Extrapolation.CLAMP
    );

    const rotateY = interpolate(
      scrollX.value,
      input,
      [45, 0, -45],
      Extrapolation.CLAMP
    );

    const translateX = interpolate(
      scrollX.value,
      input,
      [ITEM_WIDTH * 0.2, 0, -ITEM_WIDTH * 0.2],
      Extrapolation.CLAMP
    );

    return {
      transform: [
        { perspective: 1500 },
        { scale },
        { rotateY: `${rotateY}deg` },
        { translateX }
      ],
    } as any;
  });

  const overlayStyle = useAnimatedStyle(() => {
    const input = [
      (index - 1) * ITEM_WIDTH,
      index * ITEM_WIDTH,
      (index + 1) * ITEM_WIDTH,
    ];
    const opacity = interpolate(
      scrollX.value,
      input,
      [0.55, 0, 0.55],
      Extrapolation.CLAMP
    );
    return { opacity } as any;
  });

  return (
    <Animated.View style={[styles.cardContainer, animatedStyle]}>
      <TouchableOpacity 
        activeOpacity={0.9} 
        onPress={onPress} 
        style={styles.card}
      >
        <Image
          source={{ uri: resolveImageUrl(item.image) || undefined }}
          style={styles.image}
          contentFit="cover"
          transition={500}
          placeholder={require('../../assets/load-image-2.jpg')}
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
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    marginTop: -20,
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
    borderRadius: 55, // Super rounded "Apple" look
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 40 },
    shadowOpacity: 0.6,
    shadowRadius: 50,
    elevation: 30,
  },
  glassBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 55,
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
    bottom: 40,
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
