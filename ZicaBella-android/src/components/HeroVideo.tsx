import React from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { useVideoPlayer, VideoView, VideoSource } from 'expo-video';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/colors';
import { useUIStore } from '../store/uiStore';

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
}: {
  source: string;
  posterUri: string | null;
  containerStyle: any;
  borderRadius: number;
  isMuted: boolean;
  onToggleMute?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [showIcon, setShowIcon] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localMuted, setLocalMuted] = React.useState(isMuted);

  React.useEffect(() => {
    setLocalMuted(isMuted);
  }, [isMuted]);

  const videoSource = React.useMemo(() => toCachedSource(source), [source]);

  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = localMuted;
    // Short loops don't need a 20s Android forward buffer
    try {
      p.bufferOptions = {
        preferredForwardBufferDuration: 5,
      };
    } catch {
      /* older native builds */
    }
    try {
      p.play();
    } catch {
      /* released */
    }
  });

  const isFocused = useNavigation().isFocused();
  const isAppActive = useUIStore((s) => s.isAppActive);
  const shouldPlay = Boolean(isFocused && isAppActive);

  React.useEffect(() => {
    if (!player) return;
    try {
      player.muted = localMuted;
    } catch {
      /* */
    }
    setShowIcon(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowIcon(false), 1600);
  }, [localMuted, player]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  React.useEffect(() => {
    if (!player) return;
    try {
      if (shouldPlay) player.play();
      else player.pause();
    } catch {
      /* */
    }
  }, [shouldPlay, player]);

  const handlePress = () => {
    if (onToggleMute) onToggleMute();
    else setLocalMuted((prev) => !prev);
  };

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={handlePress} style={containerStyle}>
      <VideoView
        player={player}
        style={[styles.video, { backgroundColor: colors.background, borderRadius }]}
        nativeControls={false}
        contentFit="cover"
        onFirstFrameRender={() => setReady(true)}
        {...(Platform.OS === 'android' ? { surfaceType: 'surfaceView' as const } : {})}
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

      {showIcon && (
        <View style={styles.muteIconWrapper}>
          <Ionicons
            name={localMuted ? 'volume-mute-outline' : 'volume-medium-outline'}
            size={16}
            color="#FFF"
            style={{
              opacity: 0.9,
              textShadowColor: 'rgba(0,0,0,0.4)',
              textShadowRadius: 4,
              textShadowOffset: { width: 0, height: 1 },
            }}
          />
        </View>
      )}
    </TouchableOpacity>
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
  muteIconWrapper: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
});
