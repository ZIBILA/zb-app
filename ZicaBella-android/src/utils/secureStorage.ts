/**
 * Secure Storage Abstraction
 *
 * This module provides a storage interface for sensitive data.
 * It attempts to use expo-secure-store if the native module is present,
 * but falls back to AsyncStorage to prevent "Cannot find native module" crashes
 * in development environments (simulators, Expo Go, unbuilt dev clients).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

// Safely check if the native module exists without importing the library
const isNativeSecureStoreAvailable = !!(
  NativeModules.ExpoSecureStore || 
  NativeModules.NativeModulesProxy?.ExpoSecureStore
);

/**
 * Zustand-compatible storage adapter.
 */
export const secureStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      if (isNativeSecureStoreAvailable) {
        // Only require the library if the native module is actually present
        const SecureStore = require('expo-secure-store');
        return await SecureStore.getItemAsync(name, {
          // AFTER_FIRST_UNLOCK survives screen lock / brief background; WHEN_UNLOCKED
          // can make reads fail and look like a sudden logout.
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
      }
    } catch (e) {
      // Fallback on any error
    }
    return await AsyncStorage.getItem(`insecure_${name}`);
  },
  
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      if (isNativeSecureStoreAvailable) {
        const SecureStore = require('expo-secure-store');
        await SecureStore.setItemAsync(name, value, {
          // AFTER_FIRST_UNLOCK survives screen lock / brief background; WHEN_UNLOCKED
          // can make reads fail and look like a sudden logout.
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
        return;
      }
    } catch (e) {}
    await AsyncStorage.setItem(`insecure_${name}`, value);
  },
  
  removeItem: async (name: string): Promise<void> => {
    try {
      if (isNativeSecureStoreAvailable) {
        const SecureStore = require('expo-secure-store');
        await SecureStore.deleteItemAsync(name, {
          // AFTER_FIRST_UNLOCK survives screen lock / brief background; WHEN_UNLOCKED
          // can make reads fail and look like a sudden logout.
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
        return;
      }
    } catch (e) {}
    await AsyncStorage.removeItem(`insecure_${name}`);
  },
};
