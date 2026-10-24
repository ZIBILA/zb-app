export const AWB_LOCK_MESSAGE =
  'This order already has an AWB / tracking number, so address, phone, and size can no longer be changed. Please contact human support if you need a shipment hold or RTO.';

function digitsOnly(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export function indianMobileOk(phone: string): boolean {
  const d = digitsOnly(phone);
  const last10 = d.slice(-10);
  return last10.length === 10 && /^[6-9]/.test(last10);
}

export function pinOk(zip: string): boolean {
  return /^\d{6}$/.test(String(zip || '').replace(/\s/g, ''));
}

export function normalizeSize(size: string): string {
  return String(size || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** True when AWB is assigned or booking is pending — destination edits must stop. */
export function isAwbLocked(awb?: string | null, awbPending?: boolean): boolean {
  return Boolean(String(awb || '').trim()) || Boolean(awbPending);
}
