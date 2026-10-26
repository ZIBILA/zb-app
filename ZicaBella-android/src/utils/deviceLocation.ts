import * as Location from 'expo-location';
import { Platform } from 'react-native';

export type DeviceCoordinates = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

/**
 * Request foreground location permission (Android fine location when available).
 */
export async function requestDeviceLocationPermission(): Promise<'granted' | 'denied'> {
  const { status: existing } = await Location.getForegroundPermissionsAsync();
  if (existing === Location.PermissionStatus.GRANTED) {
    if (Platform.OS === 'android') {
      try {
        await Location.enableNetworkProviderAsync();
      } catch (_) {}
    }
    return 'granted';
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.GRANTED && Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
    } catch (_) {}
  }
  return status === Location.PermissionStatus.GRANTED ? 'granted' : 'denied';
}

/**
 * Fresh GPS fix with high accuracy and fast resolution.
 */
export async function getFreshDeviceCoordinates(): Promise<DeviceCoordinates> {
  if (Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
    } catch (_) {}
  }

  // Fast path: Check if device already has a recent high-accuracy fix (within last 60s, < 35m error)
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 35 });
    if (last?.coords && (last.coords.accuracy === null || last.coords.accuracy <= 50)) {
      return {
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
        accuracy: last.coords.accuracy ?? null,
      };
    }
  } catch (_) {}

  // Fused location provider: balanced satellite + Wi-Fi/cellular for instant lock
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
    mayShowUserSettingsDialog: Platform.OS === 'android',
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
  };
}

/**
 * Native reverse geocoding directly via device OS / Google Play Services.
 */
export async function getNativeReverseGeocode(
  coords: { latitude: number; longitude: number }
): Promise<Location.LocationGeocodedAddress | null> {
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    if (results && results.length > 0) {
      return results[0];
    }
  } catch (e) {
    console.warn('[DeviceLocation] Native reverseGeocodeAsync failed:', e);
  }
  return null;
}
