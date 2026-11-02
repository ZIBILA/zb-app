/**
 * Order-confirmation parity for orders the shopper never saw confirmed.
 *
 * /api/checkout/complete is the only path that emails the customer; the webhook
 * and cron paths mark pre-created orders paid silently. When the browser never
 * posts /complete (closed tab, network loss) and the order is confirmed later by
 * a webhook or the reconciliation job, the customer got money taken and no
 * email (2 Nov incident, ZBPP82722). This module sends that same confirmation
 * from the stored order, once:
 *   - `buildOrderConfirmationPayload` is the OrderData builder /complete uses,
 *     so the stored-order email is identical to the checkout one;
 *   - the order is tagged `confirmation_emailed` afterwards, and the email itself
 *     goes through deliverOnce (order number + ORDER_CONFIRMED), so a webhook
 *     retry, a second cron run or a late /complete replay cannot resend it.
 */
import prisma from '@/lib/db';
import { isPaidLikeStatus } from '@/lib/payment-status';
import {
  sendOrderConfirmationEmail,
  sendOrderCodConfirmationEmail,
  type OrderData,
} from '@/lib/services/orderEmailService';

export const CONFIRMATION_EMAILED_TAG = 'confirmation_emailed';

type AddressLike = {
  name?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
} | null | undefined;

type ItemLike = {
  title?: string | null;
  name?: string | null;
  size?: string | null;
  quantity?: unknown;
  price?: unknown;
  image?: string | null;
  productId?: string | number | null;
  variantId?: string | null;
};

/** One-line shipping address, as /complete has always rendered it in the email. */
export function formatShippingAddressLine(address: AddressLike): string {
  const a = address || {};
  return `${a.street || ''}, ${a.city || ''}, ${a.state || ''} - ${a.zip || ''}, ${a.country || 'India'}`;
}

/** The OrderData /api/checkout/complete passes to sendOrderConfirmationEmail. */
export function buildOrderConfirmationPayload(args: {
  orderNumber: string;
  address: AddressLike;
  customerEmailFallback?: string | null;
  customerNameFallback?: string | null;
  items: ItemLike[];
  total: unknown;
  currency?: string | null;
  createdAt: Date | string;
  paymentMethod?: string | null;
  subtotal?: unknown;
  discount?: unknown;
}): OrderData {
  const address = args.address || {};
  return {
    orderId: args.orderNumber,
    customerEmail: address.email || args.customerEmailFallback || '',
    customerName: address.name || args.customerNameFallback || 'Customer',
    items: (args.items || []).map((item) => ({
      name: item.title || item.name || 'Product Item',
      size: item.size || 'N/A',
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      image: item.image || '',
      product_id: item.productId || null,
      variant_title: item.variantId || null,
    })),
    total: Number(args.total) || 0,
    currency: args.currency || 'INR',
    orderDate: new Date(args.createdAt).toLocaleDateString('en-IN', { dateStyle: 'long' }),
    paymentMethod: args.paymentMethod || undefined,
    subtotal: args.subtotal !== undefined && args.subtotal !== null ? Number(args.subtotal) || 0 : Number(args.total) || 0,
    shipping: 0,
    discount: Number(args.discount) || 0,
    shippingAddress: formatShippingAddressLine(address),
  };
}

export function appendOrderTag(tags: string | null | undefined, tag: string): string {
  const list = String(tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!list.includes(tag)) list.push(tag);
  return list.join(', ');
}

export function hasOrderTag(tags: string | null | undefined, tag: string): boolean {
  return String(tags || '')
    .split(',')
    .map((t) => t.trim())
    .includes(tag);
}

export type ConfirmationNoticeResult =
  | { status: 'sent'; orderNumber: string; email: string }
  | { status: 'skipped'; reason: 'not_found' | 'not_paid' | 'already_emailed' | 'not_web_store' | 'placeholder' | 'no_email' }
  | { status: 'failed'; error: string };

/**
 * Email the order confirmation for an order confirmed outside /complete.
 * `source` is recorded in EmailLog.triggerEvent (e.g. 'cron/reconcile-razorpay').
 */
export async function sendConfirmationForReconciledOrder(
  orderId: string,
  source: string
): Promise<ConfirmationNoticeResult> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true },
    });
    if (!order) return { status: 'skipped', reason: 'not_found' };
    if (!isPaidLikeStatus(order.paymentStatus)) return { status: 'skipped', reason: 'not_paid' };
    if (hasOrderTag(order.tags, CONFIRMATION_EMAILED_TAG)) return { status: 'skipped', reason: 'already_emailed' };
    // Native-app orders are confirmed by the app's own flow; only web checkouts
    // rely on /complete for the email.
    if (order.orderType !== 'WEB_STORE') return { status: 'skipped', reason: 'not_web_store' };
    // A recovery placeholder (dummy address, "Unresolved order" line) must not be
    // presented to the customer as a confirmed order — razorpayRecoveryService
    // deliberately tells only the ops team.
    const isPlaceholder =
      (order.tags || '').includes('RazorpayRecovery') ||
      (order.items || []).some((i: any) => i.sku === 'WEBHOOK-RECOVERED-PLACEHOLDER');
    if (isPlaceholder) return { status: 'skipped', reason: 'placeholder' };

    let address: AddressLike = null;
    try { address = order.shippingAddress ? JSON.parse(order.shippingAddress) : null; } catch { address = null; }

    const payload = buildOrderConfirmationPayload({
      orderNumber: order.internalOrderNumber || order.id,
      address,
      customerEmailFallback: order.customer?.email || null,
      customerNameFallback: order.customer?.name || null,
      items: order.items || [],
      total: order.totalPrice,
      currency: order.currency,
      createdAt: order.createdAt,
      paymentMethod: order.paymentMethod,
      subtotal: order.subtotalPrice ?? order.totalPrice,
      discount: order.discountAmount,
    });
    if (!payload.customerEmail) return { status: 'skipped', reason: 'no_email' };

    const isCod = (order.paymentMethod || '').toLowerCase().trim() === 'cod';
    if (isCod) await sendOrderCodConfirmationEmail(payload);
    else await sendOrderConfirmationEmail(payload);

    // Same bookkeeping as /complete, then the tag that short-circuits the next attempt.
    await prisma.emailLog.create({
      data: {
        recipientEmail: payload.customerEmail,
        recipientName: payload.customerName,
        subject: `Order Confirmed - ${payload.orderId}`,
        templateName: 'ORDER_CONFIRMATION',
        triggerEvent: source,
        referenceId: order.id,
        status: 'sent',
        sentBy: 'system',
      },
    }).catch(() => null);
    await prisma.order.update({
      where: { id: order.id },
      data: { tags: appendOrderTag(order.tags, CONFIRMATION_EMAILED_TAG) },
    });
    return { status: 'sent', orderNumber: payload.orderId, email: payload.customerEmail };
  } catch (err: any) {
    console.error(`[OrderConfirmationNotice] ${source}: could not email confirmation for ${orderId}:`, err?.message || err);
    return { status: 'failed', error: err?.message || String(err) };
  }
}
