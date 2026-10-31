import prisma from '@/lib/db';
import { assignUniversalOrderNumber } from '@/lib/orderNumber';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import Razorpay from 'razorpay';
import { paymentLog } from '@/lib/payment-logger';

export interface RecoveryOptions {
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  webhookEventId?: string;
  // Custom items/details provided manually by admin (optional)
  adminCustomItems?: Array<{
    title: string;
    quantity: number;
    price: number;
    sku?: string;
    image?: string;
    productId?: string;
    variantId?: string;
  }>;
  customerNote?: string;
  triggerSource?: 'webhook' | 'admin_manual';
}

export interface RecoveryResult {
  success: boolean;
  orderId?: string;
  internalOrderNumber?: string;
  error?: string;
}

export async function recoverOrphanedRazorpayOrder(options: RecoveryOptions): Promise<RecoveryResult> {
  const {
    razorpayOrderId,
    razorpayPaymentId,
    webhookEventId,
    adminCustomItems,
    customerNote,
    triggerSource = 'webhook'
  } = options;

  try {
    // 1. Check if Order already exists for this razorpayOrderId
    const existingOrder = await prisma.order.findUnique({
      where: { razorpayOrderId },
    });

    if (existingOrder) {
      paymentLog('info', 'recovery-service', {
        message: 'Order already exists for razorpayOrderId',
        orderId: existingOrder.id,
        razorpayOrderId,
      });

      // Ensure payment record exists
      if (razorpayPaymentId) {
        const existingPayment = await prisma.payment.findFirst({
          where: { orderId: existingOrder.id, gateway: 'razorpay' },
        });

        if (!existingPayment) {
          await prisma.payment.create({
            data: {
              orderId: existingOrder.id,
              customerId: existingOrder.customerId,
              amount: existingOrder.totalPrice,
              type: 'CAPTURE',
              status: 'success',
              gateway: 'razorpay',
            },
          });
        }
      }

      if (webhookEventId) {
        await prisma.webhookEvent.update({
          where: { id: webhookEventId },
          data: { orderId: existingOrder.id, processed: true, processedAt: new Date() },
        });
      }

      return {
        success: true,
        orderId: existingOrder.id,
        internalOrderNumber: existingOrder.internalOrderNumber || undefined,
      };
    }

    // 2. Fetch Razorpay Order details via SDK
    const { key_id, key_secret } = await resolveRazorpayCredentials();
    const razorpay = new Razorpay({ key_id, key_secret });

    const rzpOrder: any = await razorpay.orders.fetch(razorpayOrderId);
    if (!rzpOrder) {
      throw new Error(`Razorpay order not found on SDK for orderId: ${razorpayOrderId}`);
    }

    // Attempt to fetch payment details if razorpayPaymentId was provided or from payments list
    let capturedPaymentId = razorpayPaymentId;
    let paymentAmount = (rzpOrder.amount || 0) / 100;

    if (!capturedPaymentId) {
      try {
        const paymentsList: any = await razorpay.orders.fetchPayments(razorpayOrderId);
        if (paymentsList?.items && paymentsList.items.length > 0) {
          const capturedItem = paymentsList.items.find((p: any) => p.status === 'captured') || paymentsList.items[0];
          capturedPaymentId = capturedItem.id;
          if (capturedItem.amount) {
            paymentAmount = capturedItem.amount / 100;
          }
        }
      } catch (e: any) {
        console.warn('[RecoveryService] Could not fetch payments list for order:', razorpayOrderId, e.message);
      }
    }

    const notes = rzpOrder.notes || {};
    const customerEmail = notes.email || notes.customer_email || null;
    const customerPhone = notes.contact || notes.phone || notes.customer_phone || null;
    const customerName = notes.name || notes.customer_name || customerEmail?.split('@')[0] || 'Valued Customer';

    // 3. Find or Create Customer
    const shop = await prisma.shop.findFirst();
    if (!shop) {
      throw new Error('Shop record not found in database');
    }

    let localCustomer = null;
    if (customerEmail || customerPhone) {
      const orClause = [];
      if (customerEmail) orClause.push({ email: customerEmail });
      if (customerPhone) orClause.push({ phone: customerPhone });

      localCustomer = await prisma.customer.findFirst({
        where: { OR: orClause },
      });
    }

    if (!localCustomer) {
      localCustomer = await prisma.customer.create({
        data: {
          shopId: shop.id,
          email: customerEmail || `recovered_${Date.now()}@zicabella.com`,
          phone: customerPhone || '',
          name: customerName,
          shopifyId: `temp_rec_${Date.now()}`,
        },
      });
    }

    // 4. Generate Universal Internal Order Number (successful recovery)
    // SAFE from BUG 1 double-mint: this path only executes when no existing
    // Order was found for this razorpayOrderId (checked at step 1 above, line 45).
    // The recovery service creates a brand-new order, so no pre-created order
    // can race to assign a different number.
    let universalOrderNumber = '';
    try {
      universalOrderNumber = await assignUniversalOrderNumber(prisma);
    } catch (seqErr: any) {
      console.error('[RecoveryService] Failed to generate universal order number:', seqErr.message);
      universalOrderNumber = `ZB${Date.now().toString().slice(-8)}`;
    }

    // 5. Line items configuration
    const isWebhookRecovery = !adminCustomItems || adminCustomItems.length === 0;

    const lineItemsToCreate = isWebhookRecovery
      ? [
          {
            shopifyLineItemId: `rec_${Date.now()}_0`,
            productId: null,
            title: 'Unresolved order — Razorpay recovery, contact customer to confirm items',
            quantity: 1,
            price: paymentAmount,
            sku: 'WEBHOOK-RECOVERED-PLACEHOLDER',
            image: null,
          },
        ]
      : adminCustomItems.map((item, idx) => ({
          shopifyLineItemId: `rec_admin_${Date.now()}_${idx}`,
          productId: item.productId || null,
          title: item.title,
          quantity: item.quantity,
          price: item.price,
          sku: item.sku || null,
          image: item.image || null,
        }));

    const dummyAddress = {
      name: customerName,
      email: customerEmail || '',
      phone: customerPhone || '',
      street: 'Address to be confirmed by staff',
      city: 'Unknown',
      state: 'Unknown',
      zip: '000000',
      country: 'India',
    };

    // 6. Create Order in local DB
    const recoveryTag = isWebhookRecovery ? 'webhook-recovered, RazorpayRecovery' : 'admin-recovered, RazorpayRecovery';

    const order = await prisma.order.create({
      data: {
        shopId: shop.id,
        shopifyOrderId: null,
        customerId: localCustomer.id,
        status: 'OPEN',
        totalPrice: paymentAmount,
        subtotalPrice: paymentAmount,
        totalTax: 0,
        currency: rzpOrder.currency || 'INR',
        paymentStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        deliveryStatus: 'pending',
        shippingAddress: JSON.stringify(dummyAddress),
        billingAddress: JSON.stringify(dummyAddress),
        note: customerNote || `Recovered via ${triggerSource} for Razorpay Order ${razorpayOrderId}`,
        razorpayOrderId,
        razorpayPaymentId: capturedPaymentId || null,
        paymentMethod: 'razorpay',
        paymentCapturedAt: new Date(),
        orderType: 'WEB_STORE',
        tags: `WebStoreOrder, Web, Razorpay, ${recoveryTag}, zb-order-${universalOrderNumber}`,
        internalOrderNumber: universalOrderNumber,
        // NEVER use 'failed'/'pending' here — cron retryFailedPaidShopifySyncs would
        // push the placeholder to Shopify (dummy address + unresolved SKU).
        shopifySyncStatus: 'needs_review',
        shopifySyncError: 'Order recovered from Razorpay payment; pending manual item review — do not auto-sync',
        items: {
          create: lineItemsToCreate,
        },
      },
    });

    // 7. Create WebStoreOrder entry for Web Store Dashboard
    try {
      await prisma.webStoreOrder.create({
        data: {
          orderNumber: universalOrderNumber,
          customerName,
          customerEmail: customerEmail || 'unresolved@zicabella.com',
          customerPhone: customerPhone || '',
          shippingAddress: dummyAddress as any,
          items: lineItemsToCreate.map((item) => ({
            product_id: item.productId || '',
            variant_id: item.sku || '',
            title: item.title,
            image_url: item.image || '',
            quantity: item.quantity,
            price: item.price,
            size: '',
          })) as any,
          subtotal: paymentAmount,
          shippingCharge: 0,
          discountAmount: 0,
          totalAmount: paymentAmount,
          paymentStatus: 'paid',
          paymentMethod: 'razorpay',
          razorpayOrderId,
          razorpayPaymentId: capturedPaymentId || null,
          fulfillmentStatus: 'unfulfilled',
          notes: `Recovered ${triggerSource} order for Razorpay payment ${capturedPaymentId || razorpayOrderId}`,
          source: 'web',
        },
      });
    } catch (wsErr: any) {
      console.warn('[RecoveryService] Failed to create WebStoreOrder record:', wsErr.message);
    }

    // 8. Create Payment Record
    await prisma.payment.create({
      data: {
        orderId: order.id,
        customerId: localCustomer.id,
        amount: paymentAmount,
        type: 'CAPTURE',
        status: 'success',
        gateway: 'razorpay',
      },
    });

    // 9. Notifications: this is a PLACEHOLDER (dummy address, one "Unresolved
    // order" line) created so a captured payment is never lost. It used to email
    // and WhatsApp the customer an "order confirmed" message for it; the real
    // confirmation goes out when /api/checkout/complete (or an admin) replaces
    // the items and address. Only the ops team is told here.
    try {
      const { notifyAdminTeam } = await import('@/lib/services/zohoMailService');
      await notifyAdminTeam(
        `⚠️ Razorpay payment recovered as placeholder order ${universalOrderNumber} — needs review`,
        `<div style="font-family: sans-serif; padding: 20px;">
          <p>A captured Razorpay payment had no matching local order. A placeholder order was created and held from Shopify (<b>needs_review</b>). The customer has NOT been notified.</p>
          <table style="border-collapse:collapse;">
            <tr><td style="padding:4px 8px;font-weight:bold;">Order</td><td>${universalOrderNumber}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold;">Razorpay order</td><td>${razorpayOrderId}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold;">Payment</td><td>${capturedPaymentId || 'n/a'}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold;">Amount</td><td>${rzpOrder.currency || 'INR'} ${Number(paymentAmount).toLocaleString('en-IN')}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold;">Customer</td><td>${customerEmail || customerPhone || 'unknown'}</td></tr>
          </table>
          <p>Open Admin → Transactions / Orders to attach the real items and address.</p>
        </div>`
      );
    } catch (notifyErr: any) {
      console.error('[RecoveryService] Admin notification error:', notifyErr?.message);
    }

    // 10. Update WebhookEvent if ID provided
    if (webhookEventId) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { orderId: order.id, processed: true, processedAt: new Date() },
      });
    }

    paymentLog('info', 'recovery-service', {
      message: `Successfully created recovery order ${universalOrderNumber} (${order.id})`,
      orderId: order.id,
      razorpayOrderId,
      paymentId: capturedPaymentId,
    });

    return {
      success: true,
      orderId: order.id,
      internalOrderNumber: universalOrderNumber,
    };
  } catch (error: any) {
    const errMessage = error?.message || 'Unknown recovery error';
    paymentLog('error', 'recovery-service', {
      message: `CRITICAL: order recovery failed for ${razorpayOrderId}`,
      error: errMessage,
      razorpayOrderId,
    });

    return {
      success: false,
      error: errMessage,
    };
  }
}
