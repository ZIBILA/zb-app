// API client for the admin dashboard backend proxy
// All requests go through the admin dashboard — no direct Shopify API calls

import { config } from '../constants/config';
import { useAuthStore } from '../store/authStore';

const API_BASE = `${config.appUrl}/api/app`;

const inflightRequests: Record<string, Promise<any> | undefined> = {};

/** Single-flight refresh so parallel 401s don't rotate the refresh token twice. */
let refreshInflight: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;

  refreshInflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      // Yield before the token check so `finally` always runs after `refreshInflight` is assigned.
      await Promise.resolve();
      const { refreshToken } = useAuthStore.getState();
      if (!refreshToken) return false;

      const res = await fetch(`${config.appUrl}/api/auth/mobile-refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      });

      if (!res.ok) return false;

      const json = await res.json().catch(() => null);
      if (!json?.token) return false;

      useAuthStore.getState().setTokens(json.token, json.refreshToken || refreshToken);
      if (json.user) {
        // Refresh returns a slim user — merge so fields like image/isCommunityMember survive.
        useAuthStore.setState(state => ({
          user: { ...state.user, ...json.user },
          isAuthenticated: true,
        }));
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      refreshInflight = null;
    }
  })();

  return refreshInflight;
}

export async function apiFetch<T>(
  endpoint: string,
  options?: { method?: string; body?: any; params?: Record<string, string>; timeoutMs?: number }
): Promise<T> {
  let url = `${API_BASE}${endpoint}`;

  // Append query params
  if (options?.params) {
    const params = options.params;
    const queryString = Object.keys(params)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  // Deduplication logic for GET requests
  const isGet = !options?.method || options.method.toUpperCase() === 'GET';
  const cacheKey = `${url}_${options?.body ? JSON.stringify(options.body) : ''}`;

  const inflight = inflightRequests[cacheKey];
  if (isGet && inflight !== undefined) {
    return inflight;
  }

  const fetchPromise = (async () => {
    const token = useAuthStore.getState().token;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 15000);

    const buildHeaders = (authToken: string | null | undefined): Record<string, string> => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    });

    const fetchOptions: RequestInit = {
      method: options?.method || 'GET',
      headers: buildHeaders(token),
      signal: controller.signal,
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    try {
      // Timeout stays armed until `finally` so 401 refresh/retry fetches are bounded too.
      let response = await fetch(url, fetchOptions);

      // Handle 401 — never wipe the session on public GETs; for mutations try refresh first.
      if (response.status === 401) {
        const reqMethod = (fetchOptions.method || 'GET').toUpperCase();

        if (reqMethod === 'GET') {
          const retryHeaders = { ...fetchOptions.headers } as Record<string, string>;
          delete retryHeaders['Authorization'];
          delete retryHeaders['authorization'];

          const retryRes = await fetch(url, {
            method: reqMethod,
            headers: retryHeaders,
            signal: controller.signal,
          });

          if (retryRes.ok) {
            const contentType = retryRes.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              return await retryRes.json();
            }
          }

          throw new Error('Something went wrong. Please try again.');
        }

        // Authenticated write: refresh + retry once before giving up (no hard logout).
        const refreshed = await tryRefreshAccessToken();
        if (refreshed) {
          const newToken = useAuthStore.getState().token;
          const retryRes = await fetch(url, {
            ...fetchOptions,
            headers: buildHeaders(newToken),
            signal: controller.signal,
          });

          if (retryRes.ok) {
            const contentType = retryRes.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              return await retryRes.json();
            }
          }

          if (retryRes.status !== 401) {
            const errorJson = await retryRes.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(errorJson.error || 'Something went wrong. Please try again.');
          }
        }

        // Soft-clear auth so browsing/cart stay intact; caller can send user to Auth.
        useAuthStore.getState().softLogout();
        throw new Error('Session expired. Please log in again.');
      }

      // Guard against non-JSON responses (e.g. HTML error pages)
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Something went wrong. Please try again.`);
      }

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorJson.error || 'Something went wrong. Please try again.');
      }

      const result = await response.json();
      return result as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. Please check your connection.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (isGet) {
        setTimeout(() => {
          delete inflightRequests[cacheKey];
        }, 500);
      }
    }
  })();

  if (isGet) {
    inflightRequests[cacheKey] = fetchPromise;
  }

  return fetchPromise;
}

// Convenience helpers
export async function apiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  return apiFetch<T>(endpoint, { params });
}

export async function apiPost<T>(endpoint: string, body: any): Promise<T> {
  return apiFetch<T>(endpoint, { method: 'POST', body });
}

export async function apiPatch<T>(endpoint: string, body: any): Promise<T> {
  return apiFetch<T>(endpoint, { method: 'PATCH', body });
}

// Higher-level service helpers
export const serviceApi = {
  returns: {
    /** Submit a return/exchange request for an order */
    create: (body: any) => apiPost('/orders/return', body),
    /** List all returns for a customer */
    list: (customerId: string) => apiGet<any>('/returns', { customerId }),
    /** Get a single return by ID (uses order detail endpoint) */
    get: (id: string) => apiGet(`/returns`, { customerId: id }),
  },
  exchanges: {
    /** Submit an exchange request (same endpoint as returns, action: 'exchange') */
    create: (body: any) => apiPost('/orders/return', body),
    /** List all exchanges for a customer */
    list: (customerId: string) => apiGet<any>('/exchanges', { customerId }),
    /** Get a single exchange by ID */
    get: (id: string) => apiGet(`/exchanges`, { customerId: id }),
  },
};
