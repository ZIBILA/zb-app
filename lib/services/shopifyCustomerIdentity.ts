/**
 * Shopify customer identity for order creation.
 *
 * Shopify rejects an order whose top-level `email` / `phone` belongs to a
 * different customer than `customer.id` (or than the customer it resolves by
 * phone) with `422 customer.email_address has already been taken` /
 * `customer.phone has already been taken`. Order #ZB81380 failed exactly like
 * that: the local customer carried a numeric Shopify id (created with a
 * placeholder login email) and the shopper typed a different, real email at
 * checkout that already belonged to another Shopify customer.
 *
 * Rules applied here:
 *  - A known Shopify customer (numeric id) is kept as the order's customer; the
 *    checkout email / phone are only sent top-level when they match that
 *    customer's own values, otherwise they go into note attributes.
 *  - Without a usable id, the customer is found by email, then by phone
 *    (verified matches only), then created; a creation conflict falls back to
 *    the searches again, then to an order without a customer object.
 */
import { createCustomer, fetchCustomerById, shopifyFetch } from '@/lib/shopify-admin';
import { toE164 } from '@/lib/shopify-phone';
import { isPlaceholderEmail } from '@/lib/tracking/placeholder-identity';

export type ShopifyCustomerIdentity = {
  shopifyCustomerId: string | null;
  /** Top-level order email (undefined = omit). */
  orderEmail?: string;
  /** Top-level order phone, E.164 (undefined = omit). */
  orderPhone?: string;
  /** Extra note attributes explaining omitted contact fields. */
  noteAttributes: Array<{ name: string; value: string }>;
  /** Human-readable trail for logs. */
  trail: string[];
};

type ShopifyCustomerLite = { id?: number | string; email?: string | null; phone?: string | null };

const norm = (s: string | null | undefined) => String(s || '').trim().toLowerCase();

async function findByEmail(email: string): Promise<ShopifyCustomerLite | null> {
  try {
    const data = await shopifyFetch<{ customers: ShopifyCustomerLite[] }>(
      'customers/search.json',
      { query: `email:${email}`, limit: '5' },
      { ttlMs: 0 }
    );
    return (data?.customers || []).find((c) => norm(c.email) === norm(email)) || null;
  } catch {
    return null;
  }
}

async function findByPhone(phoneE164: string): Promise<ShopifyCustomerLite | null> {
  try {
    const data = await shopifyFetch<{ customers: ShopifyCustomerLite[] }>(
      'customers/search.json',
      { query: `phone:${phoneE164}`, limit: '5' },
      { ttlMs: 0 }
    );
    return (data?.customers || []).find((c) => toE164(String(c.phone || '')) === phoneE164) || null;
  } catch {
    return null;
  }
}

/** Decide which contact fields may ride on the order for a given Shopify customer. */
function contactFieldsFor(
  customer: ShopifyCustomerLite,
  email: string,
  phone: string,
  identity: ShopifyCustomerIdentity
) {
  const custEmail = norm(customer.email);
  const custPhone = toE164(String(customer.phone || ''));
  if (email) {
    if (!custEmail || custEmail === norm(email)) {
      identity.orderEmail = email;
    } else {
      identity.noteAttributes.push({ name: 'checkout_email', value: email });
      identity.trail.push(`checkout email differs from Shopify customer ${customer.id}; sent as note attribute`);
    }
  }
  if (phone) {
    if (!custPhone || custPhone === phone) {
      identity.orderPhone = phone;
    } else {
      identity.noteAttributes.push({ name: 'checkout_phone', value: phone });
      identity.trail.push(`checkout phone differs from Shopify customer ${customer.id}; sent as note attribute`);
    }
  }
}

