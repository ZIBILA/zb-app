import React, { useEffect } from 'react';
import { 
  View, StyleSheet, Modal, TouchableOpacity, 
  useWindowDimensions, Pressable, FlatList, ActivityIndicator,
  KeyboardAvoidingView, Platform, Dimensions
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCartStore } from '../store/cartStore';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { formatPrice } from '../utils/formatPrice';
import CartItem from './CartItem';
import { Typography } from './Typography';
import { haptics } from '../utils/haptics';
import { expandCartUnits } from '../utils/cartUnits';

interface Props {
  visible: boolean;
  onClose: () => void;
  onCheckout: () => void;
}

const { height: WINDOW_HEIGHT } = Dimensions.get('window');

export default function CartDrawer({ visible, onClose, onCheckout }: Props) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';
  const { items, total, updateQuantity, removeItem, itemCount, setBuyNowItem } = useCartStore();
  const [showShakeTutorial, setShowShakeTutorial] = React.useState(false);
  const tutorialOpacity = useSharedValue(0);

  // Persistence check for the tutorial
  React.useEffect(() => {
    const checkTutorial = async () => {
      // Use a new key to reset for the user if they missed it
      const seen = await AsyncStorage.getItem('zicabella_shake_hint_v2');
      if (!seen && visible) {
        setShowShakeTutorial(true);
        tutorialOpacity.value = withTiming(1, { duration: 600 });
        
        // Auto-hide after 8 seconds
        const timer = setTimeout(() => {
          if (showShakeTutorial) {
            tutorialOpacity.value = withTiming(0, { duration: 500 }, () => {
              runOnJS(setShowShakeTutorial)(false);
              runOnJS(AsyncStorage.setItem)('zicabella_shake_hint_v2', 'true');
            });
          }
        }, 8000);
        return () => clearTimeout(timer);
      }
    };
    checkTutorial();
  }, [visible]);

  // Consistent height for premium look
  const SHEET_HEIGHT = screenHeight * 0.88;
  
  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  // Track mount state with regular React state to avoid reading .value during render.
  const [isMounted, setIsMounted] = React.useState(visible);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      backdropOpacity.value = withTiming(1, { duration: 300 });
      translateY.value = withSpring(0, {
        damping: 25,
        stiffness: 180,
        mass: 0.8,
      });
      haptics.success();
    } else {
      backdropOpacity.value = withTiming(0, { duration: 250 });
      translateY.value = withTiming(SHEET_HEIGHT, { duration: 300, }, () => {
        // Run on JS thread after animation completes so we can unmount safely.
        // runOnJS is imported below — use a simple timeout fallback instead to
        // avoid adding another import for this one case.
      });
      // Unmount after the closing animation finishes.
      const timer = setTimeout(() => setIsMounted(false), 320);
      return () => clearTimeout(timer);
    }
  }, [visible, SHEET_HEIGHT]);

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // Use isMounted (plain React state) instead of reading .value directly during render.
  if (!visible && !isMounted) return null;

  const handleCheckout = () => {
    haptics.buttonTap();
    setBuyNowItem(null);
    onClose();
    setTimeout(() => {
      onCheckout();
    }, 400);
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Backdrop */}
        <Animated.View style={[styles.backdrop, animatedBackdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            {Platform.OS === 'android' ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.70)' }]} />
            ) : (
              <BlurView 
                intensity={isDark ? 30 : 40} 
                tint={isDark ? 'dark' : 'light'} 
                style={StyleSheet.absoluteFill} 
              />
            )}
          </Pressable>
        </Animated.View>

        {/* Bottom Sheet */}
        <Animated.View style={[
          styles.sheet,
          animatedSheetStyle,
          { 
            height: SHEET_HEIGHT,
            backgroundColor: isDark ? 'rgba(10, 10, 10, 0.95)' : 'rgba(255, 255, 255, 0.98)',
            borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
          }
        ]}>
          {Platform.OS === 'android' ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(10, 10, 10, 0.98)' : 'rgba(255, 255, 255, 0.98)' }]} />
          ) : (
            <BlurView intensity={100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          
          <View style={styles.sheetInner}>
            {/* Grab Bar */}
            <View style={styles.grabBarContainer}>
               <View style={[styles.grabBar, { backgroundColor: colors.text, opacity: 0.15 }]} />
            </View>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
                  <Ionicons name="bag-handle" size={18} color={colors.text} />
                </View>
                <View>
                  <Typography size={11} weight="800" color={colors.text} style={styles.drawerTitle}>SHOPPING BAG</Typography>
                  <Typography size={8} weight="600" color={colors.textExtraLight} style={{ letterSpacing: 1.5 }}>{itemCount()} PIECES SELECTED</Typography>
                </View>
              </View>
              <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            {items.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="bag-outline" size={60} color={colors.text} style={{ opacity: 0.1, marginBottom: 20 }} />
                <Typography size={10} weight="800" color={colors.textExtraLight} style={styles.emptyText}>YOUR BAG IS EMPTY</Typography>
                
                <TouchableOpacity onPress={onClose} style={[styles.shopBtn, { backgroundColor: colors.text }]}>
                  <Typography size={9} weight="800" color={colors.background} style={styles.shopBtnText}>BROWSE COLLECTION</Typography>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <FlatList
                  data={expandCartUnits(items)}
                  keyExtractor={(item) => item.unitKey}
                  contentContainerStyle={[styles.listContent, { paddingBottom: 220 }]}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <View style={styles.itemWrapper}>
                      <CartItem 
                        item={item} 
                        onUpdateQuantity={(id, q) => { haptics.buttonTap(); updateQuantity(id, q); }}
                        onRemove={(id) => { haptics.buttonTap(); removeItem(id); }}
                        onPress={() => {
                          onClose();
                          setTimeout(() => navigation.navigate('ProductDetail', { handle: item.handle }), 400);
                        }}
                      />
                    </View>
                  )}
                />

                {/* Footer Section - Positioned at bottom of sheet */}
                <View style={[
                  styles.footerSection, 
                  { 
                    paddingBottom: Math.max(insets.bottom, 24),
                    backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)'
                  }
                ]}>
                  <View style={[styles.footerBorder, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }]} />
                  
                  <View style={styles.footerContent}>
                    <View style={styles.shakeHintRow}>
                      <Ionicons name="phone-portrait-outline" size={12} color={colors.textExtraLight} />
                      <Typography size={7} weight="400" color={colors.textExtraLight} style={{ opacity: 0.5, letterSpacing: 1.2 }}>
                        SHAKE TO TOGGLE BAG
                      </Typography>
                    </View>

                    <View style={styles.totalRow}>
                      <View>
                        <Typography size={9} weight="800" color={colors.textExtraLight} style={styles.totalLabel}>TOTAL ESTIMATE</Typography>
                        <Typography weight="500" size={8} color={colors.textMuted} style={{ marginTop: 4 }}>TAXES & SHIPPING CALCULATED AT CHECKOUT</Typography>
                      </View>
                      <Typography size={26} weight="300" color={colors.text} style={styles.priceText}>{formatPrice(total())}</Typography>
                    </View>
                    
                    <TouchableOpacity 
                      style={[styles.checkoutBtn, { backgroundColor: colors.text }]} 
                      onPress={handleCheckout}
                      activeOpacity={0.9}
                    >
                      <View style={styles.checkoutBtnContent}>
                        <Typography size={11} weight="800" color={colors.background} style={styles.checkoutBtnText}>PROCEED TO CHECKOUT</Typography>
                        <View style={[styles.btnBadge, { backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.3)' }]}>
                           <Ionicons name="arrow-forward" size={16} color={colors.background} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {/* ── SHAKE TUTORIAL OVERLAY ── */}
            {showShakeTutorial && (
              <Pressable 
                onPress={() => {
                  tutorialOpacity.value = withTiming(0, { duration: 300 }, () => {
                    runOnJS(setShowShakeTutorial)(false);
                    runOnJS(AsyncStorage.setItem)('zicabella_shake_hint_v2', 'true');
                  });
                }}
                style={[
                  styles.tutorialOverlay, 
                ]}
              >
                <Animated.View style={[
                  styles.tutorialOverlay, 
                  { opacity: tutorialOpacity },
                ]}>
                  {Platform.OS === 'android' ? (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(240, 240, 240, 0.90)' }]} />
                  ) : (
                    <BlurView intensity={20} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
                  )}
                  <View style={styles.tutorialContent}>
                    <View style={[styles.tutorialIconCircle, { backgroundColor: colors.foreground }]}>
                        <Ionicons name="phone-portrait" size={32} color={colors.background} />
                    </View>
                    <Typography size={10} weight="800" color={colors.text} style={{ letterSpacing: 4, marginTop: 24, textAlign: 'center' }}>
                      SHAKE TO OPEN
                    </Typography>
                    <Typography size={8} weight="400" color={colors.textExtraLight} style={{ marginTop: 8, opacity: 0.6, textAlign: 'center' }}>
                      Toggle your shopping bag anytime{"\n"}with a gentle shake.
                    </Typography>
                  </View>
                </Animated.View>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderBottomWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -20 },
        shadowOpacity: 0.3,
        shadowRadius: 30,
      },
      android: {
        elevation: 30,
      },
    }),
  },
  sheetInner: {
    flex: 1,
  },
  grabBarContainer: {
    alignItems: 'center',
    paddingTop: 16,
  },
  grabBar: {
    width: 48,
    height: 6,
    borderRadius: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 28,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  drawerTitle: {
    letterSpacing: 4,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 24,
  },
  itemWrapper: {
    marginBottom: 8,
  },
  shakeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    marginBottom: 30,
  },
  tutorialOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  tutorialContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  tutorialIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 15,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  emptyState: {
    flex: 0.8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    letterSpacing: 5,
    opacity: 0.5,
    marginTop: 20,
    marginBottom: 40,
  },
  shopBtn: {
    height: 58,
    paddingHorizontal: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shopBtnText: {
    letterSpacing: 2.5,
  },
  footerSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  footerBorder: {
    height: 1.5,
    width: '100%',
  },
  footerContent: {
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  footerLogoRow: {
    alignItems: 'center',
    marginBottom: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  totalLabel: {
    letterSpacing: 2.5,
  },
  priceText: {
    letterSpacing: -1.5,
  },
  checkoutBtn: {
    height: 64,
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  checkoutBtnContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  checkoutBtnText: {
    letterSpacing: 2,
  },
  btnBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shakeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
});
