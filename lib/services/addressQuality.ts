/**
 * Address check shown next to Logistics Command, to catch incomplete or wrong addresses before the AWB (RTO
 * prevention).
 *
 * What Shiprocket actually provides (checked against its API documentation, Nov 2026): the standard API this app
 * uses (apiv2.shiprocket.in/v1/external) returns NO address-quality score. Shiprocket's address score belongs to a
 * separate product, Shiprocket Sense (Address Score / Address Verification API), which needs its own onboarding via
 * console.shiprocket.in / integration@shiprocket.com. Until that is enabled no percentage is shown, because a
 * made-up number would be worse than none.
 *
 * So the rating is built only from facts we can check:
 *  - Shiprocket serviceability for the pincode (can any courier deliver; is COD available there)
 *  - India Post's pincode directory (does the pincode exist; do its district / state match the address)
 *  - completeness of the address itself (house / flat number, street length, city, state, name, mobile)
 * Rating: Poor = something that will stop or likely fail delivery; Good = only minor gaps; Excellent = all checks pass.
 */
import { normalizeOrderShippingAddress } from '@/lib/order-shipping-address';
import { indianMobileOk, pinOk } from '@/lib/services/aiSupportMutationRules';

export type CheckLevel = 'pass' | 'warn' | 'fail';
export interface AddressCheck {
  id: string;
  label: string;
  level: CheckLevel;
  detail?: string;
}
export interface AddressQualityResult {
  rating: 'poor' | 'good' | 'excellent';
  checks: AddressCheck[];
  /** Shiprocket Sense score (0-100) — only when Shiprocket returns one; never estimated. */
  shiprocketScore: number | null;
  sources: string[];
  address: { name: string; phone: string; address1: string; address2: string; city: string; state: string; pincode: string };
  checkedAt: string;
}

type PincodeInfo = { valid: boolean; districts: string[]; states: string[]; offices: string[] } | null;

const pinCache = new Map<string, { at: number; info: PincodeInfo }>();
const PIN_CACHE_MS = 24 * 60 * 60 * 1000;

