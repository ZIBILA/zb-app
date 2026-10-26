/**
 * Shared demo login credentials for App Store / Play review and local testing.
 * Use a format-valid Indian mobile so Shiprocket / couriers accept AWB booking
 * during test checkouts. OTP is fixed; never send a real SMS for this number.
 *
 * Enabled when:
 * - NODE_ENV !== 'production', OR
 * - ENABLE_DEMO_LOGIN=true (turn on only during store review windows)
 */
export const DEMO_PHONE_LAST10 = '9876543210';
export const DEMO_PHONE_E164 = '+919876543210';
export const DEMO_OTP = '123456';

export function isDemoLoginEnabled(): boolean {
  if (process.env.ENABLE_DEMO_LOGIN === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export function isDemoPhone(phone: string | null | undefined): boolean {
  if (!phone || !isDemoLoginEnabled()) return false;
  return String(phone).replace(/\D/g, '').slice(-10) === DEMO_PHONE_LAST10;
}
