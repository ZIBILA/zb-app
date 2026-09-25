import crypto from 'crypto';
import prisma from './db';
import { sendCapiEvent } from './metaCapi';
import { requestClientIp } from './client-ip';
import { purchaseSnapshot, snapshotMatchesOrder, tokenHash, tokenMatches, validateCapturedPayment, type PurchaseSnapshot } from './meta-purchase-policy';

export const PURCHASE_COOKIE = 'zb_meta_checkout';
// Keep both transports and uncertain-delivery retries within a conservative dedup window.
// A fresh event ID/time must never be used to force an expired Purchase through.
const MAX_AGE_MS = 47 * 60 * 60 * 1000;

function cookie(req: Request, name: string): string | undefined {
  return req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function checkoutBrowserToken(req: Request): string {
  const existing = cookie(req, PURCHASE_COOKIE);
  return existing && /^[a-f0-9]{64}$/.test(existing) ? existing : crypto.randomBytes(32).toString('hex');
}
export function setPurchaseCookie(response: any, token: string) {
  response.cookies.set(PURCHASE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 86400 });
  return response;
}

export function checkoutUserData(req: Request, address: any): Record<string, string> {
  const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
  const clean = (s: any) => String(s || '').trim().toLowerCase();
  const compact = (s: any) => clean(s).replace(/[^\p{L}\p{N}]/gu, '');
  const data: Record<string, string> = {};
  let country = clean(address.countryCode || address.country);
  country = ({ india: 'in', ind: 'in', 'united states': 'us', usa: 'us' } as Record<string, string>)[country] || country;
  const name = clean(address.name).split(/\s+/);
  let phone = String(address.phone || '').replace(/\D/g, '');
  const dialCodes: Record<string, string> = { in: '91', us: '1', ca: '1', gb: '44', au: '61', ae: '971' };
  const rawPhone = String(address.phone || '').trim();
  if (!rawPhone.startsWith('+') && dialCodes[country]) {
    if ((country === 'in' || country === 'us' || country === 'ca') && phone.length === 10) phone = dialCodes[country] + phone;
    else if (phone.startsWith('0') && !phone.startsWith('00')) phone = dialCodes[country] + phone.slice(1);
  }
  phone = phone.replace(/^00/, '');
  const values = { em: clean(address.email), ph: phone, fn: compact(name[0]), ln: compact(name.slice(1).join(' ')),
    country: /^[a-z]{2}$/.test(country) ? country : '', st: compact(address.state), ct: compact(address.city), zp: compact(address.zip) };
  for (const [key, value] of Object.entries(values)) if (value) data[key] = hash(value);
  for (const name of ['_fbp', '_fbc']) {
    const value = cookie(req, name);
    if (value && /^fb\.\d+\.\d{13}\.[A-Za-z0-9_-]+$/.test(value) && value.length < 600) data[name.slice(1)] = value;
  }
  const external = cookie(req, 'zb_external_id');
  if (external && external.length < 200) data.external_id = hash(clean(external));
  const ip = requestClientIp(req);
  if (ip) data.client_ip_address = ip;
  const ua = req.headers.get('user-agent');
  if (ua) data.client_user_agent = ua.slice(0, 1000);
  return data;
}

