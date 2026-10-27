/**
 * Clean reverse-geocode output into delivery-useful street/locality text.
 * Excludes house/plot numbers (belong in Flat field) and admin noise
 * like "Meerut Division" / tehsils.
 */

const ADMIN_NOISE =
  /\b(division|tehsil|taluk|taluka|mandal|commissionerate|range|circle|zone|subdivision|sub[-\s]?division|revenue\s+district)\b/i;

/** Plot / flat / building tokens that must never land in the street field. */
export function looksLikeHouseOrPlot(value: string): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  // Explicit house/plot labels only — keep Sector/Block/Phase as locality
  if (/^(plot|flat|house|shop|apt|apartment|unit|door)\b/i.test(v)) {
    return true;
  }
  // E 1701, C-49, 12/A, A-12, 1600
  if (/^[A-Za-z]?\s*-?\s*\d{1,5}([A-Za-z]|[\/\-]\d+[A-Za-z]?)?$/.test(v)) return true;
  if (/^\d{1,5}[A-Za-z]?([\/\-]\d+[A-Za-z]?)?$/.test(v)) return true;
  return false;
}

export function isAdministrativeNoise(value: string): boolean {
  return ADMIN_NOISE.test(String(value || '').trim());
}

/** Join unique, delivery-useful locality parts (street, sector, locality). */
export function buildDeliveryStreet(
  parts: Array<string | null | undefined>
): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of parts) {
    const p = String(raw || '').trim();
    if (!p) continue;
    if (looksLikeHouseOrPlot(p)) continue;
    if (isAdministrativeNoise(p)) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  return out.join(', ');
}

/**
 * If a street line accidentally starts with a house/plot token, strip it.
 * e.g. "E 1701, Sector 12" → "Sector 12"
 */
export function stripLeadingHouseFromStreet(street: string): string {
  const parts = String(street || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  while (parts.length > 0 && looksLikeHouseOrPlot(parts[0])) {
    parts.shift();
  }
  return parts.filter((p) => !isAdministrativeNoise(p)).join(', ');
}
