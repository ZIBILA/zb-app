"use client";

import { useEffect } from 'react';

/**
 * Lightweight dashboard sync signal without WebSockets.
 * Dispatches `realtime-sync` on an interval and when the tab becomes visible.
 * Keep this infrequent — listeners often trigger heavy Shopify/DB fetches.
 */
export function useRealtimeSync(intervalMs = 60_000) {
  useEffect(() => {
    const triggerSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      window.dispatchEvent(new CustomEvent("realtime-sync"));
    };

    const intervalId = setInterval(triggerSync, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs]);
}
