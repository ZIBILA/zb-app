import { create } from 'zustand';
import { config } from '../constants/config';
import { fetchWithTimeout } from '../utils/network';

interface AdminState {
  settings: any | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
  fetchSettings: (force?: boolean) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  settings: null,
  loading: false,
  error: null,
  lastFetched: null,

  fetchSettings: async (force = false) => {
    const { lastFetched, loading } = get();
    const now = Date.now();
    
    // Cache for 5 minutes unless forced
    if (!force && lastFetched && (now - lastFetched < 300000) && get().settings) {
      return;
    }

    if (loading) return;

    set({ loading: true, error: null });

    try {
      // Use the robust fetch with timeout
      const res = await fetchWithTimeout(`${config.appUrl}/api/app/config?t=${now}`, {}, 15000);
      const data = await res.json();
      
      if (data.config) {
        set({ settings: data.config, lastFetched: now, loading: false });
      } else if (!data.error) {
        set({ settings: data, lastFetched: now, loading: false });
      } else {
        throw new Error(data.error || 'Failed to load settings');
      }
    } catch (err: any) {
      // Silent fail for background fetches, only log in dev
      if (__DEV__) {
        console.warn('Admin settings fetch failed (network issues):', err.message);
      }
      set({ error: err.message, loading: false });
    }
  },
}));
