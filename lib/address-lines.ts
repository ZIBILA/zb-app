/**
 * Builds the single delivery line ("House/Flat, Street/Area, Landmark") stored as `street` / Shopify `address1`.
 *
 * The checkout payload carries both the separate parts (houseNo, street, landmark) and, once composed,
 * the combined line in `street`. Several layers (checkout page, /api/checkout/razorpay, customerService,
 * order normalisation) each compose the line, so composing must be IDEMPOTENT: feeding an already-composed
 * line back in returns it unchanged instead of producing "House, House, Street, Landmark, Landmark".
 *
 * "Already composed" is decided structurally — the line starts with exactly the house part and ends with
 * exactly the landmark part, the shape this function produces. Individual words are never de-duplicated,
 * so legitimate repetition ("Flat 12, Sector 12", "Near Children Hospital, Children Hospital Road") is kept.
 */

export interface AddressLineParts {
  houseNo?: string | null;
  street?: string | null;
  landmark?: string | null;
  apartment?: string | null;
}

const clean = (v: unknown): string => String(v ?? '').trim();

/** Canonical spacing around commas, so "Pahadi Rasoi restaurant , Bidholi" matches "Pahadi Rasoi restaurant, Bidholi". */
const normalizeCommas = (v: string): string => v.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();

export function composeStreetLine(parts: AddressLineParts): string {
  const head = [clean(parts.houseNo)].filter(Boolean);
  const tail = [clean(parts.landmark), clean(parts.apartment)].filter(Boolean);
  const street = clean(parts.street);

  if (street && (head.length > 0 || tail.length > 0) && isComposedLine(street, head, tail)) {
    return street;
  }
  return [...head, street, ...tail].filter(Boolean).join(', ');
}

function isComposedLine(street: string, head: string[], tail: string[]): boolean {
  const s = normalizeCommas(street);
  const h = normalizeCommas(head.join(', '));
  const t = normalizeCommas(tail.join(', '));

  if (h && t) {
    if (s === `${h}, ${t}`) return true; // house + landmark with an empty street part
    return s.startsWith(`${h}, `) && s.endsWith(`, ${t}`) && s.length > h.length + t.length + 4;
  }
  if (h) return s.startsWith(`${h}, `);
  return s.endsWith(`, ${t}`);
}

/**
 * The checkout address with `street` set to the composed delivery line. The separate parts are kept
 * (dashboard / saved-address editing use them); composeStreetLine on the result is a no-op.
 */
export function withComposedStreet<T extends AddressLineParts>(address: T): T & { street: string } {
  return { ...address, street: composeStreetLine(address) || clean(address.street) };
}