/** Best-effort snapshot for a new checkout. A failed snapshot must not block payment. */
export async function prepareMetaPurchase(req: Request, orderId: string, gateway: { id: string; amount: number; currency: string; live: boolean }, token: string, db: any = prisma) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.id === 'mock_id' || order.razorpayOrderId !== gateway.id) throw new Error('Missing durable checkout order');
  const snapshot = purchaseSnapshot(order);
  if (snapshot.currency !== gateway.currency || !Number.isSafeInteger(gateway.amount) || gateway.amount <= 0) throw new Error('Invalid payment binding');
  const address = JSON.parse(order.shippingAddress || '{}');
  const userData = checkoutUserData(req, address);
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com').origin;
  const data = { razorpayOrderId: gateway.id, expectedAmountMinor: gateway.amount,
    currency: gateway.currency, live: gateway.live, snapshot, userData, browserTokenHash: tokenHash(token),
    eventSourceUrl: `${origin}/orders/${orderId}/confirmation` };
  const existing = await db.metaPurchase.findUnique({ where: { orderId }, select: { status: true, capturedAt: true } });
  if (existing) {
    // A pending checkout can be reused by the existing payment flow. Replace only
    // an unverified attempt; captured/sending/sent rows are immutable evidence.
    if (existing.status === 'awaiting_payment' && !existing.capturedAt) {
      await db.metaPurchase.updateMany({ where: { orderId, status: 'awaiting_payment', capturedAt: null }, data: {
        ...data, verifiedPaymentId: null, status: 'awaiting_payment', attempts: 0, availableAt: new Date(),
        leaseToken: null, leaseExpiresAt: null, sentAt: null, lastError: null, createdAt: new Date(),
      } });
    }
    return;
  }
  try {
    await db.metaPurchase.create({ data: { orderId, ...data } });
  } catch (error: any) {
    // Another checkout request may have created the row between the read and
    // create. Repair only that still-unverified row; do not hide other errors.
    const concurrent = await db.metaPurchase.findUnique({ where: { orderId }, select: { status: true, capturedAt: true } });
    if (!concurrent || concurrent.status !== 'awaiting_payment' || concurrent.capturedAt) throw error;
    await db.metaPurchase.updateMany({ where: { orderId, status: 'awaiting_payment', capturedAt: null }, data: {
      ...data, verifiedPaymentId: null, status: 'awaiting_payment', attempts: 0, availableAt: new Date(),
      leaseToken: null, leaseExpiresAt: null, sentAt: null, lastError: null, createdAt: new Date(),
    } });
  }
}

/** Wallet orders require an actual, order-bound debit, not a client payment-method flag. */
export async function prepareStoreCreditPurchase(req: Request, orderId: string, customerId: string, token: string, db: any = prisma) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.customerId !== customerId || order.paymentMethod !== 'store_credit' || Number(order.totalPrice) !== 0) throw new Error('Invalid wallet order');
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com').origin;
  await db.metaPurchase.upsert({ where: { orderId }, update: {}, create: {
    orderId, expectedAmountMinor: 0, currency: order.currency, live: process.env.NODE_ENV === 'production',
    snapshot: purchaseSnapshot(order), userData: checkoutUserData(req, JSON.parse(order.shippingAddress || '{}')),
    browserTokenHash: tokenHash(token), eventSourceUrl: `${origin}/orders/${orderId}/confirmation`,
  } });
}

export async function confirmStoreCreditPurchase(orderId: string, db: any = prisma): Promise<boolean> {
  const row = await db.metaPurchase.findUnique({ where: { orderId } });
  if (!row || row.razorpayOrderId || row.expectedAmountMinor !== 0) return false;
  if (row.status !== 'awaiting_payment') return row.status !== 'blocked';
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!snapshotMatchesOrder(row.snapshot, order)) return false;
  const credit = Number(order.storeCreditAmount);
  const debit = await db.storeCredit.aggregate({ where: { orderId, customerId: order.customerId, type: 'DEBIT', amount: { lt: 0 } }, _sum: { amount: true }, _max: { createdAt: true } });
  if (credit <= 0 || !debit._max.createdAt || Math.abs(Number(debit._sum.amount || 0) + credit) > 0.01) return false;
  await db.metaPurchase.updateMany({ where: { orderId, status: 'awaiting_payment' }, data: {
    verifiedPaymentId: `credit:${orderId}`, capturedAt: debit._max.createdAt, status: 'pending', availableAt: new Date(),
  } });
  return true;
}

/** Only call with a server-fetched payment or a signature-verified webhook entity. */
export async function recordCapturedPurchase(payment: any, capturedAt = new Date(), db: any = prisma): Promise<string | null> {
  if (!payment?.order_id) return null;
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 300000) throw new Error('Invalid capture time');
  const row = await db.metaPurchase.findUnique({ where: { razorpayOrderId: payment.order_id } });
  if (!row) return null; // Legacy/recovery orders deliberately excluded.
  if (!validateCapturedPayment(row, payment)) throw new Error('Captured payment does not match checkout snapshot');
  // Never reset a sent event, event time, attempts, or a worker lease on a repeated callback.
  if (row.status !== 'awaiting_payment') return row.orderId;
  // Compare the payment binding atomically: checkout reuse may refresh it after
  // the read above. Never attach stale capture proof to the replacement attempt.
  const recorded = await db.metaPurchase.updateMany({ where: {
    orderId: row.orderId, status: 'awaiting_payment', capturedAt: null,
    razorpayOrderId: row.razorpayOrderId, expectedAmountMinor: row.expectedAmountMinor,
    currency: row.currency, live: row.live,
  }, data: { status: 'pending', verifiedPaymentId: payment.id, capturedAt, availableAt: new Date() } });
  return recorded.count === 1 ? row.orderId : null;
}

