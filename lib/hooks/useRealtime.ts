"use client";

import { useEffect } from 'react';

/**
 * Lightweight dashboard sync signal without WebSockets.
 * Dispatches `realtime-sync` on an interval and when the tab becomes visible.
 * Keep this infrequent — listeners often trigger heavy Shopify/DB fetches.
 */
export function useRealtimeSync(intervalMs = 60_000) {
  useEffect(() => {
    let lastSyncTime = Date.now();

    const triggerSync = (isVisibilityTrigger = false) => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      const now = Date.now();
      // On tab focus, enforce a 30s cooldown to prevent repeated sync stampedes
      if (isVisibilityTrigger && (now - lastSyncTime < 30_000)) {
        return;
      }
      lastSyncTime = now;
      window.dispatchEvent(new CustomEvent("realtime-sync"));
    };

    const intervalId = setInterval(() => triggerSync(false), intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerSync(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs]);
}
