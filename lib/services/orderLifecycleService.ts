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
  cancelledBy?: string | null;
  delhivery_awb?: string | null;
  trackingNumber?: string | null;
  shipments?: Array<{
    awb?: string | null;
    trackingNumber?: string | null;
    status?: string | null;
  }> | null;
};

/**
 * Customer-facing "order cancelled" — NOT the same as a voided courier shipment.
 * Shipment cancel alone must not paint the whole order as Cancelled in History.
 */
export function isOrderCancelledForCustomer(order: {
  status?: string | null;
  fulfillmentStatus?: string | null;
  cancelledBy?: string | null;
}): boolean {
  if (order.cancelledBy) return true;
  const status = String(order.status || '').toLowerCase();
  const fulfillment = String(order.fulfillmentStatus || '').toLowerCase();
  return status.includes('cancel') || fulfillment.includes('cancel');
}

export function getCustomerCancelLabel(order: {
  status?: string | null;
  fulfillmentStatus?: string | null;
  cancelledBy?: string | null;
}): string | null {
  if (!isOrderCancelledForCustomer(order)) return null;
  return String(order.cancelledBy || '').toLowerCase() === 'admin'
    ? 'Cancelled by Zica Bella'
    : 'Cancelled';
}

/** True when a live AWB / courier booking exists (ignores cancelled shipment rows). */
export function hasActiveShipmentBooking(order: OrderCancelFields): boolean {
  if (order.delhivery_awb || order.trackingNumber) return true;
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return shipments.some((s) => {
    const st = String(s?.status || '').toLowerCase();
    if (st.includes('cancel')) return false;
    return Boolean(s?.awb || s?.trackingNumber);
  });
}

/** True when the order has progressed far enough that customer cancel must be blocked. */
export function isOrderNonCancellable(order: OrderCancelFields): boolean {
  const status = String(order.status || '').toLowerCase();
  const fulfillment = String(order.fulfillmentStatus || '').toLowerCase();
  const delivery = String(order.deliveryStatus || '').toLowerCase();

  if (status.includes('cancel') || fulfillment.includes('cancel') || delivery.includes('cancel')) {
    return true;
  }

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
    blockedStatus.includes(status) ||
    hasActiveShipmentBooking(order)
  );
}

/** Customer-facing cancel gate (includes AWB / shipment booking). */
export function assertOrderCancellable(order: OrderCancelFields): void {
  if (isOrderNonCancellable(order)) {
    throw new Error(
      hasActiveShipmentBooking(order)
        ? 'Order cannot be cancelled after shipment has been booked. Please contact support.'
        : 'Order cannot be cancelled after fulfillment or shipment'
    );
  }
}

/**
 * Admin cancel gate — ops may cancel after AWB once they have checked the carrier.
 * Only hard-block terminal customer-facing states.
 */
export function assertAdminOrderCancellable(order: OrderCancelFields): void {
  const status = String(order.status || '').toLowerCase();
  const delivery = String(order.deliveryStatus || '').toLowerCase();
  if (status.includes('cancel')) {
    throw new Error('Order is already cancelled');
  }
  if (delivery === 'delivered' || status === 'delivered') {
    throw new Error('Delivered orders cannot be cancelled');
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

/** True when shopifyOrderId is missing or only a local placeholder (not a real Shopify id). */
function isUnsyncedShopifyIdFilter() {
  return {
    OR: [
      { shopifyOrderId: null },
      { shopifyOrderId: { startsWith: 'local_' } },
      { shopifyOrderId: { startsWith: 'app_pending_' } },
    ],
  };
}

/**
 * Retry Shopify sync for paid orders stuck in pending/failed/not_synced,
 * including historical failures and stale syncing locks.
 * Used by cron every ~30 minutes; also safe from recovery paths.
 *
 * After ops fix bad data (phone, address, line items), the next cron pass
 * re-pushes those orders automatically. Recovery placeholders stay excluded.
 */
export async function retryFailedPaidShopifySyncs(limit = 10): Promise<SyncRetryBatchResult> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const failedOrders = await prisma.order.findMany({
    where: {
      AND: [
        isUnsyncedShopifyIdFilter(),
        {
          OR: [
            { shopifySyncStatus: { in: ['failed', 'pending', 'not_synced'] } },
            // Reclaim orders stuck mid-sync (crash / timeout)
            {
              AND: [
                { shopifySyncStatus: 'syncing' },
                { updatedAt: { lt: tenMinutesAgo } },
              ],
            },
          ],
        },
        { paymentStatus: { in: [...SHOPIFY_SYNC_PAID_STATUSES] } },
        // Never auto-push Razorpay recovery placeholders (dummy address / unresolved SKU)
        {
          NOT: {
            OR: [
              { shopifySyncStatus: 'needs_review' },
              { tags: { contains: 'RazorpayRecovery' } },
              { items: { some: { sku: 'WEBHOOK-RECOVERED-PLACEHOLDER' } } },
            ],
          },
        },
      ],
    },
    select: {
      id: true,
      paymentStatus: true,
      shopifySyncStatus: true,
      shopifyOrderId: true,
    },
    orderBy: { createdAt: 'asc' }, // oldest historical failures first
    take: Math.min(Math.max(limit, 1), 50),
  });

  const results: SyncRetryBatchResult['results'] = [];

  for (const order of failedOrders) {
    try {
      // Clear local placeholders so the sync claim (shopifyOrderId: null) can proceed
      if (order.shopifyOrderId && !/^\d+$/.test(String(order.shopifyOrderId))) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            shopifyOrderId: null,
            shopifySyncStatus:
              order.shopifySyncStatus === 'syncing' ? 'pending' : order.shopifySyncStatus || 'pending',
          },
        });
      }

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
      paymentStatus: { in: [...SHOPIFY_SYNC_PAID_STATUSES] },
      OR: [
        { shopifyOrderId: null },
        { shopifyOrderId: { startsWith: 'local_' } },
        { shopifyOrderId: { startsWith: 'app_pending_' } },
      ],
    },
    data: {
      shopifyOrderId: null,
      shopifySyncStatus: 'pending',
      shopifySyncError: reason || 'Queued for Shopify sync retry',
    },
  });
}
