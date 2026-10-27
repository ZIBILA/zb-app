import prisma from '@/lib/db';
import { isCodOrder } from '@/lib/returnPolicy';

export interface OrderRefundCalculation {
  totalPaid: number;
  totalAlreadyRefunded: number;
  maxRemainingRefundable: number;
  hasDiscount: boolean;
  orderDiscountAmount: number;
  orderSubtotal: number;
  discountRatio: number;
}

export interface ItemRefundCalculation {
  originalPrice: number;
  discountDeduction: number;
  netItemRefund: number;
}

/**
 * Calculates accurate refund limits for an order, taking into account:
 * 1. What the customer actually paid (accounting for order-level discounts and COD upfront fees)
 * 2. All prior refunds (Razorpay, including in-flight ones, plus store credit)
 * 3. The true remaining maximum refundable ceiling.
 */
export async function calculateOrderRefundLimits(
  orderId: string,
  tx?: any
): Promise<OrderRefundCalculation> {
  const db = tx || prisma;

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      payments: true,
      returns: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const isCod = isCodOrder(order);
  let totalPaid = 0;

  if (isCod) {
    // A delivered COD order has been paid in full (balance collected by the courier); before
    // delivery only the upfront amount has actually been paid.
    const delivered = String((order as any).deliveryStatus || '').toLowerCase() === 'delivered';
    const codUpfront = Number((order as any).codUpfrontPaid) || 0;
    totalPaid = delivered || codUpfront <= 0 ? Number(order.totalPrice || 0) : codUpfront;
  } else {
    totalPaid = Number(order.totalPrice || 0);
  }

  // Razorpay refunds already issued. In-flight ('processing') refunds count too, so a second
  // approval can never refund the same money while the first is still settling; failed ones don't.
  const razorpayRefunds = (order.payments || [])
    .filter((p: any) => {
      const status = String(p.status || '').toLowerCase();
      return String(p.type || '').toLowerCase() === 'refund' && (status === 'completed' || status === 'processing');
    })
    .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);

  // Refunds issued as store credit against this order.
  const creditRows = await db.storeCredit.findMany({
    where: { orderId, type: { in: ['REFUND', 'EXCHANGE_ADJUSTMENT'] } },
    select: { amount: true },
  });
  const storeCreditRefunds = creditRows.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);

  // Legacy return refunds that have no payment / credit row.
  const completedReturnRefunds = (order.returns || [])
    .filter((r: any) => String(r.status || '').toUpperCase() === 'REFUNDED' && String(r.refundStatus || '').toUpperCase() === 'COMPLETED')
    .reduce((sum: number, r: any) => sum + (Number(r.refundAmount) || 0), 0);

  const totalAlreadyRefunded = Math.max(razorpayRefunds + storeCreditRefunds, completedReturnRefunds);
  const maxRemainingRefundable = Math.max(0, Math.round((totalPaid - totalAlreadyRefunded) * 100) / 100);

  const orderDiscountAmount = Number(order.discountAmount || 0);
  const orderSubtotal = Number(order.subtotalPrice || order.totalPrice || 0);
  const hasDiscount = orderDiscountAmount > 0 && orderSubtotal > 0;
  const discountRatio = hasDiscount ? Math.min(1, orderDiscountAmount / orderSubtotal) : 0;

  return {
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalAlreadyRefunded: Math.round(totalAlreadyRefunded * 100) / 100,
    maxRemainingRefundable,
    hasDiscount,
    orderDiscountAmount,
    orderSubtotal,
    discountRatio,
  };
}

/**
 * Calculates the accurate refund amount for an item after applying proportional discounts.
 */
export function calculateItemRefundWithDiscount(
  itemPrice: number,
  quantity: number,
  discountRatio: number
): ItemRefundCalculation {
  const originalPrice = Math.round(itemPrice * quantity * 100) / 100;
  const discountDeduction = Math.round(originalPrice * discountRatio * 100) / 100;
  const netItemRefund = Math.max(0, Math.round((originalPrice - discountDeduction) * 100) / 100);

  return {
    originalPrice,
    discountDeduction,
    netItemRefund,
  };
}
