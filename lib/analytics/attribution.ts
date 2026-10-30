/**
 * Channel classification + order attribution for Omnichannel Analytics (Developer Brief #33).
 * Pure functions — unit-tested, no I/O.
 *
 * Attribution model: LAST NON-DIRECT TOUCH, 7-day lookback.
 *  - Each order is credited to exactly ONE channel: the most recent session from a non-direct source
 *    (ad, email, WhatsApp, search, social, referral…) by the same shopper in the 7 days before the order.
 *  - If the shopper only arrived directly in that window, the order is "Direct".
 *  - If no session can be linked to the order at all, it is "Unattributed" (shown, never guessed).
 *  So when several channels touch the same order, it is counted once — revenue never double-counts.
 */

export const ATTRIBUTION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export const CHANNELS = [
  'Meta Ads',
  'Snapchat Ads',
  'Google Ads',
  'Organic Search',
  'Organic Social',
  'WhatsApp',
  'Email',
  'SMS',
  'Push Notifications',
  'Affiliate',
  'Referral',
  'Direct',
] as const;
export type Channel = (typeof CHANNELS)[number] | 'Unattributed';

/** Channel groups plotted on the traffic chart (fixed entities, so colors never move between ranges). */
export const CHANNEL_GROUPS: Record<Channel, 'Paid social' | 'Search' | 'Owned messaging' | 'Direct & other'> = {
  'Meta Ads': 'Paid social',
  'Snapchat Ads': 'Paid social',
  'Google Ads': 'Search',
  'Organic Search': 'Search',
  WhatsApp: 'Owned messaging',
  Email: 'Owned messaging',
  SMS: 'Owned messaging',
  'Push Notifications': 'Owned messaging',
  'Organic Social': 'Direct & other',
  Affiliate: 'Direct & other',
  Referral: 'Direct & other',
  Direct: 'Direct & other',
  Unattributed: 'Direct & other',
};

export interface TouchSource {
  utmSource?: string | null;
  utmMedium?: string | null;
  referrer?: string | null;
  landingPage?: string | null;
}

const PAID_MEDIUMS = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|cpm|display|ads?|retargeting)$/;
const word = (value: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(value));

function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function queryParam(url: string | null | undefined, name: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'https://zicabella.com').searchParams.get(name);
  } catch {
    return null;
  }
}

export function classifyChannel(touch: TouchSource): Channel {
  const source = String(touch.utmSource || '').trim().toLowerCase();
  const medium = String(touch.utmMedium || '').trim().toLowerCase();
  const refHost = hostOf(touch.referrer);
  const landing = touch.landingPage || '';
  const paid = PAID_MEDIUMS.test(medium);

  // Click ids on the landing URL are definitive for paid traffic.
  if (queryParam(landing, 'gclid') || queryParam(landing, 'gbraid') || queryParam(landing, 'wbraid')) return 'Google Ads';
  if (queryParam(landing, 'ScCid') || queryParam(landing, 'sccid')) return 'Snapchat Ads';
  if (queryParam(landing, 'fbclid') && (paid || word(source, ['fb', 'facebook', 'ig', 'instagram', 'meta']))) return 'Meta Ads';

  if (source || medium) {
    // Whole-word matching: "wa" must not match "wallet", "email" must not match "female".
    if (word(source, ['whatsapp', 'wa']) || word(medium, ['whatsapp'])) return 'WhatsApp';
    if (word(source, ['email', 'newsletter', 'mail', 'klaviyo', 'sendgrid']) || medium === 'email') return 'Email';
    if (word(source, ['sms', 'text']) || medium === 'sms') return 'SMS';
    if (word(source, ['push', 'notification', 'onesignal', 'expo']) || medium === 'push') return 'Push Notifications';
    if (word(source, ['affiliate', 'influencer', 'creator']) || word(medium, ['affiliate', 'influencer', 'referral_link'])) return 'Affiliate';
    if (word(source, ['snapchat', 'snap'])) return paid ? 'Snapchat Ads' : 'Organic Social';
    if (word(source, ['facebook', 'fb', 'instagram', 'ig', 'meta', 'threads'])) return paid ? 'Meta Ads' : 'Organic Social';
    if (word(source, ['google', 'bing', 'yahoo', 'duckduckgo'])) return paid ? 'Google Ads' : 'Organic Search';
    if (word(source, ['youtube', 'twitter', 'x', 'linkedin', 'pinterest', 'reddit', 'tiktok'])) return 'Organic Social';
    // A tagged source we don't recognise is still a real referral, never Direct.
    return 'Referral';
  }

  if (refHost) {
    if (/(^|\.)zicabella\.com$/.test(refHost)) return 'Direct'; // internal navigation
    if (/(^|\.)(google|bing|yahoo|duckduckgo|ecosia)\./.test(refHost)) return 'Organic Search';
    if (/(^|\.)(facebook|instagram|fb|t\.co|twitter|x|linkedin|pinterest|reddit|youtube|snapchat|tiktok|threads)\./.test(`${refHost}.`)) return 'Organic Social';
    if (/(^|\.)(wa\.me|whatsapp\.com|web\.whatsapp\.com)$/.test(refHost)) return 'WhatsApp';
    if (/(mail\.google|outlook|mail\.yahoo)/.test(refHost)) return 'Email';
    return 'Referral';
  }

  if (queryParam(landing, 'ref') || queryParam(landing, 'aff')) return 'Affiliate';
  return 'Direct';
}

export interface AttributionSession extends TouchSource {
  anonymousId?: string | null;
  customerId?: string | null;
  startedAt: Date;
}

export interface AttributionOrder {
  id: string;
  createdAt: Date;
  /** identities known to belong to the buyer (device / analytics ids, customer id) */
  identities: string[];
}

/** One channel per order — see the model at the top of this file. */
export function attributeOrders(
  orders: AttributionOrder[],
  sessions: AttributionSession[],
  lookbackMs = ATTRIBUTION_LOOKBACK_MS
): Map<string, Channel> {
  const byIdentity = new Map<string, AttributionSession[]>();
  for (const s of sessions) {
    for (const key of [s.anonymousId, s.customerId]) {
      if (!key) continue;
      const list = byIdentity.get(key) || [];
      list.push(s);
      byIdentity.set(key, list);
    }
  }

  const result = new Map<string, Channel>();
  for (const order of orders) {
    const orderTime = order.createdAt.getTime();
    const seen = new Set<AttributionSession>();
    const candidates: AttributionSession[] = [];
    for (const id of order.identities) {
      for (const s of byIdentity.get(id) || []) {
        const t = s.startedAt.getTime();
        if (!seen.has(s) && t <= orderTime && t >= orderTime - lookbackMs) {
          seen.add(s);
          candidates.push(s);
        }
      }
    }
    if (candidates.length === 0) {
      result.set(order.id, 'Unattributed');
      continue;
    }
    candidates.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const lastNonDirect = candidates.map(classifyChannel).find((c) => c !== 'Direct');
    result.set(order.id, lastNonDirect || 'Direct');
  }
  return result;
}