async function eligible(row: any, db: any): Promise<boolean> {
  if (!row?.capturedAt || !row.verifiedPaymentId || (!row.live && !process.env.META_TEST_EVENT_CODE)) return false;
  if (Date.now() - new Date(row.capturedAt).getTime() >= MAX_AGE_MS) return false;
  const order = await db.order.findUnique({ where: { id: row.orderId }, include: { items: true } });
  // Existing checkout reuse can rebind a pending order. Do not advertise a stale attempt.
  if (row.razorpayOrderId && order?.razorpayOrderId !== row.razorpayOrderId) return false;
  if (!snapshotMatchesOrder(row.snapshot as PurchaseSnapshot, order)) return false;
  const credit = Number(order.storeCreditAmount || 0);
  if (credit > 0) {
    const debit = await db.storeCredit.aggregate({ where: { orderId: row.orderId, customerId: order.customerId, type: 'DEBIT', amount: { lt: 0 } }, _sum: { amount: true } });
    if (Math.abs(Number(debit._sum.amount || 0) + credit) > 0.01) return false;
  }
  return true;
}

/** Atomic lease + stable event ID/time gives at-least-once delivery with Meta deduplication. */
export async function dispatchMetaPurchase(orderId: string, db: any = prisma, send = sendCapiEvent): Promise<string> {
  const now = new Date();
  const lease = crypto.randomUUID();
  const claimed = await db.metaPurchase.updateMany({ where: { orderId, availableAt: { lte: now },
    OR: [{ status: 'pending' }, { status: 'sending', leaseExpiresAt: { lt: now } }] },
    data: { status: 'sending', leaseToken: lease, leaseExpiresAt: new Date(Date.now() + 60000), attempts: { increment: 1 } } });
  if (!claimed.count) return 'not_claimed';
  const row = await db.metaPurchase.findUnique({ where: { orderId } });
  const finish = (data: any) => db.metaPurchase.updateMany({ where: { orderId, leaseToken: lease, status: 'sending' }, data: { ...data, leaseToken: null, leaseExpiresAt: null } });
  try {
    if (!(await eligible(row, db))) {
      // A wallet debit/order update can still be in flight. Keep retrying until expiry.
      if (!row.capturedAt || Date.now() - new Date(row.capturedAt).getTime() >= MAX_AGE_MS || (!row.live && !process.env.META_TEST_EVENT_CODE)) {
        await finish({ status: 'blocked', lastError: 'ineligible_or_expired' });
        return 'blocked';
      }
      await finish({ status: 'pending', availableAt: new Date(Date.now() + 60000), lastError: 'order_not_ready' });
      return 'pending';
    }
    const result = await send({ eventName: 'Purchase', eventId: row.orderId,
      eventTime: Math.floor(new Date(row.capturedAt).getTime() / 1000), eventSourceUrl: row.eventSourceUrl,
      userAgent: row.userData.client_user_agent || '', userData: row.userData,
      customData: row.snapshot, actionSource: 'website' });
    if (result.success) {
      await finish({ status: 'sent', sentAt: new Date(), lastError: null });
      return 'sent';
    }
    throw new Error('meta_not_accepted');
  } catch {
    const delay = Math.min(3600000, 1000 * 2 ** Math.min(row.attempts, 12));
    await finish({ status: 'pending', availableAt: new Date(Date.now() + delay), lastError: 'delivery_failed' });
    return 'pending';
  }
}

export async function browserPurchase(req: Request, orderId: string, db: any = prisma) {
  const row = await db.metaPurchase.findUnique({ where: { orderId } });
  if (!row || !tokenMatches(cookie(req, PURCHASE_COOKIE), row.browserTokenHash)) return null;
  if (!['pending', 'sending', 'sent'].includes(row.status) || !(await eligible(row, db))) return null;
  // Avoid emitting a late browser duplicate after Meta's deduplication window.
  if (Date.now() - new Date(row.capturedAt).getTime() > 47 * 3600000) return null;
  return { eventId: row.orderId, customData: row.snapshot, serverStatus: row.status };
}
