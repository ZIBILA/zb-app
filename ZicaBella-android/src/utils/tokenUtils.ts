import { Alert } from 'react-native';
import { useAuthStore } from '../store/authStore';

/**
 * Robust base64 decoder that works reliably across iOS / Android / Hermes.
 */
function decodeBase64(input: string): string {
  if (typeof atob === 'function') {
    try {
      return atob(input);
    } catch (_) {}
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) {
    throw new Error('Invalid base64 string');
  }
  for (let bc = 0, bs = 0, buffer, idx = 0; (buffer = str.charAt(idx++)); ) {
    const charIndex = chars.indexOf(buffer);
    if (~charIndex) {
      bs = bc % 4 ? bs * 64 + charIndex : charIndex;
      if (bc++ % 4) {
        output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
      }
    }
  }
  return output;
}

/**
 * Checks whether a given JWT access token is expired or invalid.
 */
export function isTokenExpired(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return true;
  if (token === 'demo_token_123') return false; // Bypass for demo testing mode
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decodedStr = decodeBase64(base64);
    const payload = JSON.parse(decodedStr);
    if (typeof payload.exp !== 'number') return false;
    // Buffer by 30 seconds to catch tokens near expiry
    return Date.now() >= (payload.exp * 1000 - 30000);
  } catch {
    return true;
  }
}

/**
 * Checks whether the current user has a valid active session.
 * If expired, it automatically clears auth in store.
 */
export function checkAuthSession(): boolean {
  const { token, isAuthenticated, logout } = useAuthStore.getState();
  if (!isAuthenticated || !token) return false;
  if (isTokenExpired(token)) {
    logout();
    return false;
  }
  return true;
}

/**
 * Enforces valid authentication before continuing with checkout.
 * If the user's token is missing or expired:
 * 1. Logs out the expired session.
 * 2. Alerts the user with a friendly, clear message ("Session Expired").
 * 3. Redirects them to the Auth screen.
 *
 * Returns `true` if session is valid, `false` otherwise.
 */
export function requireValidAuth(navigation: any, options?: { promptMessage?: string }): boolean {
  const { token, isAuthenticated, logout } = useAuthStore.getState();
  const expired = !token || isTokenExpired(token);

  if (!isAuthenticated || expired) {
    if (isAuthenticated || token) {
      logout();
    }
    Alert.alert(
      'Session Expired',
      options?.promptMessage || 'Your session has expired. Please sign in again to continue with checkout.',
      [
        {
          text: 'Sign In',
          onPress: () => {
            if (navigation) {
              navigation.navigate('Auth');
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
    return false;
  }
  return true;
}

/**
 * Checks whether an error represents an unauthorized or expired session error.
 */
export function isUnauthorizedError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || error || '').toLowerCase();
  return (
    error.status === 401 ||
    error.statusCode === 401 ||
    msg.includes('unauthorized') ||
    msg.includes('session expired') ||
    msg.includes('token revoked') ||
    msg.includes('token expired') ||
    msg.includes('invalid token')
  );
}

/**
 * Handles 401 / Unauthorized API errors across checkout screens.
 * Clears the stale token and redirects the user to the Auth screen with a clean message.
 */
export function handleAuthError(navigation: any, customMessage?: string) {
  useAuthStore.getState().logout();
  Alert.alert(
    'Session Expired',
    customMessage || 'Your login session has expired. Please sign in again to complete your order.',
    [
      {
        text: 'Sign In',
        onPress: () => {
          if (navigation) {
            navigation.navigate('Auth');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]
  );
}
