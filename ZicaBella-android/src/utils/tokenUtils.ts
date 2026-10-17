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
 * Expired access tokens soft-clear auth (cart kept) so re-login is clean.
 */
export function checkAuthSession(): boolean {
  const { token, isAuthenticated, softLogout } = useAuthStore.getState();
  if (!isAuthenticated || !token) return false;
  if (isTokenExpired(token)) {
    softLogout();
    return false;
  }
  return true;
}

function navigateToAuth(navigation: any) {
  if (!navigation) return;
  try {
    navigation.navigate('Auth');
  } catch (_) {
    // ignore
  }
}

/**
 * Gate for checkout / Buy Now. No popups — guests and expired sessions go
 * straight to the Auth screen.
 *
 * Returns `true` if session is valid, `false` otherwise.
 */
export function requireValidAuth(navigation: any, _options?: { promptMessage?: string }): boolean {
  const { token, isAuthenticated, softLogout } = useAuthStore.getState();
  const expired = !token || isTokenExpired(token);

  if (isAuthenticated && !expired) {
    return true;
  }

  // Expired session: clear auth flags only (keep cart for after re-login)
  if (isAuthenticated || token) {
    softLogout();
  }

  navigateToAuth(navigation);
  return false;
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
 * Soft-clears auth and opens Auth — no alert popup.
 */
export function handleAuthError(navigation: any, _customMessage?: string) {
  useAuthStore.getState().softLogout();
  navigateToAuth(navigation);
}
