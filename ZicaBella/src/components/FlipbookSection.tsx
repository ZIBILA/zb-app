import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, { useAnimatedStyle, interpolate, Extrapolation, SharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../constants/colors';
import { useAdminSettings } from '../hooks/useAdminFeatures';
import { Typography } from './Typography';

const { width } = Dimensions.get('window');

interface FlipbookProps {
  imgUrl?: string;
  videoUrl?: string;
  tag?: string;
  title?: string;
  desc?: string;
  scrollY?: SharedValue<number>;
}

export default function FlipbookSection({ imgUrl, videoUrl, tag, title, desc, scrollY }: FlipbookProps) {
  const colors = useColors();
  const { settings } = useAdminSettings();

  // Use exact admin settings — no hardcoded fallback defaults
  const resolvedImgUrl = imgUrl || settings?.flipbook?.image || null;
  const resolvedVideoUrl = videoUrl || settings?.flipbook?.video || null;

  const displayTag   = tag      || settings?.flipbook?.tag    || null;
  const displayTitle = title    || settings?.flipbook?.title  || null;
  const displayDesc  = desc     || settings?.flipbook?.desc   || null;

  // Don't render if no media is configured from admin
  if (!resolvedImgUrl && !resolvedVideoUrl) return null;

  const [layoutY, setLayoutY] = React.useState(0);
  const player = useVideoPlayer(resolvedVideoUrl ?? null, (player) => {
    if (!resolvedVideoUrl) return;
    player.loop = true;
    player.muted = true;
  });

  const isFocused = useNavigation().isFocused();

  React.useEffect(() => {
    if (!player) return;
    if (!isFocused) {
      player.pause();
    } else {
      player.play();
    }
  }, [isFocused, player]);

  const imageAnimatedStyle = useAnimatedStyle(() => {
    if (!scrollY) return {};
    
    // Calculate the scale based on scroll position
    // Zoom in as the section approaches the center of the screen
    const scale = interpolate(
      scrollY.value,
      [layoutY - 600, layoutY, layoutY + 600],
      [1, 1.15, 1.25],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ scale }],
    };
  });

  return (
    <View 
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={(e) => setLayoutY(e.nativeEvent.layout.y)}
    >
      {/* Card Section */}
      <View style={styles.card}>
        <Animated.View style={[styles.mediaContainer, imageAnimatedStyle]}>
          {resolvedVideoUrl ? (
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              nativeControls={false}
              contentFit="cover"
            />
          ) : resolvedImgUrl ? (
            <Image
              source={{ uri: resolvedImgUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={600}
            />
          ) : null}
          {/* Subtle dark overlay for text legibility */}
          <View style={styles.overlay} />
        </Animated.View>

        {/* Floating Tag Overlay */}
        {displayTag ? (
        <View style={styles.floatingTag}>
           <Typography size={7} color="#FFFFFF" weight="600" style={styles.tagText}>{displayTag}</Typography>
        </View>
        ) : null}

        <View style={styles.textContent}>
          {displayTitle ? <Typography heading size={12} color="#FFFFFF" weight="bold" style={styles.cardTitle}>{displayTitle}</Typography> : null}
          {(displayTitle || displayDesc) ? <View style={styles.accentLine} /> : null}
          {displayDesc ? <Typography size={7} color="rgba(255,255,255,0.7)" weight="300" style={styles.cardDesc}>{displayDesc}</Typography> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 40, // Reduced vertical padding
    alignItems: 'center',
    width: '100%',
  },
  tagWrapper: {
    alignItems: 'center',
    marginBottom: 32,
  },
  tagText: {
    fontSize: 7,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 8,
  },
  tagLine: {
    width: 20,
    height: 1,
    marginTop: 10,
  },
  card: {
    width: width, // Full Screen Width (Edge to Edge)
    aspectRatio: 3 / 4.8, // Reduced height (was 3 / 5.85)
    overflow: 'hidden',
    backgroundColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.25,
    shadowRadius: 36,
    elevation: 12,
  },
  mediaContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)', // Slightly darker for better contrast
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
