/**
 * Clean reverse-geocode output into delivery-useful street/locality text.
 * Excludes house/plot numbers (belong in Flat/House field) and admin noise
 * like "Meerut Division" / tehsils. Shared by /api/geo/reverse and web checkout.
 */

const ADMIN_NOISE =
  /\b(division|tehsil|taluk|taluka|mandal|commissionerate|range|circle|zone|subdivision|sub[-\s]?division|revenue\s+district)\b/i;

export function looksLikeHouseOrPlot(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  // Explicit house/plot labels only — keep Sector/Block/Phase as locality
  if (/^(plot|flat|house|shop|apt|apartment|unit|door)\b/i.test(v)) {
    return true;
  }
  if (/^[A-Za-z]?\s*-?\s*\d{1,5}([A-Za-z]|[\/\-]\d+[A-Za-z]?)?$/.test(v)) return true;
  if (/^\d{1,5}[A-Za-z]?([\/\-]\d+[A-Za-z]?)?$/.test(v)) return true;
  return false;
}

export function isAdministrativeNoise(value: string): boolean {
  return ADMIN_NOISE.test(String(value || "").trim());
}

export function buildDeliveryStreet(
  parts: Array<string | null | undefined>
): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of parts) {
    const p = String(raw || "").trim();
    if (!p) continue;
    if (looksLikeHouseOrPlot(p)) continue;
    if (isAdministrativeNoise(p)) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  return out.join(", ");
}

export function stripLeadingHouseFromStreet(street: string): string {
  const parts = String(street || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  while (parts.length > 0 && looksLikeHouseOrPlot(parts[0])) {
    parts.shift();
  }
  return parts.filter((p) => !isAdministrativeNoise(p)).join(", ");
}
