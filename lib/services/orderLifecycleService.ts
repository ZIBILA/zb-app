/**
 * Order lifecycle helpers — single place for cancellability, fulfillment
 * status writes, and paid Shopify sync retries (sync across Admin / Shopify / logistics).
 */

import prisma from '@/lib/db';
import {
  syncOrderToShopify,
  SHOPIFY_SYNC_PAID_STATUSES,
  type SyncResult,
} from '@/lib/services/shopifyOrderSyncService';

export type OrderCancelFields = {
  status?: string | null;
  fulfillmentStatus?: string | null;
  deliveryStatus?: string | null;
};

/** True when the order has progressed far enough that cancel must be blocked. */
export function isOrderNonCancellable(order: OrderCancelFields): boolean {
  const status = String(order.status || '').toLowerCase();
  const fulfillment = String(order.fulfillmentStatus || '').toLowerCase();
  const delivery = String(order.deliveryStatus || '').toLowerCase();

  const blockedFulfillment = [
    'fulfilled',
    'partial',
    'partially_fulfilled',
    'shipped',
  ];
  const blockedDelivery = [
    'shipped',
    'in transit',
    'in_transit',
    'out for delivery',
    'out_for_delivery',
    'delivered',
    'confirmed',
  ];
  const blockedStatus = ['shipped', 'delivered', 'fulfilled'];

  return (
    blockedFulfillment.includes(fulfillment) ||
    blockedDelivery.includes(delivery) ||
    blockedStatus.includes(status)
  );
}

export function assertOrderCancellable(order: OrderCancelFields): void {
  if (isOrderNonCancellable(order)) {
    throw new Error('Order cannot be cancelled after fulfillment or shipment');
  }
}

/**
 * Persist fulfillment on Order + matching WebStoreOrder (by shopify / internal number).
 * Always resolves the local Order row first — never Prisma `OR` inside `update.where`.
 */
export async function markOrderFulfilledLocally(opts: {
  localOrderId?: string | null;
  shopifyOrderId?: string | null;
  internalOrderNumber?: string | null;
  trackingNumber?: string | null;
}): Promise<{ localOrderId: string | null }> {
  let localId = opts.localOrderId || null;

  if (!localId) {
    const found = await prisma.order.findFirst({
      where: {
        OR: [
          ...(opts.shopifyOrderId
            ? [{ shopifyOrderId: String(opts.shopifyOrderId) }, { shopifyOrderId: String(opts.shopifyOrderId).replace(/^#/, '') }]
            : []),
          ...(opts.internalOrderNumber ? [{ internalOrderNumber: opts.internalOrderNumber }] : []),
        ],
      },
      select: { id: true, internalOrderNumber: true, shopifyOrderId: true },
    });
    localId = found?.id || null;
    if (found && !opts.internalOrderNumber) {
      opts.internalOrderNumber = found.internalOrderNumber;
    }
  }

  if (!localId) {
    console.warn('[OrderLifecycle] markOrderFulfilledLocally: no local Order row found');
    return { localOrderId: null };
  }

  const deliveryStatus = opts.trackingNumber ? 'confirmed' : undefined;

  await prisma.order.update({
    where: { id: localId },
    data: {
      fulfillmentStatus: 'fulfilled',
      ...(deliveryStatus ? { deliveryStatus } : {}),
    },
  });

  const order = await prisma.order.findUnique({
    where: { id: localId },
    select: { internalOrderNumber: true, shopifyOrderId: true, razorpayOrderId: true },
  });

  const wsWhere: Array<Record<string, string>> = [];
  if (order?.internalOrderNumber) wsWhere.push({ orderNumber: order.internalOrderNumber });
  if (order?.razorpayOrderId) wsWhere.push({ razorpayOrderId: order.razorpayOrderId });
  if (order?.shopifyOrderId) wsWhere.push({ shopifyOrderId: order.shopifyOrderId });

  if (wsWhere.length > 0) {
    await prisma.webStoreOrder.updateMany({
      where: { OR: wsWhere },
      data: {
        fulfillmentStatus: 'fulfilled',
        ...(deliveryStatus ? { deliveryStatus } : {}),
      },
    }).catch((e: any) =>
      console.warn('[OrderLifecycle] WebStoreOrder fulfillment sync failed:', e?.message)
    );
  }

  return { localOrderId: localId };
}

/** Resolve local Order.id from Shopify id, internal number, or cuid. */
export async function resolveLocalOrderId(ref: string): Promise<string | null> {
  if (!ref) return null;
  const cleaned = ref.replace(/^#/, '');
  const found = await prisma.order.findFirst({
    where: {
      OR: [
        { id: ref },
        { id: cleaned },
        { shopifyOrderId: ref },
        { shopifyOrderId: cleaned },
        { internalOrderNumber: cleaned },
        { internalOrderNumber: ref },
      ],
    },
    select: { id: true },
  });
  return found?.id || null;
}

export type SyncRetryBatchResult = {
  processed: number;
  results: Array<{
    id: string;
    success: boolean;
    shopifyOrderId?: string;
    error?: string;
    skippedUnpaid?: boolean;
  }>;
};

/**
 * Retry Shopify sync for paid orders stuck in pending/failed.
 * Used by cron; safe to call from other recovery paths.
 */
export async function retryFailedPaidShopifySyncs(limit = 10): Promise<SyncRetryBatchResult> {
  const failedOrders = await prisma.order.findMany({
    where: {
      shopifyOrderId: null,
      shopifySyncStatus: { in: ['failed', 'pending'] },
      paymentStatus: { in: [...SHOPIFY_SYNC_PAID_STATUSES] },
      // Never auto-push Razorpay recovery placeholders (dummy address / unresolved SKU)
      NOT: {
        OR: [
          { shopifySyncStatus: 'needs_review' },
          { tags: { contains: 'RazorpayRecovery' } },
          { items: { some: { sku: 'WEBHOOK-RECOVERED-PLACEHOLDER' } } },
        ],
      },
    },
    select: {
      id: true,
      paymentStatus: true,
      shopifySyncStatus: true,
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 50),
  });

  const results: SyncRetryBatchResult['results'] = [];

  for (const order of failedOrders) {
    try {
      const syncRes: SyncResult = await syncOrderToShopify(order.id);
      results.push({
        id: order.id,
        success: syncRes.success,
        shopifyOrderId: syncRes.shopifyOrderId,
        error: syncRes.error,
        skippedUnpaid: syncRes.skippedUnpaid,
      });
    } catch (orderErr: any) {
      console.error(`[OrderLifecycle] retry sync failed for ${order.id}:`, orderErr.message);
      results.push({ id: order.id, success: false, error: orderErr.message });
    }
  }

  console.log(
    `[OrderLifecycle] Shopify sync retry batch: processed=${failedOrders.length} ok=${results.filter((r) => r.success).length}`
  );

  return { processed: failedOrders.length, results };
}

/** Mark a paid order for cron retry without blocking the request path. */
export async function markOrderForShopifySyncRetry(orderId: string, reason?: string): Promise<void> {
  await prisma.order.updateMany({
    where: {
      id: orderId,
      shopifyOrderId: null,
      paymentStatus: { in: [...SHOPIFY_SYNC_PAID_STATUSES] },
    },
    data: {
      shopifySyncStatus: 'pending',
      shopifySyncError: reason || 'Queued for Shopify sync retry',
    },
  });
}
