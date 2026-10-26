/**
 * Repair a paid order that was incorrectly marked cancelled
 * (typically Shopify unpaid auto-cancel mirrored onto a ₹0 coupon order).
 *
 * Usage:
 *   npx tsx scripts/repair-false-cancelled-order.ts ZB81322
 *   npx tsx scripts/repair-false-cancelled-order.ts ZB81322 --apply
 *
 * Default is dry-run. Pass --apply to write.
 *
 * Does NOT repair rows with cancelledBy in admin / user / user_processed.
 */

import prisma from '../lib/db';

const PROTECTED_CANCELLED_BY = new Set(['admin', 'user', 'user_processed', 'customer']);

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--apply');
  const apply = process.argv.includes('--apply');
  const orderNumber = args[0];

  if (!orderNumber) {
    console.error('Usage: npx tsx scripts/repair-false-cancelled-order.ts <ZB#####> [--apply]');
    process.exit(1);
  }

  const order = await prisma.order.findUnique({
    where: { internalOrderNumber: orderNumber },
  });

  if (!order) {
    console.error(`Order ${orderNumber} not found`);
    process.exit(1);
  }

  console.log('Current order:', {
    id: order.id,
    internalOrderNumber: order.internalOrderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    deliveryStatus: order.deliveryStatus,
    cancelledAt: order.cancelledAt,
    cancelledBy: order.cancelledBy,
    discountCode: order.discountCode,
    discountAmount: order.discountAmount,
    totalPrice: order.totalPrice,
    shopifyOrderId: order.shopifyOrderId,
    shopifySyncStatus: order.shopifySyncStatus,
    paymentMethod: order.paymentMethod,
  });

  const pay = String(order.paymentStatus || '').toLowerCase();
  const paidLike = ['paid', 'cod_upfront_paid', 'partially_paid'].includes(pay);
  const cancelledBy = String(order.cancelledBy || '').toLowerCase();
  const statusCancelled = ['cancelled', 'canceled'].includes(String(order.status || '').toLowerCase());

  if (!statusCancelled && !order.cancelledAt) {
    console.log('Order is not cancelled — nothing to repair.');
    return;
  }

  if (cancelledBy && PROTECTED_CANCELLED_BY.has(cancelledBy)) {
    console.error(
      `Refusing to repair: cancelledBy=${order.cancelledBy} (real customer/admin cancel).`
    );
    process.exit(2);
  }

  if (!paidLike && Number(order.totalPrice || 0) > 0.009) {
    console.error(
      `Refusing to repair: paymentStatus=${order.paymentStatus} total=${order.totalPrice} (not a paid/zero-paid false cancel).`
    );
    process.exit(2);
  }

  const nextStatus =
    order.orderType === 'MOBILE_APP' || String(order.tags || '').toLowerCase().includes('app')
      ? 'approved'
      : 'active';

  const patch = {
    status: nextStatus,
    deliveryStatus: 'pending',
    fulfillmentStatus:
      String(order.fulfillmentStatus || '').toLowerCase().includes('cancel')
        ? 'unfulfilled'
        : order.fulfillmentStatus || 'unfulfilled',
    cancelledAt: null as Date | null,
    cancelledBy: null as string | null,
    shopifySyncStatus: 'needs_review',
    shopifySyncError: `Repaired false cancel at ${new Date().toISOString()} (was cancelledBy=${order.cancelledBy || 'null'})`,
    paymentStatus: paidLike ? order.paymentStatus : 'paid',
  };

  console.log(apply ? 'Applying patch:' : 'Dry-run patch:', patch);

  if (!apply) {
    console.log('Re-run with --apply to write.');
    return;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: patch,
  });

  const wsoData: Record<string, string> = {
    deliveryStatus: 'pending',
    fulfillmentStatus: 'unfulfilled',
  };
  if (!paidLike) wsoData.paymentStatus = 'paid';
  await prisma.webStoreOrder
    .updateMany({
      where: { orderNumber: orderNumber },
      data: wsoData,
    })
    .catch(() => null);

  console.log(`Repaired ${orderNumber}. Customer profile should no longer show CANCELLED.`);
  console.log('Next: confirm Shopify mirror (recreate paid ₹0 with discount if needed) then clear needs_review.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
