import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import Razorpay from 'razorpay';
import prisma from '@/lib/db';
import { toMinorUnits } from '@/lib/global-pricing';
import { assignRefundId } from '@/lib/orderNumber';

/**
 * Automatically processes a refund via Razorpay for cancelled orders.
 * Handles prepaid orders (full refund) and COD orders (refunds the Rs. 99 upfront fee).
 * Prevents duplicate refunds by checking database records.
 * Supports mock payment IDs for local testing.
 */
export async function processOrderRefund(orderId: string, triggeredBy = 'system') {
  console.log(`[AutoRefund] Starting auto-refund check for Order: ${orderId} (triggered by: ${triggeredBy})`);
  
  // Create unique CUID for audit logs
  const logId = `sl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  try {
    // 1. Fetch the order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true }
    });
    
    if (!order) {
      console.error(`[AutoRefund] Order not found: ${orderId}`);
      return { success: false, error: 'Order not found' };
    }

    // 2. Only refund if order is cancelled
    if (order.status.toLowerCase() !== 'cancelled') {
      console.log(`[AutoRefund] Order ${orderId} is not in cancelled status (current status: ${order.status}). Skipping.`);
      return { success: false, error: 'Order is not cancelled' };
    }

    // 3. Check if already refunded in DB
    const alreadyRefunded = order.payments.some((p: any) => p.type.toLowerCase() === 'refund' && p.status.toLowerCase() === 'completed') 
      || order.refundStatus === 'completed';
    if (alreadyRefunded) {
      console.log(`[AutoRefund] Order ${orderId} already has a completed refund record. Skipping.`);
      return { success: true, message: 'Already refunded' };
    }

    // 4. Update order status to processing refund
    await prisma.order.update({
      where: { id: order.id },
      data: {
        refundStatus: 'processing',
        refundAttempts: { increment: 1 }
      }
    });

    // 5. Find linked WebStoreOrder to get exact values if available
    let webStoreOrder = null;
    if (order.razorpayOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { razorpayOrderId: order.razorpayOrderId }
      });
    }
    if (!webStoreOrder) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { notes: { contains: `Local: ${order.id}` } }
      });
    }
    if (!webStoreOrder && order.shopifyOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { notes: { contains: `Shopify: ${order.shopifyOrderId}` } }
      });
    }
    if (!webStoreOrder && (order.internalOrderNumber || order.shopifyOrderName)) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { orderNumber: order.internalOrderNumber || order.shopifyOrderName }
      });
    }

    // Determine payment method robustly using order properties, tags, notes, and webStoreOrder
    const isCod = 
      order.paymentMethod?.toUpperCase() === 'COD' || 
      order.paymentMethod?.toLowerCase().includes('cash') ||
      webStoreOrder?.paymentMethod?.toUpperCase() === 'COD' ||
      webStoreOrder?.paymentMethod?.toLowerCase().includes('cash') ||
      order.tags?.split(',').map((t: any) => t.trim().toUpperCase()).includes('COD') ||
      order.note?.toLowerCase().includes('cod order');

    const paymentId = isCod 
      ? (webStoreOrder?.codUpfrontPaymentId || order.razorpayPaymentId) 
      : order.razorpayPaymentId;

    if (!paymentId) {
      console.log(`[AutoRefund] Order ${orderId} has no payment transaction ID. No online payment to refund.`);
      
      await prisma.order.update({
        where: { id: order.id },
        data: {
          refundStatus: 'not_applicable',
          refundError: 'No payment transaction ID found'
        }
      });

      return { success: true, message: 'No payment ID to refund' };
    }

    // 6. Determine refund amount
    let refundAmount = 0;
    if (isCod) {
      // For COD, refund the upfront fee (typically Rs 99)
      const upfrontPaid = webStoreOrder ? Number(webStoreOrder.codUpfrontPaid) : 0;
      refundAmount = upfrontPaid > 0 ? upfrontPaid : 99;
    } else {
      // For Prepaid, refund the total price
      refundAmount = order.totalPrice;
    }

    if (refundAmount <= 0) {
      console.log(`[AutoRefund] Refund amount is 0 or negative: ${refundAmount}. Skipping.`);
      
      await prisma.order.update({
        where: { id: order.id },
        data: { refundStatus: 'not_applicable' }
      });

      return { success: true, message: 'Refund amount is zero' };
    }

    console.log(`[AutoRefund] Processing refund of ₹${refundAmount} for payment ${paymentId} (Order: ${orderId}, Method: ${order.paymentMethod})`);

    // Support mock orders/payments in test mode
    const isMock = paymentId.startsWith('pay_mock_') || 
                   (order.razorpayOrderId && order.razorpayOrderId.startsWith('order_mock_')) ||
                   (webStoreOrder?.razorpayOrderId && webStoreOrder.razorpayOrderId.startsWith('order_mock_'));
    
    if (isMock) {
      console.warn(`[AutoRefund] Processing MOCK refund for mock payment ${paymentId}`);
      
      // Generate ZBRF refund ID
      let generatedRefundId: string | null = null;
      try {
        generatedRefundId = await assignRefundId(prisma);
      } catch (rfErr) {
        console.error('[AutoRefund] Failed to generate refundId:', rfErr);
      }

      // Create local payment refund record
      await prisma.$transaction([
        prisma.payment.create({
          data: {
            orderId: order.id,
            customerId: order.customerId,
            amount: refundAmount,
            type: 'refund',
            status: 'completed',
            gateway: 'razorpay'
          }
        }),
        prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'refunded',
            refundStatus: 'completed',
            refundError: null,
            ...(generatedRefundId ? { refundId: generatedRefundId } : {}),
            note: order.note ? `${order.note}\n[Refund] Mock refund of ₹${refundAmount} processed.${generatedRefundId ? ` (${generatedRefundId})` : ''}` : `[Refund] Mock refund of ₹${refundAmount} processed.${generatedRefundId ? ` (${generatedRefundId})` : ''}`
          }
        }),
        prisma.syncLog.create({
          data: {
            id: logId,
            orderId: order.id,
            action: 'RAZORPAY_REFUND',
            status: 'SUCCESS',
            payload: JSON.stringify({ mockPaymentId: paymentId, amount: refundAmount, isMock: true, refundId: generatedRefundId })
          }
        })
      ]);

      if (webStoreOrder) {
        await prisma.webStoreOrder.update({
          where: { id: webStoreOrder.id },
          data: {
            paymentStatus: 'refunded',
            notes: webStoreOrder.notes ? `${webStoreOrder.notes}\n[Refund] Mock refund of ₹${refundAmount} processed.` : `[Refund] Mock refund of ₹${refundAmount} processed.`
          }
        });
      }

      return { success: true, message: 'Mock refund processed successfully', refundId: generatedRefundId };
    }

    // 7. Execute Razorpay Refund
    const creds = await resolveRazorpayCredentials();
    const razorpayInstance = new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret });
    
    // Razorpay amounts are in minor units (paise/cents/etc.)
    const amountInPaise = toMinorUnits(refundAmount, order.currency || 'INR');

    const refund = await razorpayInstance.payments.refund(paymentId, {
      amount: amountInPaise,
      notes: {
        orderId: order.id,
        shopifyOrderId: order.shopifyOrderId || '',
        reason: 'Order cancelled before fulfillment'
      }
    });

    console.log(`[AutoRefund] Razorpay refund successful! Refund ID: ${refund.id}`);

    // Generate ZBRF refund ID
    let generatedRefundId: string | null = null;
    try {
      generatedRefundId = await assignRefundId(prisma);
    } catch (rfErr) {
      console.error('[AutoRefund] Failed to generate refundId:', rfErr);
    }

    // 8. Update Database & log success
    await prisma.$transaction([
      prisma.payment.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          amount: refundAmount,
          type: 'refund',
          status: 'completed',
          gateway: 'razorpay'
        }
      }),
      prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'refunded',
          refundStatus: 'completed',
          refundError: null,
          ...(generatedRefundId ? { refundId: generatedRefundId } : {}),
          note: order.note ? `${order.note}\n[Refund] Auto-refund of ₹${refundAmount} processed via Razorpay (Refund ID: ${refund.id}).${generatedRefundId ? ` (${generatedRefundId})` : ''}` : `[Refund] Auto-refund of ₹${refundAmount} processed via Razorpay (Refund ID: ${refund.id}).${generatedRefundId ? ` (${generatedRefundId})` : ''}`
        }
      }),
      prisma.syncLog.create({
        data: {
          id: logId,
          orderId: order.id,
          action: 'RAZORPAY_REFUND',
          status: 'SUCCESS',
          payload: JSON.stringify({ ...refund, zbRefundId: generatedRefundId })
        }
      })
    ]);

    if (webStoreOrder) {
      await prisma.webStoreOrder.update({
        where: { id: webStoreOrder.id },
        data: {
          paymentStatus: 'refunded',
          notes: webStoreOrder.notes ? `${webStoreOrder.notes}\n[Refund] Auto-refund of ₹${refundAmount} processed (Refund ID: ${refund.id}).` : `[Refund] Auto-refund of ₹${refundAmount} processed (Refund ID: ${refund.id}).`
        }
      });
    }

    // ─── AFFILIATE COMMISSION REVERSAL ───
    try {
      const { reverseReferral } = await import('@/lib/affiliate/earnings');
      await reverseReferral(order.id, 'refund_processed');
    } catch (affErr: any) {
      console.warn('[AutoRefund] Affiliate reversal warning:', affErr.message);
    }

    return { success: true, refundId: refund.id };
  } catch (err: any) {
    console.error(`[AutoRefund] Razorpay refund API failed for Order ${orderId}:`, err);
    const errorMessage = err?.error?.description || err?.message || 'Unknown error';
    
    try {
      const currentOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: { note: true }
      });

      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: {
            refundStatus: 'failed',
            refundError: errorMessage,
            note: currentOrder?.note 
              ? `${currentOrder.note}\n[Refund Failed] Tried auto-refund but it failed: ${errorMessage}` 
              : `[Refund Failed] Tried auto-refund but it failed: ${errorMessage}`
          }
        }),
        prisma.syncLog.create({
          data: {
            id: logId,
            orderId,
            action: 'RAZORPAY_REFUND',
            status: 'FAILED',
            error: errorMessage,
            payload: JSON.stringify({ error: err })
          }
        })
      ]);
    } catch (dbErr) {
      console.error(`[AutoRefund] Failed to update order note with failure message:`, dbErr);
    }
    
    return { success: false, error: errorMessage };
  }
}

export async function triggerAutoRefund(orderId: string, triggeredBy = 'system') {
  return processOrderRefund(orderId, triggeredBy);
}

