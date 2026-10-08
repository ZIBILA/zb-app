import React, { useEffect, useRef } from 'react';
import { StatusBar, StyleSheet, AppState, InteractionManager } from 'react-native';
import { useUIStore } from './src/store/uiStore';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';

import RootNavigator from './src/navigation/RootNavigator';
import { ConsentModal } from './src/components/ConsentModal';
import { requestTrackingConsentOnce } from './src/services/snapDeviceContext';
import { useThemeStore } from './src/store/themeStore';
import { useFonts } from 'expo-font';
import { getColors } from './src/constants/colors';
import { NotificationService } from './src/services/NotificationService';
import { InAppNotificationBanner } from './src/components/InAppNotificationBanner';
import { registerForPushNotifications, postPushTokenToBackend } from './src/utils/notifications';
import { useAuthStore } from './src/store/authStore';
import { useNotificationStore } from './src/store/notificationStore';
import { getCacheService } from './src/services/cacheService';
import { ErrorBoundary } from './src/components/ErrorBoundary';


// Sentry initialization is disabled during local development to prevent Expo Go native module crashes.
// It will be enabled in the final EAS build.


// Keep the splash screen visible while we fetch resources if needed
// SplashScreen.preventAutoHideAsync() moved inside App function

function App() {
  useEffect(() => {
    SplashScreen.preventAutoHideAsync().catch(() => {});
  }, []);

  const [fontsLoaded] = useFonts({
    'Rocaston': require('./assets/fonts/Rocaston.ttf'),
  });

  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';
  const colors = getColors(theme);
  const userId = useAuthStore(state => state.user?.id);

  // Refs for notification listeners to avoid duplicates
  const notificationReceivedRef = useRef<Notifications.Subscription | null>(null);
  const notificationResponseRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    if (fontsLoaded) {
      // Hydrate cache and then hide splash
      getCacheService().hydrate().then(() => {
        SplashScreen.hideAsync().catch(() => {});
      }).catch(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
      
      // Defer non-critical services
      InteractionManager.runAfterInteractions(() => {
        NotificationService.initialize();
      });
    }
  }, [fontsLoaded]);

  // ── Push token registration ──────────────────────────────────────────────
  // Whenever the authenticated user changes, re-register the push token.
  useEffect(() => {
    if (!fontsLoaded) return;

    // Defer push registration to avoid blocking start-up
    const task = InteractionManager.runAfterInteractions(() => {
      (async () => {
        const tokens = await registerForPushNotifications();
        if (tokens) {
          const primaryToken = tokens.deviceToken || tokens.expoToken;
          if (primaryToken) {
            useNotificationStore.getState().setPushToken(primaryToken);
            if (userId) {
              postPushTokenToBackend(tokens, userId);
            }
          }
        }
      })();
    });
    return () => task.cancel();
  }, [fontsLoaded, userId]);

  // ── AppState listener ──────────────────────────────────────────────────
  useEffect(() => {
    const setAppActive = useUIStore.getState().setAppActive;
    const subscription = AppState.addEventListener('change', nextAppState => {
      setAppActive(nextAppState === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary screenName="RootApp">
        <SafeAreaProvider>
          <StatusBar 
            barStyle={isDark ? "light-content" : "dark-content"} 
            backgroundColor="transparent"
            translucent 
          />
          <InAppNotificationBanner />
          <RootNavigator />
          <ConsentModal onConsentComplete={requestTrackingConsentOnce} />
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default App;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