export async function resolveShopifyCustomerIdentity(input: {
  localShopifyId?: string | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<ShopifyCustomerIdentity> {
  const identity: ShopifyCustomerIdentity = { shopifyCustomerId: null, noteAttributes: [], trail: [] };
  const email = String(input.email || '').trim();
  const emailUsable = Boolean(email && email.includes('@') && !isPlaceholderEmail(email));
  const phone = toE164(String(input.phone || '')) || '';
  const localId = String(input.localShopifyId || '').trim();

  // 1. Known Shopify customer: keep it, send only matching contact fields.
  if (/^\d+$/.test(localId)) {
    const existing = await fetchCustomerById(localId);
    if (existing && existing.id) {
      identity.shopifyCustomerId = String(existing.id);
      contactFieldsFor(existing, emailUsable ? email : '', phone, identity);
      identity.trail.push(`kept Shopify customer ${existing.id}`);
      return identity;
    }
    identity.trail.push(`Shopify customer ${localId} not found; resolving by contact`);
  }

  // 2. Find by email, then by phone (verified matches only).
  if (emailUsable) {
    const byEmail = await findByEmail(email);
    if (byEmail?.id) {
      identity.shopifyCustomerId = String(byEmail.id);
      contactFieldsFor(byEmail, email, phone, identity);
      identity.trail.push(`matched Shopify customer ${byEmail.id} by email`);
      return identity;
    }
  }
  if (phone) {
    const byPhone = await findByPhone(phone);
    if (byPhone?.id) {
      identity.shopifyCustomerId = String(byPhone.id);
      contactFieldsFor(byPhone, emailUsable ? email : '', phone, identity);
      identity.trail.push(`matched Shopify customer ${byPhone.id} by phone`);
      return identity;
    }
  }

  // 3. Create; on a uniqueness conflict re-run the searches, else go customer-less.
  const nameParts = String(input.name || 'Customer').trim().split(/\s+/).filter(Boolean);
  try {
    const created = await createCustomer({
      first_name: nameParts[0] || 'Customer',
      last_name: nameParts.slice(1).join(' ') || '.',
      ...(emailUsable ? { email } : {}),
      ...(phone ? { phone } : {}),
      verified_email: emailUsable,
    });
    if (created?.id) {
      identity.shopifyCustomerId = String(created.id);
      if (emailUsable) identity.orderEmail = email;
      if (phone) identity.orderPhone = phone;
      identity.trail.push(`created Shopify customer ${created.id}`);
      return identity;
    }
  } catch (err: any) {
    const msg = String(err?.message || err);
    identity.trail.push(`customer creation failed: ${msg.slice(0, 160)}`);
    if (/taken/i.test(msg)) {
      const again = emailUsable ? await findByEmail(email) : null;
      const byPhoneAgain = !again && phone ? await findByPhone(phone) : null;
      const found = again || byPhoneAgain;
      if (found?.id) {
        identity.shopifyCustomerId = String(found.id);
        contactFieldsFor(found, emailUsable ? email : '', phone, identity);
        identity.trail.push(`matched Shopify customer ${found.id} after creation conflict`);
        return identity;
      }
    }
  }

  // 4. No customer object: Shopify attaches/creates by email on its own; the phone
  // is left out (a phone that belongs to another customer would fail the order).
  if (emailUsable) identity.orderEmail = email;
  if (phone) identity.noteAttributes.push({ name: 'checkout_phone', value: phone });
  identity.trail.push('no Shopify customer resolved; order sent by email only');
  return identity;
}

export type ShopifySyncErrorKind = 'validation' | 'auth' | 'rate_limit' | 'server' | 'timeout' | 'network' | 'unknown';

/** Classify a sync failure so the stored error says whether a retry can help. */
export function classifyShopifySyncError(err: unknown): { kind: ShopifySyncErrorKind; message: string; retryable: boolean } {
  const message = String((err as any)?.message || err || 'unknown error');
  const status = (() => { const m = message.match(/Shopify API (\d{3})/) || message.match(/\[(\d{3})\]/); return m ? Number(m[1]) : 0; })();
  if (/aborted|timed? ?out|TimeoutError/i.test(message)) return { kind: 'timeout', message, retryable: true };
  if (/ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(message)) return { kind: 'network', message, retryable: true };
  if (status === 429 || /exhausted retries/i.test(message)) return { kind: 'rate_limit', message, retryable: true };
  if (status === 401 || status === 403) return { kind: 'auth', message, retryable: false };
  if (status === 422 || status === 400 || status === 406) return { kind: 'validation', message, retryable: false };
  if (status >= 500) return { kind: 'server', message, retryable: true };
  return { kind: 'unknown', message, retryable: true };
}

/** True for the Shopify 422 that means the order's contact fields clash with its customer. */
export function isContactConflictError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '');
  return /has already been taken/i.test(message) && /(email_address|email|phone)/i.test(message);
}
