import * as Haptics from 'expo-haptics';

/**
 * Vibration from haptics spikes the accelerometer and can falsely trigger
 * shake-to-open-bag. Callers that listen for shakes should check this window.
 */
let suppressShakeUntil = 0;

function markHapticPulse(ms = 900) {
  suppressShakeUntil = Math.max(suppressShakeUntil, Date.now() + ms);
}

/** True while a recent haptic may still be ringing the accelerometer. */
export function isShakeSuppressedByHaptic(): boolean {
  return Date.now() < suppressShakeUntil;
}

/**
 * Standardized Haptics with try-catch guards to prevent app crashes
 * if native modules are missing (e.g. in development/simulators).
 */
export const haptics = {
  addToCart: () => {
    markHapticPulse(1100);
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch {}
  },
  buttonTap: () => {
    markHapticPulse();
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  },
  success: () => {
    markHapticPulse(1100);
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
  },
  error: () => {
    markHapticPulse(1100);
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
  },
  quantityChange: () => {
    markHapticPulse(600);
    try { Haptics.selectionAsync(); } catch {}
  },
  cartShake: () => {
    markHapticPulse(1100);
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
  },
  tabPress: () => {
    markHapticPulse();
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  },
};
