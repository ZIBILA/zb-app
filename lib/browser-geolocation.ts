/**
 * Browser geolocation helpers for explicit user-initiated location detection
 * (checkout "Detect my location", etc.).
 *
 * Android Chrome often returns stale network/cell-tower fixes when
 * enableHighAccuracy is false or maximumAge allows cached positions.
 */

export function isAndroidBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export type ExplicitPositionOptions = {
  /** Extra ms beyond the Geolocation API timeout for the outer hard limit */
  hardLimitExtraMs?: number;
};

/**
 * Request a fresh, high-accuracy fix. Prefer GPS over cached network location.
 */
export function getExplicitBrowserPosition(
  options: ExplicitPositionOptions = {}
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('UNSUPPORTED'));
      return;
    }

    const android = isAndroidBrowser();
    const timeoutMs = android ? 15000 : 10000;
    const hardLimitMs = timeoutMs + (options.hardLimitExtraMs ?? 1000);

    const hardTimer = setTimeout(() => {
      reject(new Error('GEO_TIMEOUT'));
    }, hardLimitMs);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(hardTimer);
        resolve(position);
      },
      (err) => {
        clearTimeout(hardTimer);
        reject(err);
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}
