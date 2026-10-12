import React from 'react';
import { View, StyleSheet, Dimensions, Platform } from 'react-native';
import Animated, { useAnimatedStyle, interpolate, Extrapolation, SharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, VideoSource } from 'expo-video';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../constants/colors';
import { useAdminSettings } from '../hooks/useAdminFeatures';
import { Typography } from './Typography';
import { getOptimizedImageUrl } from '../utils/imageUtils';

const { width } = Dimensions.get('window');

interface FlipbookProps {
  imgUrl?: string;
  videoUrl?: string;
  tag?: string;
  title?: string;
  desc?: string;
  scrollY?: SharedValue<number>;
  /** When false, poster only — no ExoPlayer */
  active?: boolean;
}

export default function FlipbookSection({
  imgUrl,
  videoUrl,
  tag,
  title,
  desc,
  scrollY,
  active = false,
}: FlipbookProps) {
  const colors = useColors();
  const { settings } = useAdminSettings();

  const rawImgUrl = imgUrl || settings?.flipbook?.image || null;
  const resolvedImgUrl = React.useMemo(() => rawImgUrl ? getOptimizedImageUrl(rawImgUrl, 800) : null, [rawImgUrl]);
  const resolvedVideoUrl = videoUrl || settings?.flipbook?.video || null;

  const displayTag = tag || settings?.flipbook?.tag || null;
  const displayTitle = title || settings?.flipbook?.title || null;
  const displayDesc = desc || settings?.flipbook?.desc || null;

  if (!resolvedImgUrl && !resolvedVideoUrl) return null;

  // Lazy: no player unless this slot is active
  if (!active || !resolvedVideoUrl) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.card}>
          <View style={styles.mediaContainer}>
            {resolvedImgUrl ? (
              <Image
                source={{ uri: resolvedImgUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
              />
            ) : null}
            <View style={styles.overlay} />
          </View>
          <FlipbookCopy
            displayTag={displayTag}
            displayTitle={displayTitle}
            displayDesc={displayDesc}
          />
        </View>
      </View>
    );
  }

  return (
    <FlipbookWithVideo
      colors={colors}
      resolvedImgUrl={resolvedImgUrl}
      resolvedVideoUrl={resolvedVideoUrl}
      displayTag={displayTag}
      displayTitle={displayTitle}
      displayDesc={displayDesc}
      scrollY={scrollY}
    />
  );
}

function FlipbookCopy({
  displayTag,
  displayTitle,
  displayDesc,
}: {
  displayTag: string | null;
  displayTitle: string | null;
  displayDesc: string | null;
}) {
  return (
    <>
      {displayTag ? (
        <View style={styles.floatingTag}>
          <Typography size={7} color="#FFFFFF" weight="600" style={styles.tagText}>
            {displayTag}
          </Typography>
        </View>
      ) : null}

      <View style={styles.textContent}>
        {displayTitle ? (
          <Typography heading size={12} color="#FFFFFF" weight="bold" style={styles.cardTitle}>
            {displayTitle}
          </Typography>
        ) : null}
        {displayTitle || displayDesc ? <View style={styles.accentLine} /> : null}
        {displayDesc ? (
          <Typography size={7} color="rgba(255,255,255,0.7)" weight="300" style={styles.cardDesc}>
            {displayDesc}
          </Typography>
        ) : null}
      </View>
    </>
  );
}

function FlipbookWithVideo({
  colors,
  resolvedImgUrl,
  resolvedVideoUrl,
  displayTag,
  displayTitle,
  displayDesc,
  scrollY,
}: {
  colors: ReturnType<typeof useColors>;
  resolvedImgUrl: string | null;
  resolvedVideoUrl: string;
  displayTag: string | null;
  displayTitle: string | null;
  displayDesc: string | null;
  scrollY?: SharedValue<number>;
}) {
  const [layoutY, setLayoutY] = React.useState(0);
  const [ready, setReady] = React.useState(false);

  const videoSource = React.useMemo<VideoSource>(
    () => ({ uri: resolvedVideoUrl, useCaching: true }),
    [resolvedVideoUrl]
  );

  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = true;
    try {
      p.bufferOptions = { preferredForwardBufferDuration: 5 };
    } catch {
      /* */
    }
    try {
      p.play();
    } catch {
      /* */
    }
  });

  const isFocused = useNavigation().isFocused();

  React.useEffect(() => {
    if (!player) return;
    try {
      if (isFocused) player.play();
      else player.pause();
    } catch {
      /* released */
    }
  }, [isFocused, player]);

  const imageAnimatedStyle = useAnimatedStyle(() => {
    if (!scrollY) return {};
    const scale = interpolate(
      scrollY.value,
      [layoutY - 600, layoutY, layoutY + 600],
      [1, 1.15, 1.25],
      Extrapolation.CLAMP
    );
    return { transform: [{ scale }] };
  });

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={(e) => setLayoutY(e.nativeEvent.layout.y)}
    >
      <View style={styles.card}>
        <Animated.View style={[styles.mediaContainer, imageAnimatedStyle]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
            onFirstFrameRender={() => setReady(true)}
            {...(Platform.OS === 'android' ? { surfaceType: 'surfaceView' as const } : {})}
          />
          {!ready && resolvedImgUrl ? (
            <Image
              source={{ uri: resolvedImgUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
            />
          ) : null}
          <View style={styles.overlay} />
        </Animated.View>
        <FlipbookCopy
          displayTag={displayTag}
          displayTitle={displayTitle}
          displayDesc={displayDesc}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 40,
    alignItems: 'center',
    width: '100%',
  },
  card: {
    width: width,
    aspectRatio: 3 / 4.8,
    overflow: 'hidden',
    backgroundColor: '#000',
    elevation: 12,
  },
  mediaContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  floatingTag: {
    position: 'absolute',
    top: 32,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  tagText: {
    fontSize: 7,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 8,
  },
  textContent: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 2.8,
    textAlign: 'center',
    marginBottom: 6,
  },
  accentLine: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.4)',
    marginBottom: 16,
  },
  cardDesc: {
    fontSize: 7,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.9)',
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
    maxWidth: 220,
    lineHeight: 13,
  },
});
