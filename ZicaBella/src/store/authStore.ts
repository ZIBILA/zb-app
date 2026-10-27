import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureStorage } from '../utils/secureStorage';
// NOTE: NotificationService is intentionally NOT imported at top-level to break
// the circular dependency:  authStore -> NotificationService -> authStore
// Instead it is lazily required inside the login() action.

interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  image?: string;
  isCommunityMember?: boolean;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  biometricEnabled: boolean;
  rememberMe: boolean;

  login: (user: User, token: string, refreshToken?: string | null) => void;
  /** Clears auth only — keeps cart/wishlist (session expiry, re-login). */
  softLogout: () => void;
  logout: () => void;
  setTokens: (token: string, refreshToken?: string | null) => void;
  setBiometric: (enabled: boolean) => void;
  setRememberMe: (enabled: boolean) => void;
  updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      biometricEnabled: false,
      rememberMe: false,

      login: (user, token, refreshToken = null) => {
        set({
          user,
          token,
          refreshToken: refreshToken || null,
          isAuthenticated: true,
        });
        // Lazy require to avoid circular module dependency.
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { NotificationService } = require('../services/NotificationService');
          NotificationService.registerDevice(undefined, user.id);

          // Also sync wishlist & cart
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useWishlistStore } = require('./wishlistStore');
          useWishlistStore.getState().syncWishlist(token);
          
          // Sync cart
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useCartStore } = require('./cartStore');
          useCartStore.getState().syncWithBackend();
        } catch (_e) {
          // Non-fatal
        }
      },
      setTokens: (token, refreshToken) => {
        set((state) => ({
          token,
          refreshToken:
            refreshToken === undefined ? state.refreshToken : refreshToken,
          isAuthenticated: true,
        }));
      },
      softLogout: () => {
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },
      logout: () => {
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
        });
        try {
          // 1. Clear cart
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useCartStore } = require('./cartStore');
          useCartStore.getState().clearCart();
          useCartStore.setState({ shippingAddress: null });

          // 2. Clear wishlist
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useWishlistStore } = require('./wishlistStore');
          useWishlistStore.getState().clearWishlist();

          // 3. Clear recent products
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useRecentStore } = require('./recentStore');
          useRecentStore.getState().clearRecent();

          // 4. Clear notifications
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useNotificationStore } = require('./notificationStore');
          useNotificationStore.getState().clearAll();
          useNotificationStore.setState({ pushToken: null });

          // 5. Reset notification service
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { NotificationService } = require('../services/NotificationService');
          NotificationService.reset();
        } catch (_e) {
          // Non-fatal
        }
      },
      setBiometric: (enabled) => set({ biometricEnabled: enabled }),
      setRememberMe: (enabled) => set({ rememberMe: enabled }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user 
            ? { ...state.user, ...updates } 
            : { 
                id: `guest_${Date.now()}`, 
                name: updates.name || '', 
                email: updates.email || '', 
                phone: updates.phone || '',
                isCommunityMember: false
              },
        })),
    }),
    {
      name: 'zicabella-auth-secure',
      // Use iOS Keychain via expo-secure-store instead of AsyncStorage
      storage: createJSONStorage(() => secureStorage),
    }
  )
);