/** India Post pincode directory (public, no key). Null when it cannot be reached (the check is then skipped). */
async function lookupIndiaPostPincode(pin: string): Promise<PincodeInfo> {
  const hit = pinCache.get(pin);
  if (hit && Date.now() - hit.at < PIN_CACHE_MS) return hit.info;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const body: any = await res.json();
    const entry = Array.isArray(body) ? body[0] : null;
    if (!entry) return null;
    const offices: any[] = entry.Status === 'Success' && Array.isArray(entry.PostOffice) ? entry.PostOffice : [];
    const info: PincodeInfo = {
      valid: offices.length > 0,
      districts: Array.from(new Set(offices.map((o) => String(o.District || '').trim()).filter(Boolean))),
      states: Array.from(new Set(offices.map((o) => String(o.State || '').trim()).filter(Boolean))),
      offices: Array.from(new Set(offices.map((o) => String(o.Name || '').trim()).filter(Boolean))),
    };
    pinCache.set(pin, { at: Date.now(), info });
    if (pinCache.size > 5000) pinCache.clear();
    return info;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
/** Loose match: "Gautam Buddha Nagar" ~ "GAUTAM BUDDHA NAGAR", "Kolkata" ~ "Kolkata North"... */
const looselyMatches = (a: string, list: string[]) => {
  const x = norm(a);
  if (!x) return false;
  return list.some((l) => {
    const y = norm(l);
    return y && (x.includes(y) || y.includes(x));
  });
};

export async function checkOrderAddress(order: {
  shippingAddress?: string | null;
  customer?: { name?: string | null; phone?: string | null; email?: string | null } | null;
  paymentMethod?: string | null;
  totalPrice?: number | null;
  codUpfrontPaid?: number | null;
}): Promise<AddressQualityResult> {
  const a = normalizeOrderShippingAddress(order.shippingAddress, {
    name: order.customer?.name,
    phone: order.customer?.phone,
    email: order.customer?.email,
  });
  const checks: AddressCheck[] = [];
  const sources = ['Address completeness'];
  const street = [a.address1, a.address2].filter(Boolean).join(', ');

  // ── Completeness ──
  checks.push(
    a.name && a.name.length >= 3 && !/^(customer|guest user|valued customer)$/i.test(a.name)
      ? { id: 'name', label: 'Recipient name', level: 'pass' }
      : { id: 'name', label: 'Recipient name', level: 'warn', detail: 'Missing or placeholder name' }
  );
  checks.push(
    indianMobileOk(a.phone)
      ? { id: 'phone', label: 'Mobile number', level: 'pass' }
      : { id: 'phone', label: 'Mobile number', level: 'fail', detail: 'Not a valid 10-digit Indian mobile — the courier cannot call' }
  );
  if (!street || street.length < 10) {
    checks.push({ id: 'street', label: 'Street address', level: 'fail', detail: 'Street address is missing or too short' });
  } else if (street.length < 20) {
    checks.push({ id: 'street', label: 'Street address', level: 'warn', detail: 'Street address is very short' });
  } else {
    checks.push({ id: 'street', label: 'Street address', level: 'pass' });
  }
  checks.push(
    /\d/.test(street)
      ? { id: 'house', label: 'House / flat number', level: 'pass' }
      : { id: 'house', label: 'House / flat number', level: 'warn', detail: 'No house, flat or building number found' }
  );
  checks.push(
    a.city ? { id: 'city', label: 'City', level: 'pass' } : { id: 'city', label: 'City', level: 'fail', detail: 'City is missing' }
  );
  checks.push(
    a.province ? { id: 'state', label: 'State', level: 'pass' } : { id: 'state', label: 'State', level: 'warn', detail: 'State is missing' }
  );

  // ── Pincode: India Post directory ──
  const pin = String(a.zip || '').replace(/\s/g, '');
  if (!pinOk(pin)) {
    checks.push({ id: 'pincode', label: 'Pincode', level: 'fail', detail: 'Not a 6-digit pincode' });
  } else {
    const info = await lookupIndiaPostPincode(pin);
    if (info) {
      sources.push('India Post pincode directory');
      if (!info.valid) {
        checks.push({ id: 'pincode', label: 'Pincode exists', level: 'fail', detail: `${pin} is not a valid Indian pincode` });
      } else {
        checks.push({ id: 'pincode', label: 'Pincode exists', level: 'pass', detail: `${info.districts.join(' / ')}, ${info.states.join(' / ')}` });
        if (a.province && info.states.length && !looselyMatches(a.province, info.states)) {
          checks.push({ id: 'pin_state', label: 'Pincode matches state', level: 'fail', detail: `${pin} is in ${info.states.join(' / ')}, the address says ${a.province}` });
        } else if (a.province) {
          checks.push({ id: 'pin_state', label: 'Pincode matches state', level: 'pass' });
        }
        if (a.city && info.districts.length) {
          const cityOk = looselyMatches(a.city, info.districts) || looselyMatches(a.city, info.offices) || looselyMatches(street, info.districts);
          checks.push(
            cityOk
              ? { id: 'pin_city', label: 'Pincode matches city', level: 'pass' }
              : { id: 'pin_city', label: 'Pincode matches city', level: 'warn', detail: `${pin} is in ${info.districts.join(' / ')}, the address says ${a.city}` }
          );
        }
      }
    }

    // ── Pincode: Shiprocket serviceability ──
    try {
      const isCod = /cod|cash/i.test(String(order.paymentMethod || ''));
      const { checkShiprocketPincode } = await import('@/lib/services/logistics');
      const sr = await checkShiprocketPincode(pin, {
        cod: isCod,
        codAmount: isCod ? Math.max(0, Number(order.totalPrice || 0) - Number(order.codUpfrontPaid || 0)) : 0,
      });
      if (sr) {
        sources.push('Shiprocket serviceability');
        checks.push(
          sr.serviceable
            ? { id: 'sr_service', label: 'Shiprocket can deliver here', level: 'pass', detail: `${sr.courierCount} courier${sr.courierCount === 1 ? '' : 's'}` }
            : { id: 'sr_service', label: 'Shiprocket can deliver here', level: 'fail', detail: sr.message || 'No courier serves this pincode' }
        );
        if (isCod && sr.serviceable) {
          checks.push(
            sr.codAvailable
              ? { id: 'sr_cod', label: 'Cash on Delivery available', level: 'pass' }
              : { id: 'sr_cod', label: 'Cash on Delivery available', level: 'fail', detail: 'No courier collects cash at this pincode' }
          );
        }
      }
    } catch (err: any) {
      checks.push({ id: 'sr_service', label: 'Shiprocket can deliver here', level: 'warn', detail: `Could not check: ${String(err?.message || err).slice(0, 120)}` });
    }
  }

  const rating = checks.some((c) => c.level === 'fail') ? 'poor' : checks.some((c) => c.level === 'warn') ? 'good' : 'excellent';
  return {
    rating,
    checks,
    shiprocketScore: null,
    sources,
    address: { name: a.name, phone: a.phone, address1: a.address1, address2: a.address2 || '', city: a.city, state: a.province, pincode: pin },
    checkedAt: new Date().toISOString(),
  };
}
