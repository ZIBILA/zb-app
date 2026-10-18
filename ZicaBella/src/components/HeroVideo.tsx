import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
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
}

export default function HeroVideo({ 
  source, 
  height: customHeight, 
  borderRadius,
  isMuted = true,
  onToggleMute,
  imageFallback
}: Props) {
  const colors = useColors();
  const [showIcon, setShowIcon] = React.useState(false);
  const timerRef = React.useRef<any>(null);
  
  const [localMuted, setLocalMuted] = React.useState(isMuted);

  // Sync prop changes to local state
  React.useEffect(() => {
    setLocalMuted(isMuted);
  }, [isMuted]);

  // Guard against empty strings or invalid URLs that cause AVFoundation errors
  const safeSource = source && source.trim() !== '' && source !== '/' ? source : null;

  const player = useVideoPlayer(safeSource, (player) => {
    if (safeSource) {
      player.loop = true;
      player.muted = localMuted;
      player.play();
    }
  });

  const isFocused = useNavigation().isFocused();
  const isAppActive = useUIStore(s => s.isAppActive);

  // Handle player event subscriptions to ensure looping and playback persistence
  React.useEffect(() => {
    if (!player) return;

    // Direct listener to force replay if the native looping fails or ends
    const endSub = player.addListener('playToEnd', () => {
      if (isFocused && isAppActive) {
        player.currentTime = 0;
        player.play();
      }
    });

    // If play status changes to paused, but the app is still active and screen focused, restart playback
    const playingSub = player.addListener('playingChange', () => {
      if (isFocused && isAppActive && !player.playing) {
        player.play();
      }
    });

    // If status transitions to ready, make sure we play
    const statusSub = player.addListener('statusChange', (event) => {
      if (isFocused && isAppActive && event.status === 'readyToPlay' && !player.playing) {
        player.play();
      }
    });

    return () => {
      endSub.remove();
      playingSub.remove();
      statusSub.remove();
    };
  }, [player, isFocused, isAppActive]);

  React.useEffect(() => {
    if (!player) return;
    player.muted = localMuted;
    
    // Show icon briefly when muted state changes
    setShowIcon(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowIcon(false), 2000);
  }, [localMuted, player]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  React.useEffect(() => {
    if (!player) return;
    if (!isFocused || !isAppActive) {
      player.pause();
    } else {
      player.play();
    }
  }, [isFocused, isAppActive, player]);

  const handlePress = () => {
    if (onToggleMute) {
      onToggleMute();
    } else {
      setLocalMuted(prev => !prev);
    }
  };

  if (!safeSource) {
    return (
      <View style={[styles.container, { height: customHeight || height, borderRadius: borderRadius || 0, backgroundColor: colors.surface }]}>
        <Image 
          source={imageFallback ? { uri: imageFallback } : require('../../assets/load-image-4.jpg')} 
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      </View>
    );
  }

  return (
    <TouchableOpacity 
      activeOpacity={0.95}
      onPress={handlePress}
      style={[styles.container, { height: customHeight || height, borderRadius: borderRadius || 0, backgroundColor: colors.surface }]}
    >
      <VideoView
        player={player}
        style={[styles.video, { backgroundColor: colors.background, borderRadius: borderRadius || 0 }]}
        nativeControls={false}
        contentFit="cover"
      />
      
      {/* Minimal Floating Mute/Unmute Icon */}
      {showIcon && (
        <View style={styles.muteIconWrapper}>
          <Ionicons 
            name={localMuted ? "volume-mute-outline" : "volume-medium-outline"} 
            size={16} 
            color="#FFF" 
            style={{ opacity: 0.9, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}
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
  }
});
