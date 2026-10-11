/**
 * Rate-limit noisy console.warn/error lines (e.g. config failures that repeat every request).
 * Returns true if the caller should log this time.
 */
const lastLogged = new Map<string, number>();

export function shouldLogThrottled(key: string, intervalMs = 60_000): boolean {
  const now = Date.now();
  const prev = lastLogged.get(key) || 0;
  if (now - prev < intervalMs) return false;
  lastLogged.set(key, now);
  return true;
}
