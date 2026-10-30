import { composeStreetLine } from './address-lines';

/**
 * Normalize shipping address shapes from web checkout, mobile app, Razorpay,
 * and legacy imports into a consistent structure for Shopify sync + dashboard.
 */

export type NormalizedShippingAddress = {
  name: string;
  phone: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  /** Aliases kept for local Order JSON compatibility */
  street: string;
  state: string;
  pincode: string;
};

function asObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') {
        // Double-encoded JSON string
        try {
          const nested = JSON.parse(parsed);
          if (nested && typeof nested === 'object') return nested as Record<string, any>;
        } catch {
          return { address1: parsed };
        }
      }
      if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
      return { address1: trimmed };
    } catch {
      return { address1: trimmed };
    }
  }
  if (typeof raw === 'object') return raw as Record<string, any>;
  return {};
}

/** True when there is no usable street line. */
export function isSparseShippingAddress(raw: unknown): boolean {
  const a = asObject(raw);
  const line = String(
    a.address1 || a.line1 || a.street || [a.houseNo || a.flat, a.street, a.landmark].filter(Boolean).join(', ') || ''
  ).trim();
  return line.length < 3;
}

/**
 * Flatten web (houseNo/street/landmark), mobile (line1/line2/flat), and Shopify-style
 * (address1/address2) fields into one Shopify-ready address.
 */
export function normalizeOrderShippingAddress(
  raw: unknown,
  fallbacks?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  }
): NormalizedShippingAddress {
  let a = asObject(raw);
  // Unwrap accidental nesting
  if (a.shippingAddress && typeof a.shippingAddress === 'object') {
    a = { ...a, ...asObject(a.shippingAddress) };
  }

  const houseNo = String(a.houseNo || a.flat || a.flatNo || a.building || '').trim();
  const rawStreet = String(a.street || '').trim();
  const primaryLine = String(a.address1 || a.line1 || '').trim();
  const landmark = String(a.landmark || a.apartment || '').trim();
  const explicitLine2 = String(a.address2 || a.line2 || '').trim();

  // Web checkout stores the composed "House, Street, Landmark" line in `street` and keeps the parts
  // alongside; composeStreetLine recognises a composed line structurally (exact house prefix +
  // landmark suffix) and never re-adds the parts. Words inside the address are never de-duplicated.
  const address1 = composeStreetLine({ houseNo, street: rawStreet || primaryLine, landmark });

  // A separate second line (mobile line2 / Shopify address2) is kept unless it is exactly the landmark
  // already placed at the end of address1.
  const line2AlreadyInLine1 =
    explicitLine2 === address1 ||
    composeStreetLine({ street: address1, landmark: explicitLine2 }) === address1;
  const address2 = explicitLine2 && !line2AlreadyInLine1 ? explicitLine2 : '';


  const name = String(a.name || fallbacks?.name || '').trim();
  const phone = String(a.phone || a.contact || fallbacks?.phone || '').trim();
  const email = String(a.email || fallbacks?.email || '').trim();
  const city = String(a.city || '').trim();
  const province = String(a.state || a.province || '').trim();
  const zip = String(a.zip || a.pincode || a.zipCode || a.postal_code || '').trim();
  const country = String(a.country || 'India').trim() || 'India';

  return {
    name,
    phone,
    email,
    address1,
    address2,
    city,
    province,
    zip,
    country,
    street: address1,
    state: province,
    pincode: zip,
  };
}

/** Prefer the richer of two addresses (by street length + identity fields). */
export function pickRicherShippingAddress(existingRaw: unknown, incomingRaw: unknown): unknown {
  if (isSparseShippingAddress(incomingRaw)) return existingRaw ?? incomingRaw;
  if (isSparseShippingAddress(existingRaw)) return incomingRaw;

  const existing = normalizeOrderShippingAddress(existingRaw);
  const incoming = normalizeOrderShippingAddress(incomingRaw);

  const existingScore =
    existing.address1.length +
    (existing.name ? 20 : 0) +
    (existing.phone ? 20 : 0) +
    existing.city.length +
    existing.zip.length;
  const incomingScore =
    incoming.address1.length +
    (incoming.name ? 20 : 0) +
    (incoming.phone ? 20 : 0) +
    incoming.city.length +
    incoming.zip.length;

  return incomingScore > existingScore ? incomingRaw : existingRaw;
}
