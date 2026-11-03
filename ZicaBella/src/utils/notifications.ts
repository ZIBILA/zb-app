import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { config } from '../constants/config';

/**
 * Register for push notifications and return the native APNs device token.
 * Delivery is server -> Apple (APNs) directly; the Expo push service is not used.
 * (`expoToken` stays in the type only for callers that still read it; it is never set.)
 */
export async function registerForPushNotifications(): Promise<{
  expoToken?: string;
  deviceToken?: string;
} | undefined> {
  if (!Device.isDevice || Platform.OS === 'web') {
    console.warn('[Notifications] Push notifications require a physical device.');
    return undefined;
  }

  try {
    // 1. Request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: true,
        },
      });
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[Notifications] Permission not granted.');
      return undefined;
    }

    let deviceToken: string | undefined;

    // 2. Native APNs registration token
    try {
      const native = await Notifications.getDevicePushTokenAsync();
      deviceToken = typeof native?.data === 'string' ? native.data : undefined;
    } catch (err) {
      console.warn('[Notifications] APNs token fetch failed:', err);
    }

    console.log('[Notifications] Registration successful:', { hasDeviceToken: !!deviceToken });
    return { deviceToken };
  } catch (err) {
    console.warn('[Notifications] Error during registration:', err);
    return undefined;
  }
}

/**
 * Send tokens to the backend.
 */
export async function postPushTokenToBackend(
  tokens: { expoToken?: string; deviceToken?: string },
  userId: string
): Promise<boolean> {
  try {
    const primaryToken = tokens.deviceToken;
    const tokenType = 'apns';

    if (!primaryToken) {
      return false;
    }

    const payload = {
      userId,
      deviceToken: tokens.deviceToken,
      apnsToken: tokens.deviceToken,
      pushToken: primaryToken,
      token: primaryToken,
      tokenType,
      pushProvider: tokenType,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version || '1.0.0',
    };

    // Use the primary registration endpoint
    const response = await fetch(`${config.appUrl}/api/notifications/register-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        deviceId: `ios_${userId}`,
        fcmToken: primaryToken, // Backward-compatible legacy field name.
      }),
    });

    // Also notify the simplified endpoint
    fetch(`${config.appUrl}/api/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});

    return response.ok;
  } catch (err) {
    console.warn('[Notifications] Failed to sync tokens with backend:', err);
    return false;
  }
}

/**
 * High-level initialization function for push notifications.
 * Typically called after a user places their first order to ensure
 * they are opted-in for status updates.
 */
export async function initPushNotifications() {
  try {
    const tokens = await registerForPushNotifications();
    if (!tokens) return;

    // Get current userId from auth store
    // Using lazy require to avoid circular dependency
    const { useAuthStore } = require('../store/authStore');
    const user = useAuthStore.getState().user;

    if (user?.id) {
      await postPushTokenToBackend(tokens, user.id);
    }
  } catch (err) {
    console.warn('[Notifications] Initialization failed:', err);
  }
}
