import React from 'react';
import { View, StyleSheet, TouchableOpacity, Pressable, Dimensions } from 'react-native';
import { useVideoPlayer, VideoView, VideoSource } from 'expo-video';
import { Image } from 'expo-image';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/colors';
import { useUIStore } from '../store/uiStore';
import { Typography } from './Typography';
import { haptics } from '../utils/haptics';

const { width, height } = Dimensions.get('window');

interface Props {
  source: string;
  height?: number;
  borderRadius?: number;
  isMuted?: boolean;
  onToggleMute?: () => void;
  imageFallback?: string | null;
  /**
   * When false: render poster only — no ExoPlayer/MediaCodec allocated.
   * This is the #1 Android jank fix (lazy mount). Default true for non-home usages.
   */
  active?: boolean;
  showShopAll?: boolean;
  onPressShopAll?: () => void;
}

function toCachedSource(uri: string): VideoSource {
  return { uri, useCaching: true };
}

/**
 * Brand video with lazy ExoPlayer allocation.
 * Inactive slots are posters only; active slots mount a real player.
 */
export default function HeroVideo({
  source,
  height: customHeight,
  borderRadius,
  isMuted = true,
  onToggleMute,
  imageFallback,
  active = true,
  showShopAll = false,
  onPressShopAll,
}: Props) {
  const colors = useColors();
  const safeSource = source && source.trim() !== '' && source !== '/' ? source : null;
  const posterUri = imageFallback || null;

  const containerStyle = [
    styles.container,
    {
      height: customHeight || height,
      borderRadius: borderRadius || 0,
      backgroundColor: colors.surface,
      overflow: 'hidden' as const,
    },
  ];

  // Lazy: no useVideoPlayer unless this slot is the active one
  if (!active || !safeSource) {
    return (
      <View style={containerStyle}>
        <Image
          source={posterUri ? { uri: posterUri } : require('../../assets/zb-logo-220px.png')}
          style={StyleSheet.absoluteFill}
          contentFit={posterUri ? 'cover' : 'contain'}
          priority={active ? 'high' : 'low'}
          cachePolicy="memory-disk"
          recyclingKey={posterUri || 'hero-poster'}
          transition={0}
        />
        {showShopAll && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onPressShopAll}
            style={styles.shopAllButton}
            hitSlop={{ top: 14, bottom: 14, left: 24, right: 24 }}
          >
            <Typography
              size={9}
              weight="700"
              color="rgba(255, 255, 255, 0.75)"
              letterSpacing={3.5}
              style={styles.shopAllText}
            >
              SHOP ALL
            </Typography>
            <View style={styles.shopAllUnderline} />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <LiveBrandVideo
      source={safeSource}
      posterUri={posterUri}
      containerStyle={containerStyle}
      borderRadius={borderRadius || 0}
      isMuted={isMuted}
      onToggleMute={onToggleMute}
      colors={colors}
      showShopAll={showShopAll}
      onPressShopAll={onPressShopAll}
    />
  );
}

function LiveBrandVideo({
  source,
  posterUri,
  containerStyle,
  borderRadius,
  isMuted,
  onToggleMute,
  colors,
  showShopAll,
  onPressShopAll,
}: {
  source: string;
  posterUri: string | null;
  containerStyle: any;
  borderRadius: number;
  isMuted: boolean;
  onToggleMute?: () => void;
  colors: ReturnType<typeof useColors>;
  showShopAll?: boolean;
  onPressShopAll?: () => void;
}) {
  const [ready, setReady] = React.useState(false);
  const [localMuted, setLocalMuted] = React.useState(isMuted);

  React.useEffect(() => {
    setLocalMuted(isMuted);
  }, [isMuted]);

  const videoSource = React.useMemo(() => toCachedSource(source), [source]);

  const isFocused = useIsFocused();
  const isAppActive = useUIStore((s) => s.isAppActive);
  const shouldPlay = Boolean(isFocused && isAppActive);

  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = localMuted;
    try {
      p.bufferOptions = {
        preferredForwardBufferDuration: 5,
      };
    } catch {
      /* older native builds */
    }
    if (shouldPlay) {
      try {
        p.play();
      } catch {
        /* released */
      }
    }
  });

  React.useEffect(() => {
    if (!player) return;
    try {
      if (shouldPlay) {
        player.play();
        player.muted = localMuted;
      } else {
        player.pause();
        player.muted = true;
      }
    } catch {
      /* */
    }
  }, [shouldPlay, localMuted, player]);

  const handlePress = () => {
    haptics.buttonTap();
    if (onToggleMute) onToggleMute();
    else setLocalMuted((prev) => !prev);
  };

  return (
    <View style={containerStyle}>
      <VideoView
        player={player}
        style={[styles.video, { backgroundColor: colors.background, borderRadius }]}
        nativeControls={false}
        contentFit="cover"
        onFirstFrameRender={() => setReady(true)}
        pointerEvents="none"
      />

      {!ready && posterUri ? (
        <Image
          source={{ uri: posterUri }}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          pointerEvents="none"
        />
      ) : null}

      {/* Subtle bottom vignette to ensure Shop All and Mute buttons are clean and legible */}
      <View style={styles.bottomVignette} pointerEvents="none" />

      {/* Full-area tap target above the video surface (SurfaceView steals touches otherwise) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={localMuted ? 'Unmute video' : 'Mute video'}
        onPress={handlePress}
        style={styles.tapOverlay}
      />

      {/* Shop All Button (website parity) */}
      {showShopAll && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            haptics.buttonTap();
            onPressShopAll?.();
          }}
          style={styles.shopAllButton}
          hitSlop={{ top: 14, bottom: 14, left: 24, right: 24 }}
        >
          <Typography
            size={9}
            weight="700"
            color="rgba(255, 255, 255, 0.75)"
            letterSpacing={3.5}
            style={styles.shopAllText}
          >
            SHOP ALL
          </Typography>
          <View style={styles.shopAllUnderline} />
        </TouchableOpacity>
      )}

      {/* Mute Button - compact, luxury, visible */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={handlePress}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.muteButton}
      >
        <Ionicons
          name={localMuted ? 'volume-mute' : 'volume-high'}
          size={14}
          color="#FFF"
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  tapOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  shopAllButton: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  shopAllText: {
    letterSpacing: 3.5,
    textTransform: 'uppercase',
  },
  shopAllUnderline: {
    width: 28,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 0.5,
    marginTop: 4,
  },
  bottomVignette: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 90,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  muteButton: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 0.8,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
});
