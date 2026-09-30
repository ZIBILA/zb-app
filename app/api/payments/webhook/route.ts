/**
 * POST /api/payments/webhook — Razorpay Webhook Handler
 * 
 * Validates signature, stores event for idempotency,
 * and processes payment.captured, payment.failed, refund.created events.
 * 
 * This endpoint is NOT protected by session auth — it uses
 * webhook signature validation instead (excluded from middleware matcher).
 */

import { NextResponse, NextRequest } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/db";
import { shipOrder } from "@/lib/services/logistics";
import { createCustomer } from "@/lib/shopify-admin";
import { syncOrderToShopify } from "@/lib/services/shopifyOrderSyncService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Read raw body BEFORE parsing
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") || "";
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Validate webhook signature
    if (!webhookSecret) {
      console.error("[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET not configured");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    try {
      const sigBuf = Buffer.from(signature, "utf-8");
      const expBuf = Buffer.from(expectedSignature, "utf-8");
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.error("[Razorpay Webhook] Invalid signature");
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }

    // Parse payload after signature validation
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const eventType = payload.event;
    const eventId = payload.payload?.payment?.entity?.id || 
                    payload.payload?.refund?.entity?.id ||
                    `rp_${Date.now()}`;

    // Idempotency check — skip if already processed
    const existingEvent = await prisma.webhookEvent.findFirst({
      where: {
        source: "razorpay",
        eventType,
        payload: { contains: eventId },
      },
    });

    if (existingEvent?.processed) {
      console.log(`[Razorpay Webhook] Event already processed: ${eventType} (${eventId})`);
      return NextResponse.json({ success: true, message: "Already processed" });
    }

    // Insert event record (unprocessed)
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        source: "razorpay",
        eventType,
        payload: rawBody,
        processed: false,
      },
    });

    // Process events
    try {
      if (eventType === "payment.captured") {
        const payment = payload.payload?.payment?.entity;
        const razorpayOrderId = payment?.order_id;
        const razorpayPaymentId = payment?.id;

        if (razorpayOrderId) {
          const order = await prisma.order.findFirst({
            where: { razorpayOrderId },
            include: { 
              items: true, 
              customer: true,
            },
          });

          if (order) {
            // Detect if this is a COD order (case-insensitive check on method, tags, and note)
            const isCodOrder = (
              (order.paymentMethod || '').toLowerCase() === 'cod' ||
              (order.tags || '').toLowerCase().includes('cod') ||
              (order.note || '').toLowerCase().includes('cod order') ||
              (order.note || '').toLowerCase().includes('upfront fee paid')
            );

            // Update address if captured by Razorpay
            let addressToUse = null;
            if (payment.shipping_address) {
              const sa = payment.shipping_address;
              const formattedAddress = {
                name: payment.customer_name || order.customer?.name || "Customer",
                phone: payment.customer_contact || order.customer?.phone || "",
                email: payment.customer_email || order.customer?.email || "",
                street: sa.line1 || "",
                address2: sa.line2 || "",
                city: sa.city || "",
                state: sa.state || "",
                zip: sa.postal_code || "",
                country: sa.country || "India"
              };
              addressToUse = formattedAddress;
            } else if (order.shippingAddress) {
              try {
                addressToUse = JSON.parse(order.shippingAddress);
              } catch {}
            }

            // For COD orders: set cod_upfront_paid and preserve payment method
            // For prepaid orders: set paid and update payment method from Razorpay
            const updateData: any = {
              paymentStatus: isCodOrder ? "cod_upfront_paid" : "paid",
              status: isCodOrder ? "open" : (order.status === "payment_pending" ? "approved" : order.status),
              razorpayPaymentId,
              paymentCapturedAt: new Date(),
              paymentFailureReason: null,
            };

            // Never override paymentMethod for COD orders — keep it as "cod"
            if (!isCodOrder) {
              updateData.paymentMethod = payment?.method || "razorpay";
            }

            if (addressToUse) {
              updateData.shippingAddress = JSON.stringify(addressToUse);
              updateData.billingAddress = JSON.stringify(addressToUse);
            }

            await prisma.order.update({
              where: { id: order.id },
              data: updateData,
            });

            console.log(`[Razorpay Webhook] payment.captured → Order ${order.id} marked ${isCodOrder ? 'cod_upfront_paid' : 'paid'}`);

            // Sync corresponding WebStoreOrder to keep both models in sync
            try {
              const wsOrder = await prisma.webStoreOrder.findFirst({
                where: { razorpayOrderId },
              });
              if (wsOrder) {
                const capturedAmount = payment?.amount ? Number(payment.amount) / 100 : 0;
                await prisma.webStoreOrder.update({
                  where: { id: wsOrder.id },
                  data: {
                    paymentStatus: isCodOrder ? "cod_upfront_paid" : "paid",
                    razorpayPaymentId,
                    paymentFailureReason: null,
                    ...(isCodOrder ? {
                      codUpfrontPaid: capturedAmount || Number(wsOrder.codUpfrontPaid) || 99,
                      codUpfrontPaymentId: razorpayPaymentId,
                    } : {}),
                  },
                });
                console.log(`[Razorpay Webhook] WebStoreOrder ${wsOrder.id} synced to ${isCodOrder ? 'cod_upfront_paid' : 'paid'}`);
              }
            } catch (wsErr: any) {
              console.error('[Razorpay Webhook] WebStoreOrder sync error:', wsErr.message);
            }

            // Mark corresponding Cart as converted
            const matchCart = (order.tags || "").match(/cart-([A-Za-z0-9_-]+)/);
            const cartIdTag = matchCart ? matchCart[1] : null;
            try {
              let targetCartId = cartIdTag;
              if (!targetCartId) {
                const matched = await prisma.cart.findFirst({
                  where: {
                    convertedOrderId: null,
                    status: { not: "converted" },
                    OR: [
                      ...(order.customerId ? [{ customerId: order.customerId }] : [])
                    ]
                  },
                  orderBy: { lastActivityAt: "desc" }
                });
                if (matched) targetCartId = matched.id;
              }

              if (targetCartId) {
                await prisma.cart.update({
                  where: { id: targetCartId },
                  data: {
                    status: "converted",
                    convertedOrderId: order.id
                  }
                });
                console.log(`[Razorpay Webhook] Cart ${targetCartId} successfully converted for order ${order.id}.`);
              }
            } catch (cartErr: any) {
              console.error("[Razorpay Webhook] Cart conversion update failed:", cartErr.message);
            }

            // Sync to Shopify if not already synced
            if (!order.shopifyOrderId || order.shopifySyncStatus !== "synced") {
              try {
                console.log(`[Razorpay Webhook] Syncing CartRecovery order ${order.id} to Shopify...`);
                
                let shopifyCustomerId = order.customer?.shopifyId;
                if (!shopifyCustomerId || shopifyCustomerId.startsWith('temp_')) {
                  try {
                    const sCustomer = await createCustomer({
                      first_name: addressToUse?.name?.split(' ')[0] || order.customer?.name || "Customer",
                      last_name: addressToUse?.name?.split(' ').slice(1).join(' ') || ".",
                      email: addressToUse?.email || order.customer?.email,
                      phone: addressToUse?.phone || order.customer?.phone,
                      verified_email: true,
                    });
                    shopifyCustomerId = sCustomer.id.toString();
                    await prisma.customer.update({
                      where: { id: order.customerId },
                      data: { shopifyId: shopifyCustomerId }
                    });
                  } catch (custErr: any) {
                    console.error("[Razorpay Webhook] Shopify customer sync failed:", custErr.message);
                  }
                }

                const syncRes = await syncOrderToShopify(order.id, { extraTags: ['CartRecovery'] });
                if (syncRes.success) {
                  console.log(`[Razorpay Webhook] Successfully synced Shopify order ${syncRes.shopifyOrderId} for recovered cart`);
                } else {
                  console.error(`[Razorpay Webhook] Failed to sync recovered order to Shopify:`, syncRes.error);
                }
              } catch (syncErr: any) {
                console.error(`[Razorpay Webhook] Failed to sync recovered order to Shopify:`, syncErr.message);
              }
            }

            // Update corresponding MobileOrder status
            const match = (order.tags || '').match(/zb-order-([A-Za-z0-9-]+)/);
            const mobileOrderNumber = match ? match[1] : order.shopifyOrderId?.replace(/^#/, '');
            if (mobileOrderNumber) {
              try {
                await prisma.mobileOrder.updateMany({
                  where: { orderNumber: mobileOrderNumber },
                  data: {
                    status: 'synced',
                    paymentStatus: 'paid',
                    paymentId: razorpayPaymentId,
                    syncedAt: new Date(),
                    tags: `${order.tags || ''}, synced`,
                  }
                });
                console.log(`[Razorpay Webhook] MobileOrder ${mobileOrderNumber} status updated to synced`);
              } catch (moErr: any) {
                console.warn('[Razorpay Webhook] Failed to update corresponding MobileOrder:', moErr.message);
              }
            }

            // Auto-create shipment after payment captured
            try {
              const shippingAddress = addressToUse || (order.shippingAddress ? JSON.parse(order.shippingAddress) : null);
              if (shippingAddress) {
                await shipOrder(
                  order.id,
                  order.items.map((i: any) => ({
                    title: i.title,
                    sku: i.sku || undefined,
                    quantity: i.quantity,
                    price: i.price,
                  })),
                  {
                    name: shippingAddress.name || "",
                    address1: shippingAddress.street || shippingAddress.address1 || "",
                    city: shippingAddress.city || "",
                    province: shippingAddress.state || "",
                    zip: shippingAddress.zip || "",
                    country: shippingAddress.country || "India",
                    phone: shippingAddress.phone || "",
                  }
                );
                console.log(`[Razorpay Webhook] Auto-shipment created for order ${order.id}`);
              }
            } catch (shipErr: any) {
              // Payment is already confirmed — shipment failure should NOT rollback payment
              console.error(`[Razorpay Webhook] Auto-shipment failed for order ${order.id}:`, shipErr.message);
            }
          }
        }
      } else if (eventType === "payment.failed") {
        const payment = payload.payload?.payment?.entity;
        const razorpayOrderId = payment?.order_id;
        const failureReason = payment?.error_description || payment?.error_reason || payment?.error_code || "Payment failed";
        const rawCode = String(payment?.error_code || "").toUpperCase();
        const rawDesc = String(payment?.error_description || "").toLowerCase();
        const isCancelledByUser = rawCode === "BAD_REQUEST_ERROR" && (rawDesc.includes("cancel") || rawDesc.includes("dismissed") || rawDesc.includes("closed"));

        if (razorpayOrderId) {
          // Check if any matching order is COD — don't overwrite paymentMethod
          const matchingOrders = await prisma.order.findMany({
            where: { razorpayOrderId },
            select: { id: true, paymentMethod: true, paymentStatus: true },
          });

          for (const mOrder of matchingOrders) {
            // Don't overwrite already-confirmed payments
            const currentStatus = (mOrder.paymentStatus || '').toLowerCase();
            if (currentStatus === 'paid' || currentStatus === 'cod_upfront_paid') {
              console.log(`[Razorpay Webhook] Skipping payment.failed for already-paid order ${mOrder.id}`);
              continue;
            }

            await prisma.order.update({
              where: { id: mOrder.id },
              data: {
                paymentStatus: isCancelledByUser ? "cancelled" : "failed",
                paymentFailureReason: isCancelledByUser ? "payment_cancelled_by_user" : failureReason,
                status: isCancelledByUser ? "cancelled" : "payment_failed",
              },
            });
          }

          // Sync to WebStoreOrder
          try {
            const wsOrders = await prisma.webStoreOrder.findMany({
              where: { razorpayOrderId },
            });
            for (const ws of wsOrders) {
              const currentWsStatus = (ws.paymentStatus || '').toLowerCase();
              if (currentWsStatus === 'paid' || currentWsStatus === 'cod_upfront_paid') continue;
              await prisma.webStoreOrder.update({
                where: { id: ws.id },
                data: {
                  paymentStatus: isCancelledByUser ? "cancelled" : "failed",
                  paymentFailureReason: isCancelledByUser ? "payment_cancelled_by_user" : failureReason,
                },
              });
            }
          } catch (wsErr: any) {
            console.error('[Razorpay Webhook] WebStoreOrder failed-sync error:', wsErr.message);
          }

          console.log(`[Razorpay Webhook] payment.failed → Order with razorpay_order_id ${razorpayOrderId} (${isCancelledByUser ? 'cancelled_by_user' : 'failed'})`);
        }
      } else if (eventType === "refund.created") {
        const refund = payload.payload?.refund?.entity;
        const paymentId = refund?.payment_id;

        if (paymentId) {
          await prisma.order.updateMany({
            where: { razorpayPaymentId: paymentId },
            data: { paymentStatus: "refunded" },
          });
          console.log(`[Razorpay Webhook] refund.created → Order with payment_id ${paymentId}`);
        }
      }

      // Mark event as processed
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processed: true, processedAt: new Date() },
      });
    } catch (processErr: any) {
      console.error("[Razorpay Webhook] Processing error:", processErr.message);
      // Event is recorded but not marked processed — will be retried
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Razorpay Webhook] Fatal error:", error.message);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
