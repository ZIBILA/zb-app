import crypto from 'crypto';
import { toMinorUnits } from './global-pricing-client';

export interface PurchaseSnapshot {
  value: number;
  currency: string;
  order_id: string;
  content_type: 'product';
  content_ids: string[];
  contents: { id: string; quantity: number; item_price: number }[];
  num_items: number;
}

export function orderIsBlocked(order: any): boolean {
  return !order || !!order.cancelledAt || !!order.refundId ||
    /cancel|refund|fail|manual.review/i.test(`${order.status} ${order.paymentStatus}`) ||
    /manual.review/i.test(`${order.tags || ''} ${order.shopifySyncError || ''}`) ||
    /WEBHOOK-RECOVERED-PLACEHOLDER/i.test(JSON.stringify(order.items || [])) ||
    !order.items?.length;
}

export function purchaseSnapshot(order: any): PurchaseSnapshot {
  if (orderIsBlocked(order)) throw new Error('Order is not eligible for Meta Purchase');
  const currency = String(order.currency || '').toUpperCase();
  // Store credit is payment tender. COD value is the accepted order, not its deposit.
  const value = Number(order.totalPrice) + Number(order.storeCreditAmount || 0);
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(value) || value <= 0) throw new Error('Invalid purchase value/currency');
  const contents = order.items.map((item: any) => {
    const raw = String(item.variantId || item.sku || item.productId || '');
    const id = raw.replace(/^variant:/, '').replace(/^gid:\/\/shopify\/ProductVariant\//, '');
    const quantity = Number(item.quantity);
    const item_price = Number(item.price);
    if (!id || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(item_price) || item_price < 0) throw new Error('Invalid purchase contents');
    return { id, quantity, item_price };
  }).sort((a: { id: string; quantity: number; item_price: number }, b: { id: string; quantity: number; item_price: number }) => a.id.localeCompare(b.id) || a.item_price - b.item_price || a.quantity - b.quantity);
  return { value: Math.round(value * 100) / 100, currency, order_id: order.id,
    content_type: 'product', content_ids: contents.map((x: any) => x.id), contents,
    num_items: contents.reduce((n: number, x: any) => n + x.quantity, 0) };
}

export function validateCapturedPayment(row: any, payment: any): boolean {
  return !!row && payment?.status === 'captured' && payment.captured === true &&
    /^pay_[A-Za-z0-9]+$/.test(payment.id || '') && payment.order_id === row.razorpayOrderId &&
    Number.isSafeInteger(Number(payment.amount)) && Number(payment.amount) === row.expectedAmountMinor &&
    payment.currency === row.currency && Number(payment.amount_refunded || 0) === 0;
}

export function snapshotMatchesOrder(snapshot: PurchaseSnapshot, order: any): boolean {
  try {
    const current = purchaseSnapshot(order);
    return toMinorUnits(snapshot.value, snapshot.currency) === toMinorUnits(current.value, current.currency) &&
      snapshot.currency === current.currency && snapshot.order_id === current.order_id &&
      JSON.stringify(snapshot.contents) === JSON.stringify(current.contents);
  } catch { return false; }
}

export const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export function tokenMatches(token: string | undefined, expected: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(tokenHash(token), 'hex'), Buffer.from(expected, 'hex'));
}
