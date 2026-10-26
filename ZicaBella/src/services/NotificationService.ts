/**
 * NotificationService
 *
 * Full push notification support for iOS via Expo Notifications.
 * - Foreground banners (via setNotificationHandler in index.ts)
 * - Lock screen / background notifications (native APNs delivery)
 * - Badge count management
 * - Deep link routing on notification tap
 * - Device token registration with backend
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useNotificationStore } from '../store/notificationStore';
import Constants from 'expo-constants';
import { config } from '../constants/config';
import { haptics } from '../utils/haptics';
import { getExpoProjectId } from '../utils/notifications';

// NOTE: setNotificationHandler is called once in index.ts (module-level, before
// any component renders). Do NOT duplicate it here — it causes race conditions.

// Module-level refs to avoid registering listeners more than once
let _foregroundSub: Notifications.Subscription | null = null;
let _responseSub: Notifications.Subscription | null = null;
let _initialized = false;

function isPhysicalDevice(): boolean {
  // Use Constants as a fallback to avoid native module dependency crashes
  // @ts-ignore
  return Constants.isDevice !== false;
}

/**
 * Lazy auth-state accessor to break circular dependency:
 * authStore -> NotificationService -> authStore
 */
function getAuthUser(): { id?: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useAuthStore } = require('../store/authStore');
  return useAuthStore.getState().user ?? null;
}

