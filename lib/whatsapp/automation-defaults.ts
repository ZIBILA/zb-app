/**
 * Automations fired by the lifecycle scanner (lib/notifications/whatsapp-events.ts) rather than inline by a
 * webhook. Each needs a Meta-approved template, so they start OFF — an admin switches one on in
 * Dashboard → Marketing → WhatsApp → Automations once its template is approved.
 *
 * Shared by the settings API (what the dashboard shows) and the scanner (what actually runs), so the two can
 * never disagree about a default.
 */
export const SCANNER_TOGGLES_DEFAULT_OFF = [
  'return_confirmed', // Return accepted
  'return_received_enabled',
  'exchange_delivered_enabled',
  'order_cancelled_enabled',
  'refund_initiated_enabled',
  'store_credit_earned_enabled',
  'store_coins_earned_enabled',
];

/** 'true' / 'false' string, as stored in whatsapp_settings. */
export const toggleDefault = (key: string): 'true' | 'false' =>
  SCANNER_TOGGLES_DEFAULT_OFF.includes(key) ? 'false' : 'true';

/** Abandoned-cart reminder delays in minutes: 15 min, 4 hours, 7 days. */
export const CART_RECOVERY_DELAY_DEFAULTS = {
  delay_abandoned_cart_step1: '15',
  delay_abandoned_cart_step2: '240',
  delay_abandoned_cart_step3: '10080',
} as const;
