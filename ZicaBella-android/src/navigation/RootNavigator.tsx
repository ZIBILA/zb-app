import React, { useEffect, useMemo } from 'react';
import { NavigationContainer, createNavigationContainerRef, DefaultTheme, DarkTheme, NavigationIndependentTree } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { View, InteractionManager } from 'react-native';

import { useThemeStore } from '../store/themeStore';
import { getColors, useColors, lightColors, darkColors } from '../constants/colors';
import { useUIStore } from '../store/uiStore';

import { useAuthStore } from '../store/authStore';
import { useWishlistStore } from '../store/wishlistStore';
import AuthNavigator from './AuthNavigator';
import TabNavigator from './TabNavigator';
import CheckoutNavigator from './CheckoutNavigator';
import OrderConfirmationScreen from '../screens/OrderConfirmationScreen';
import OrderDetailsScreen from '../screens/OrderDetailsScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import PolicyScreen from '../screens/PolicyScreen';
import FAQScreen from '../screens/FAQScreen';
import StoreCreditHistoryScreen from '../screens/StoreCreditHistoryScreen';
import LegalScreen from '../screens/legal/LegalScreen';
import AboutScreen from '../screens/AboutScreen';
import SupportScreen from '../screens/SupportScreen';
import SupportDetailScreen from '../screens/SupportDetailScreen';
import { withErrorBoundary } from '../components/ErrorBoundary';
import { RootStackParamList } from './types';
import { navigationRef } from './navigationUtils';

import CartDrawer from '../components/CartDrawer';
import WishlistDrawer from '../components/WishlistDrawer';
import MenuDrawer from '../components/MenuDrawer';
import { isShakeSuppressedByHaptic } from '../utils/haptics';

const SHAKE_BLOCKED_ROOT_ROUTES = new Set([
  'CheckoutFlow',
  'Auth',
  'OrderConfirmation',
  'OrderDetails',
]);

function getRootRouteName(): string | null {
  if (!navigationRef.isReady()) return null;
  const state = navigationRef.getRootState();
  if (!state?.routes?.length) return null;
  return state.routes[state.index]?.name ?? null;
}

const SafeOrderConfirmation = OrderConfirmationScreen;
const SafeProductDetail = ProductDetailScreen;

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking = {
  prefixes: ['zicabella://', 'https://app.zicabella.com'],
  config: {
    screens: {
      Auth: {
        screens: {
          Login: 'login',
          Register: 'register',
        },
      },
      Main: {
        screens: {
          HomeTab: '',
          ShopTab: 'shop',
          SearchTab: 'search',
          ChatTab: 'ai',
          OrdersTab: 'orders',
          ProfileTab: 'profile',
        },
      },
      ProductDetail: 'products/:handle',
      CheckoutFlow: 'checkout',
      OrderConfirmation: 'order-confirmation',
    },
  },
};

