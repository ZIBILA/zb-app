import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import prisma from '@/lib/db';
import { paymentLog } from '@/lib/payment-logger';
import { recoverOrphanedRazorpayOrder } from '@/lib/services/razorpayRecoveryService';
import { notifyAdminTeam } from '@/lib/services/zohoMailService';
import { assignUniversalOrderNumber, assignFailedOrderNumber, isFailedPrefixNumber } from '@/lib/orderNumber';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const payload = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      paymentLog('warn', 'webhook', { message: 'Missing signature or webhook secret' });
      return NextResponse.json({ error: 'Unauthorized: Missing signature or secret' }, { status: 401 });
    }

    // 1. Verify signature using Razorpay SDK's validateWebhookSignature
    let isValid = false;
    try {
      isValid = Razorpay.validateWebhookSignature(payload, signature, webhookSecret);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      paymentLog('error', 'webhook', { message: 'Invalid webhook signature' });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const eventData = JSON.parse(payload);
    const eventType = eventData.event;
    const data = eventData.payload;
    const eventId = data?.payment?.entity?.id || data?.refund?.entity?.id || 'unknown';

    // 2. Idempotency Check
    const existing = await prisma.webhookEvent.findFirst({
      where: {
        source: 'razorpay',
        eventType,
        payload: { contains: eventId },
        processed: true,
      },
    });

    if (existing) {
      paymentLog('info', 'webhook', { message: 'Duplicate webhook event skipped', eventId, eventType });
      return NextResponse.json({ success: true, duplicate: true }, { status: 200 });
    }

    // 3. Log the raw event in WebhookEvent table for audit
    const webhookRecord = await prisma.webhookEvent.create({
      data: {
        source: 'razorpay',
        eventType,
        payload,
      },
    });

    paymentLog('info', 'webhook', { message: `Received event: ${eventType}`, eventId });

    // 4. Process specific webhook events
    if (eventType === 'payment.captured' || eventType === 'order.paid' || eventType === 'payment.authorized') {
      const payment = data.payment?.entity;
      if (!payment) {
        return NextResponse.json({ success: true, message: 'No payment entity in payload' });
      }

      const razorpayOrderId = payment.order_id || payment.notes?.order_id || payment.notes?.razorpay_order_id;
      const razorpayPaymentId = payment.id;

      if (!razorpayOrderId) {
        paymentLog('warn', 'webhook', { message: 'Received payment without order_id', razorpayPaymentId });
        return NextResponse.json({ success: true, message: 'No order ID found' });
      }

      // Check if order exists in local DB
      const order = await prisma.order.findUnique({
        where: { razorpayOrderId },
      });

      if (order) {
        // Path A: Order exists — update status
        const isCOD = (order.paymentMethod || "").toLowerCase().trim() === "cod";
        const targetPaymentStatus = isCOD ? "partially_paid" : "paid";
        const isAlreadyPaid = order.paymentStatus === 'paid' || order.paymentStatus === 'partially_paid' || order.paymentStatus === 'cod_upfront_paid';

        if (!isAlreadyPaid) {
          const currentTags = order.tags || '';
          const cleanedTags = currentTags
            .split(',')
            .map((t: string) => t.trim())
            .filter((t: string) => Boolean(t) && t !== 'payment_pending' && t !== 'Order creation in process')
            .concat(isCOD ? ['cod_upfront_paid', 'partially_paid'] : ['paid'])
            .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
            .join(', ');

          await prisma.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: targetPaymentStatus,
              razorpayPaymentId,
              paymentCapturedAt: new Date(),
              status: (order.status === 'PENDING' || order.status === 'awaiting_approval' || order.status === 'payment_pending') ? 'OPEN' : order.status,
              tags: cleanedTags,
              note: isCOD ? `COD Order (₹${payment.amount / 100} upfront fee paid via Razorpay - Payment ID: ${razorpayPaymentId}) | InternalOrderId: ${order.id}` : order.note,
            },
          });

          // Promote: if order has a failed/pending prefix number, assign a real ZB number
          if (isFailedPrefixNumber(order.internalOrderNumber)) {
            try {
              const oldNumber = order.internalOrderNumber;
              const newNumber = await assignUniversalOrderNumber(prisma);
              const previousNumbers = [order.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
              const promoted = await prisma.order.updateMany({
                where: {
                  id: order.id,
                  internalOrderNumber: oldNumber,
                },
                data: {
                  internalOrderNumber: newNumber,
                  previousOrderNumbers: previousNumbers || null,
                  tags: (cleanedTags || '').replace(`zb-order-${oldNumber}`, `zb-order-${newNumber}`),
                },
              });

              if (promoted.count === 0) {
                const freshOrder = await prisma.order.findUnique({
                  where: { id: order.id },
                  select: { internalOrderNumber: true }
                });
                paymentLog('info', 'webhook', {
                  message: `Skipping promotion — another process already promoted ${oldNumber} → ${freshOrder?.internalOrderNumber}. Discarding minted ${newNumber}.`
                });
              } else {
                // Update matching WebStoreOrder
                await prisma.webStoreOrder.updateMany({
                  where: { orderNumber: oldNumber! },
                  data: { orderNumber: newNumber },
                });
                // Update matching MobileOrder
                await prisma.mobileOrder.updateMany({
                  where: { orderNumber: oldNumber! },
                  data: { orderNumber: newNumber },
                });
                paymentLog('info', 'webhook', {
                  message: `Promoted failed prefix order number ${oldNumber} → ${newNumber}`
                });
              }
            } catch (promoteErr: any) {
              console.error(`[Razorpay Webhook] Failed to promote order number:`, promoteErr.message);
            }
          }
        }

        // Always ensure WebStoreOrder reflects the captured payment and upfront fee
        const freshNumOrder = await prisma.order.findUnique({
          where: { id: order.id },
          select: { internalOrderNumber: true }
        });
        const currentOrderNum = freshNumOrder?.internalOrderNumber || order.internalOrderNumber;

        await prisma.webStoreOrder.updateMany({
          where: {
            OR: [
              { razorpayOrderId },
              ...(currentOrderNum ? [{ orderNumber: currentOrderNum }] : []),
              ...(order.internalOrderNumber ? [{ orderNumber: order.internalOrderNumber }] : [])
            ]
          },
          data: {
            paymentStatus: targetPaymentStatus,
            razorpayPaymentId,
            ...(isCOD ? {
              codUpfrontPaid: Number(payment.amount / 100) || 99,
              codUpfrontPaymentId: razorpayPaymentId,
              notes: `COD Order (₹${payment.amount / 100} upfront fee paid via Razorpay) | Order: ${currentOrderNum || order.id}`
            } : {})
          },
        });

        // Ensure payment row exists
        const existingPayment = await prisma.payment.findFirst({
          where: { orderId: order.id, gateway: 'razorpay' },
        });

        if (!existingPayment) {
          await prisma.payment.create({
            data: {
              orderId: order.id,
              customerId: order.customerId,
              amount: payment.amount / 100,
              type: 'CAPTURE',
              status: 'success',
              gateway: 'razorpay',
            },
          });
        }

        // Fallback Shopify sync if not yet synced to Shopify and not currently syncing
        const freshOrderForShopify = await prisma.order.findUnique({
          where: { id: order.id },
          select: { shopifyOrderId: true, shopifySyncStatus: true }
        });
        if (
          (!freshOrderForShopify?.shopifyOrderId ||
            freshOrderForShopify.shopifyOrderId.startsWith('local_') ||
            freshOrderForShopify.shopifyOrderId.startsWith('app_pending_')) &&
          freshOrderForShopify?.shopifySyncStatus !== 'syncing'
        ) {
          try {
            const { syncOrderToShopify } = await import('@/lib/services/shopifyOrderSyncService');
            await syncOrderToShopify(order.id);
          } catch (syncErr: any) {
            console.error('[Razorpay Webhook] Shopify fallback sync error:', syncErr.message);
          }
        }

        paymentLog('info', 'webhook', { message: `Order ${order.id} marked as ${targetPaymentStatus}`, orderId: order.id });

        // Link WebhookEvent to Order
        await prisma.webhookEvent.update({
          where: { id: webhookRecord.id },
          data: { orderId: order.id, processed: true, processedAt: new Date() },
        });

      } else {
        // Path B: No Order exists — ORPHANED PAYMENT RECOVERY PATH
        paymentLog('warn', 'webhook', {
          message: `No local Order found for captured Razorpay order ${razorpayOrderId}. Initiating recovery...`,
          razorpayOrderId,
          razorpayPaymentId,
        });

        const recoveryResult = await recoverOrphanedRazorpayOrder({
          razorpayOrderId,
          razorpayPaymentId,
          webhookEventId: webhookRecord.id,
          triggerSource: 'webhook',
        });

        if (!recoveryResult.success) {
          const criticalErrorMsg = `[Razorpay Webhook] CRITICAL: payment captured but order recovery failed`;
          console.error(criticalErrorMsg, {
            razorpayOrderId,
            razorpayPaymentId,
            error: recoveryResult.error,
          });

          // Phase 2: Failure Alerting to Admin Team
          try {
            await notifyAdminTeam(
              `🚨 CRITICAL: Razorpay Payment Captured but Order Recovery Failed`,
              `<div style="font-family: sans-serif; color: #fff; background: #111; padding: 20px; border-radius: 8px;">
                <h2 style="color: #ef4444; margin-top: 0;">CRITICAL: Razorpay Payment Captured but Order Recovery Failed</h2>
                <p>A payment was captured on Razorpay, but no matching order existed in the local database and the automatic recovery service failed.</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px; color: #ccc;">
                  <tr><td style="padding: 6px; font-weight: bold;">Razorpay Order ID:</td><td>${razorpayOrderId}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Razorpay Payment ID:</td><td>${razorpayPaymentId}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Amount:</td><td>₹${(payment.amount / 100).toLocaleString('en-IN')}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Customer Email/Contact:</td><td>${payment.email || payment.contact || 'N/A'}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Error Detail:</td><td style="color: #fca5a5;">${recoveryResult.error || 'Unknown error'}</td></tr>
                </table>
                <p style="margin-top: 20px; color: #888; font-size: 12px;">Please open Admin → Transactions to manually resolve this payment.</p>
              </div>`
            );
          } catch (alertErr: any) {
            console.error('[Razorpay Webhook] Failed to send admin alert email:', alertErr.message);
          }

          return NextResponse.json(
            { error: 'Order recovery failed', details: recoveryResult.error },
            { status: 500 }
          );
        }
      }
    } else if (eventType === 'payment.failed') {
      const payment = data.payment?.entity;
      const razorpayOrderId = payment?.order_id;
      const failureReason = payment?.error_description || payment?.error_code || payment?.error_reason || 'payment_failed';

      if (razorpayOrderId) {
        await prisma.order.updateMany({
          where: { razorpayOrderId },
          data: {
            paymentStatus: 'failed',
            status: 'FAILED',
            paymentFailureReason: failureReason,
          },
        });

        // Assign a ZBPF failed prefix number if the order doesn't have one yet
        try {
          const failedOrder = await prisma.order.findFirst({ where: { razorpayOrderId } });
          if (failedOrder && !failedOrder.internalOrderNumber?.startsWith('ZBPF')) {
            const oldNumber = failedOrder.internalOrderNumber;
            const failedNumber = await assignFailedOrderNumber(prisma, { cause: 'payment_failed' });
            const previousNumbers = [failedOrder.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
            await prisma.order.update({
              where: { id: failedOrder.id },
              data: {
                internalOrderNumber: failedNumber,
                previousOrderNumbers: oldNumber ? (previousNumbers || null) : null,
              },
            });
          }
        } catch (failedNumErr: any) {
          console.error('[Razorpay Webhook] Failed to assign ZBPF number:', failedNumErr.message);
        }

        await prisma.webStoreOrder.updateMany({
          where: { razorpayOrderId },
          data: {
            paymentStatus: 'failed',
            paymentFailureReason: failureReason,
          },
        });
      }
    } else if (eventType === 'refund.processed' || eventType === 'refund.created' || eventType === 'refund.failed') {
      const refund = data.refund?.entity;
      const paymentId = refund?.payment_id;
      const refundStatus = eventType === 'refund.processed' ? 'processed' :
                          eventType === 'refund.failed' ? 'failed' : 'pending';

      if (paymentId) {
        const order = await prisma.order.findUnique({
          where: { razorpayPaymentId: paymentId },
          include: { returns: true },
        });

        if (order) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: eventType === 'refund.processed' ? 'refunded' :
                             eventType === 'refund.failed' ? 'paid' : 'partial_refund',
            },
          });

          if (order.returns.length > 0) {
            await prisma.return.updateMany({
              where: {
                orderId: order.id,
                status: { in: ['APPROVED', 'COMPLETED'] },
              },
              data: {
                refundStatus: refundStatus.toUpperCase(),
              },
            });
          }

          paymentLog('info', 'webhook', { message: `Refund ${refund.id} for Order ${order.id} is ${refundStatus}` });

          await prisma.webhookEvent.update({
            where: { id: webhookRecord.id },
            data: { orderId: order.id },
          });
        }
      }
    }

    // Mark event as processed
    await prisma.webhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processed: true, processedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Razorpay Webhook] Processing error:', error);
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
