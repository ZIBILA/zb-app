/**
 * Shared cart conversion predicates — single source of truth.
 *
 * Used by:
 *  - app/api/admin/analytics/overview/route.ts
 *  - app/api/admin/analytics/carts/route.ts
 *  - app/api/admin/analytics/realtime/route.ts
 *  - app/api/admin/abandoned-carts/route.ts
 *
 * Definitions:
 *  - Converted:  status='converted' OR convertedOrderId != null OR linked order is valid
 *  - Abandoned:  not converted, has items, status='abandoned' OR (status='active' & stale)
 *  - Live/Active: status='active', not converted, has items, recently active
 *  - Merged/expired are excluded from all counts
 */

import prisma from '@/lib/db';

// Re-export the runtime order validation helper
export { isOrderValidConverted } from './cartValidation';

/**
 * Link a cart to an order without violating unique(converted_order_id).
 * If another cart already owns the order id, mark this cart converted/merged
 * without setting convertedOrderId (avoids P2002 log spam).
 */
export async function linkCartToOrderSafe(
  cartId: string,
  orderId: string,
  db: { cart: typeof prisma.cart } = prisma
): Promise<'linked' | 'already_linked' | 'merged_without_link' | 'skipped'> {
  if (!cartId || !orderId) return 'skipped';

  try {
    const existingOwner = await db.cart.findFirst({
      where: { convertedOrderId: orderId },
      select: { id: true },
    });

    if (existingOwner) {
      if (existingOwner.id === cartId) {
        await db.cart.update({
          where: { id: cartId },
          data: { status: 'converted' },
        });
        return 'already_linked';
      }
      await db.cart.update({
        where: { id: cartId },
        data: { status: 'merged' },
      });
      return 'merged_without_link';
    }

    const claimed = await db.cart.updateMany({
      where: { id: cartId, convertedOrderId: null },
      data: { status: 'converted', convertedOrderId: orderId },
    });
    if (claimed.count > 0) return 'linked';

    // Cart already had a different convertedOrderId or raced — mark converted if same order
    const cart = await db.cart.findUnique({
      where: { id: cartId },
      select: { convertedOrderId: true },
    });
    if (cart?.convertedOrderId === orderId) {
      await db.cart.update({
        where: { id: cartId },
        data: { status: 'converted' },
      });
      return 'already_linked';
    }
    await db.cart.update({
      where: { id: cartId },
      data: { status: 'merged' },
    }).catch(() => {});
    return 'merged_without_link';
  } catch (err: any) {
    if (err?.code === 'P2002') {
      await db.cart.update({
        where: { id: cartId },
        data: { status: 'merged' },
      }).catch(() => {});
      return 'merged_without_link';
    }
    throw err;
  }
}

/**
 * Prisma `where` fragment that matches a cart whose linked order is genuinely valid.
 * This is the canonical definition shared across analytics and abandoned-carts pages.
 */
export const validConvertedOrderClause = {
  OR: [
    {
      convertedOrder: {
        is: {
          NOT: [
            { status: { in: ['failed', 'FAILED', 'payment_failed', 'payment_pending', 'cancelled', 'CANCELLED', 'draft', 'voided'] } },
            { paymentStatus: { in: ['failed', 'FAILED', 'payment_failed', 'payment_pending', 'cancelled', 'CANCELLED', 'voided'] } }
          ],
          OR: [
            { paymentStatus: { in: ['paid', 'cod_upfront_paid', 'partially_paid', 'refunded', 'partially_refunded', 'PAID', 'SUCCESS', 'success', 'captured', 'authorized', 'approved'] } },
            { status: { in: ['approved', 'open', 'active', 'fulfilled', 'delivered', 'shipped', 'completed', 'processing', 'processed', 'CONFIRMED', 'confirmed', 'placed', 'synced', 'closed'] } }
          ]
        }
      }
    },
    { status: 'converted' }
    // NOTE: Removed `{ convertedOrderId: { not: null } }` — having a linked order ID
    // alone does NOT prove conversion. The order may be failed/cancelled/voided.
    // Only `status: 'converted'` or a validated convertedOrder relation should count.
  ]
};

/**
 * Where clause for converted carts, optionally scoped by date and platform.
 */
export function convertedCartWhere(dateFilter?: { gte: Date; lte: Date }, platformFilter?: Record<string, unknown>) {
  return {
    ...validConvertedOrderClause,
    status: { notIn: ['merged', 'expired'] },
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(platformFilter || {}),
  };
}

/**
 * Where clause for abandoned carts.
 * threshold: carts with lastActivityAt <= this are considered stale/abandoned
 */
export function abandonedCartWhere(
  dateFilter?: { gte: Date; lte: Date },
  threshold?: Date,
  platformFilter?: Record<string, unknown>,
) {
  const staleThreshold = threshold || new Date(Date.now() - 30 * 60 * 1000); // default 30min
  return {
    convertedOrderId: null,
    items: { some: {} },
    status: { notIn: ['merged', 'expired', 'converted'] },
    OR: [
      { status: 'abandoned' },
      { status: 'active', lastActivityAt: { lte: staleThreshold } },
    ],
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(platformFilter || {}),
  };
}

/**
 * Where clause for live/active carts (currently being shopped).
 * sinceDate: carts active since this time (e.g. 15 minutes ago)
 */
export function liveCartWhere(sinceDate: Date) {
  return {
    status: 'active',
    convertedOrderId: null,
    items: { some: {} },
    lastActivityAt: { gte: sinceDate },
  };
}
