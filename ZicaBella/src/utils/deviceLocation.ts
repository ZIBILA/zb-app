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
    return 'granted';
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === Location.PermissionStatus.GRANTED ? 'granted' : 'denied';
}

/**
 * Fresh GPS fix — avoids last-known/cached network location as the primary source.
 */
export async function getFreshDeviceCoordinates(): Promise<DeviceCoordinates> {
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
    mayShowUserSettingsDialog: Platform.OS === 'android',
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
  };
}