export class NotificationService {
  /**
   * Request permissions, configure channels, get push token, and register listeners.
   * Safe to call multiple times — will only run once.
   */
  static async initialize(): Promise<boolean> {
    if (_initialized) return true;

    try {
      if (!isPhysicalDevice()) {
        return false;
      }

      // ── 1. Request permissions ──────────────────────────────────────
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== 'granted') {
        // iOS: request alert + sound + badge + provisional (quiet delivery)
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        return false;
      }

      // ── 2. Android channel ──────────────────────────────────────────
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Zica Bella',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#000000',
        showBadge: true,
        // null = system default; a string is treated as a bundled custom sound filename
        sound: null,
      });

      // ── 3. Get push tokens and register with backend ─────────────────
      try {
        let expoToken: string | undefined;
        let deviceToken: string | undefined;

        // Fetch Expo token if we have a project ID
        const projectId = getExpoProjectId();
        if (projectId && projectId !== 'your-eas-project-id') {
          try {
            const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
            expoToken = tokenData?.data;
          } catch (_expoErr) {
            // Non-fatal
          }
        }



        const primaryToken = expoToken || deviceToken;
        if (primaryToken) {
          useNotificationStore.getState().setPushToken(primaryToken);
          await this.registerDevice(expoToken, deviceToken);
        }
      } catch (_tokenErr) {
        // Non-fatal — app still works, just won't receive remote pushes
      }

      // ── 4. Foreground received listener ─────────────────────────────
      // Remove any stale subscription before registering a new one
      try {
        _foregroundSub?.remove();
      } catch (e) {
        console.warn('Failed to remove stale foreground notification listener:', e);
      }
      _foregroundSub = Notifications.addNotificationReceivedListener((notification) => {
        haptics.success();
        const { title, body, data } = notification.request.content;
        const id = String(notification.request.identifier || Date.now()).trim();
        useNotificationStore.getState().addNotification({
          id,
          title: title || 'Zica Bella',
          body: body || '',
          date: new Date().toISOString(),
          isRead: false,
          data: (data as Record<string, string>) || {},
        });
        // Update badge
        const unread = useNotificationStore.getState().unreadCount();
        Notifications.setBadgeCountAsync(unread).catch(() => {});
      });

      // ── 5. Response listener (notification tapped) ───────────────────
      try {
        _responseSub?.remove();
      } catch (e) {
        console.warn('Failed to remove stale notification response listener:', e);
      }
      _responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const { title, body, data } = response.notification.request.content;
        const notifData = data as Record<string, string>;
        const id = String(response.notification.request.identifier).trim();

        // Ensure the notification is in our store (especially for background ones)
        useNotificationStore.getState().addNotification({
          id,
          title: title || 'Zica Bella',
          body: body || '',
          date: new Date().toISOString(),
          isRead: true, // It was tapped, so mark as read
          data: notifData || {},
        });

        // Navigate
        this.handleDeepLink(notifData);
      });

      // ── 6. Sync badge with current unread count ───────────────────────
      const unread = useNotificationStore.getState().unreadCount();
      await Notifications.setBadgeCountAsync(unread);

      _initialized = true;
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Register the device token + userId with the backend so admin
   * dashboard can send targeted pushes.
   */
  static async registerDevice(expoToken?: string, deviceToken?: string, forceUserId?: string) {
    const user = getAuthUser();
    const userId = forceUserId || user?.id;

    // Use values from store as fallback if not provided
    const storedToken = useNotificationStore.getState().pushToken;
    const finalExpoToken = expoToken || (storedToken?.startsWith('ExponentPushToken') ? storedToken : undefined);
    const finalDeviceToken = deviceToken || (storedToken && !storedToken.startsWith('ExponentPushToken') ? storedToken : undefined);

    const primaryToken = finalExpoToken || finalDeviceToken;
    if (!primaryToken) {
      return;
    }

    try {
      // Use userId if available, otherwise fallback to device-only registration
      const deviceId = userId ? `dev_android_${userId}` : `guest_android_${Constants.sessionId || Date.now()}`;
      const tokenType = finalExpoToken ? 'expo' : 'apns';

      // Register with the existing detailed endpoint
      const response = await fetch(`${config.appUrl}/api/notifications/register-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          deviceId,
          fcmToken: primaryToken,        // Backward-compatible legacy field name.
          expoPushToken: finalExpoToken,
          apnsToken: finalDeviceToken,
          deviceToken: finalDeviceToken,
          pushToken: primaryToken,
          token: primaryToken,
          tokenType,
          pushProvider: tokenType,
          platform: Platform.OS,
          appVersion: Constants.expoConfig?.version || '1.0.0',
        }),
      });

      // Also register with the simplified push-token endpoint
      if (userId) {
        await fetch(`${config.appUrl}/api/push-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            token: primaryToken,
            expoPushToken: finalExpoToken,
            apnsToken: finalDeviceToken,
            tokenType,
            pushProvider: tokenType,
            platform: Platform.OS,
          }),
        }).catch(() => {});
      }

      if (!response.ok) {
        // Registration failed — non-fatal, will retry on next launch
      }
    } catch (_e) {
      // Network error — non-fatal
    }
  }

  /**
   * Navigate to the relevant screen based on notification payload.
   * Delayed 500ms so the navigation container has time to mount on cold start.
   */
  static handleDeepLink(data?: Record<string, string>) {
    if (!data) return;

    const { type, id, orderId, productHandle } = data;
    const { navigationRef } = require('../navigation/navigationUtils');

    setTimeout(() => {
      if (!navigationRef.isReady()) return;

      switch (type) {
        case 'order':
        case 'order_update':
        case 'cod_confirmation':
          if (orderId || id) {
            navigationRef.navigate('Main', {
              screen: 'OrdersTab',
            });
            // Small extra delay to let the tab settle
            setTimeout(() => {
              navigationRef.navigate('OrderDetails', { orderId: orderId || id });
            }, 200);
          } else {
            navigationRef.navigate('Main', { screen: 'OrdersTab' });
          }
          break;
        case 'promo':
        case 'product':
          navigationRef.navigate('ProductDetail', { handle: productHandle || id });
          break;
        case 'start_live_activity':
        case 'live_activity_update':
          navigationRef.navigate('Main', { screen: 'OrdersTab' });
          break;
        default:
          // Generic — just open app to home
          navigationRef.navigate('Main', { screen: 'HomeTab' });
          break;
      }
    }, 500);
  }

  /**
   * Re-register after login (token already obtained, just need userId).
   */
  static async onLogin(userId: string) {
    await this.registerDevice(undefined, userId);
  }

  /**
   * Reset initialization state (call on logout so next login re-registers).
   */
  static reset() {
    _initialized = false;
  }
}
