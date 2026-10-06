/**
 * Shared demo login credentials for local/dev testing.
 * Use a format-valid Indian mobile so Shiprocket / couriers accept AWB booking
 * during test checkouts. OTP is fixed; never send a real SMS for this number.
 */
export const DEMO_PHONE_LAST10 = '9876543210';
export const DEMO_PHONE_E164 = '+919876543210';
export const DEMO_OTP = '123456';

export function isDemoPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return String(phone).replace(/\D/g, '').slice(-10) === DEMO_PHONE_LAST10;
}