const RootNavigator = () => {
  const { 
    isCartOpen, setCartOpen, 
    isWishlistOpen, setWishlistOpen,
    isMenuOpen, setMenuOpen 
  } = useUIStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (isAuthenticated && token) {
      InteractionManager.runAfterInteractions(() => {
        const { syncWishlist } = useWishlistStore.getState();
        syncWishlist(token).catch(() => {});
      });
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;

    // Defer accelerometer setup to ensure smooth startup
    const startAccelerometer = () => {
      let lastMagnitude: number | null = null;
      let lastShakeAt = 0;

      try {
        Accelerometer.setUpdateInterval(100);
        subscription = Accelerometer.addListener((data) => {
          try {
            const { x, y, z } = data;
            const magnitude = Math.sqrt(x * x + y * y + z * z);

            if (lastMagnitude == null) {
              lastMagnitude = magnitude;
              return;
            }

            const delta = Math.abs(magnitude - lastMagnitude);
            lastMagnitude = magnitude;

            const now = Date.now();
            const COOLDOWN_MS = 1200;
            const SHAKE_THRESHOLD = 1.4;
            const MAGNITUDE_THRESHOLD = 2.0;

            if (delta > SHAKE_THRESHOLD || magnitude > MAGNITUDE_THRESHOLD) {
              if (now - lastShakeAt > COOLDOWN_MS) {
                // Button haptics (e.g. PLACE ORDER / Pay) vibrate the phone and
                // look like a shake — ignore those spikes. Also never open the
                // bag on top of checkout/payment.
                if (isShakeSuppressedByHaptic()) return;
                const rootRoute = getRootRouteName();
                if (rootRoute && SHAKE_BLOCKED_ROOT_ROUTES.has(rootRoute)) return;

                lastShakeAt = now;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                setCartOpen(!useUIStore.getState().isCartOpen);
              }
            }
          } catch (innerErr) {
            // Silently ignore
          }
        });
      } catch (err) {
        // Accelerometer not available
      }
    };

    // Use requestAnimationFrame instead of deprecated InteractionManager
    const frameId = requestAnimationFrame(startAccelerometer);

    return () => {
      cancelAnimationFrame(frameId);
      subscription?.remove();
    };
  }, []);

  const themeStr = useThemeStore((state) => state.theme);
  const colors = useColors();
  const isDark = themeStr === 'dark';

  const navigationTheme = useMemo(() => {
    const palette = getColors(themeStr as 'light' | 'dark');
    const baseTheme = isDark ? DarkTheme : DefaultTheme;
    
    return {
      ...baseTheme,
      dark: isDark,
      colors: {
        ...baseTheme.colors,
        primary: palette.primary || '#000000',
        background: palette.background || '#FFFFFF',
        card: palette.card || '#FFFFFF',
        text: palette.text || '#000000',
        border: palette.border || 'rgba(0,0,0,0.1)',
        notification: palette.badge || '#FF0000',
      },
    };
  }, [isDark, themeStr]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <NavigationIndependentTree>
        <NavigationContainer ref={navigationRef} linking={linking as any} theme={navigationTheme}>
        <Stack.Navigator id="RootStackNavigator" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="Auth" component={AuthNavigator} />
          
          {/* Auth-gated screens — deep links to these redirect to login if unauthenticated */}
          {isAuthenticated && (
            <>
              <Stack.Screen name="CheckoutFlow" component={CheckoutNavigator} />
              <Stack.Screen name="OrderConfirmation" component={SafeOrderConfirmation} />
              <Stack.Screen name="OrderDetails" component={OrderDetailsScreen as any} />
              <Stack.Screen name="StoreCreditHistory" component={StoreCreditHistoryScreen} />
            </>
          )}
          
          {/* Public screens — accessible without auth */}
          <Stack.Screen name="ProductDetail" component={SafeProductDetail} />
          <Stack.Screen name="Policy" component={PolicyScreen as any} />
          <Stack.Screen name="FAQ" component={FAQScreen as any} />
          <Stack.Screen 
            name="Legal" 
            component={LegalScreen} 
            options={{ 
              headerShown: true, 
              title: 'Legal', 
              headerStyle: { backgroundColor: '#000' }, 
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700' }
            }} 
          />
          <Stack.Screen 
            name="About" 
            component={AboutScreen} 
            options={{ 
              headerShown: true, 
              title: 'About', 
              headerStyle: { backgroundColor: '#000' }, 
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700' }
            }} 
          />
          <Stack.Screen 
            name="Support" 
            component={SupportScreen} 
            options={{ 
              headerShown: true, 
              title: 'Support', 
              headerStyle: { backgroundColor: '#000' }, 
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700' }
            }} 
          />
          <Stack.Screen name="SupportDetail" component={SupportDetailScreen} />
        </Stack.Navigator>

        {/* ── GLOBAL UI OVERLAYS ── */}
        <CartDrawer 
          visible={isCartOpen} 
          onClose={() => setCartOpen(false)} 
          onCheckout={() => {
            setCartOpen(false);
            // @ts-ignore
            navigationRef.current?.navigate('CheckoutFlow');
          }}
        />
        <WishlistDrawer
          visible={isWishlistOpen}
          onClose={() => setWishlistOpen(false)}
        />
        <MenuDrawer
          visible={isMenuOpen}
          onClose={() => setMenuOpen(false)}
        />
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
};

export default RootNavigator;
