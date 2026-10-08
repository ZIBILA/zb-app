import crypto from 'crypto';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';

import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import prisma from '@/lib/db';
import { sendOpenAiEvent, toMinorUnits as oaiToMinorUnits } from '@/lib/openai-capi';
import { assignUniversalOrderNumber, isFailedPrefixNumber } from '@/lib/orderNumber';

import { getCorsHeaders, handleCorsOptions } from '@/lib/cors';
import { emitSnapAppPurchase, appRequestContext } from '@/lib/snap/app-purchase-server';

export async function OPTIONS(req: Request) {
  return handleCorsOptions(req);
}

export async function POST(req: Request) {
  const corsHeaders = getCorsHeaders(req);
  try {
    const verifyBody = await req.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = verifyBody;
    // Snap MOBILE_APP Purchase is sent only when Razorpay reports the money CAPTURED.
    let paymentCaptured = false;
    
    if (!razorpay_order_id || !razorpay_payment_id) {
      console.error('[Verify] Missing fields:', { razorpay_order_id, razorpay_payment_id, has_signature: !!razorpay_signature });
      return NextResponse.json(
        { success: false, error: 'Missing payment fields' },
        { status: 400, headers: corsHeaders }
      );
    }

    let secret: string;
    try {
      const creds = await resolveRazorpayCredentials();
      secret = creds.key_secret.trim();
    } catch (credErr: any) {
      console.error('[Verify] Credential resolution failed:', credErr.message);
      return NextResponse.json(
        { success: false, error: 'Payment gateway not configured correctly.' },
        { status: 500, headers: corsHeaders }
      );
    }

    if (razorpay_signature && razorpay_signature !== 'HEADLESS') {
      // Razorpay signature verification logic:
      // HMAC_SHA256(order_id + "|" + payment_id, secret) == signature
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      const isValid = expectedSignature === razorpay_signature;

      if (!isValid) {
        console.error('[Verify] Signature mismatch:', {
          order_id: razorpay_order_id,
          payment_id: razorpay_payment_id,
          received: razorpay_signature.slice(0, 10) + '...',
          expected: expectedSignature.slice(0, 10) + '...',
        });
        return NextResponse.json(
          { success: false, error: 'Payment verification failed: Signature mismatch.' },
          { status: 400, headers: corsHeaders }
        );
      }
    } else {
      const creds = await resolveRazorpayCredentials();
      const razorpay = new Razorpay({
        key_id: creds.key_id.trim(),
        key_secret: secret,
      });
      const payment: any = await razorpay.payments.fetch(razorpay_payment_id);

      if (payment.order_id !== razorpay_order_id) {
        console.error('[Verify] Payment/order mismatch:', {
          order_id: razorpay_order_id,
          payment_id: razorpay_payment_id,
          payment_order_id: payment.order_id,
        });
        return NextResponse.json(
          { success: false, error: 'Payment verification failed: order mismatch.' },
          { status: 400, headers: corsHeaders }
        );
      }

      if (!['captured', 'authorized'].includes(payment.status)) {
        return NextResponse.json(
          { success: false, error: `Payment is not complete yet (${payment.status}).` },
          { status: 400, headers: corsHeaders }
        );
      }
      paymentCaptured = payment.status === 'captured' && payment.captured === true;
    }

    console.log(`[Verify] ✅ Payment verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);

    let localOrderId: string | null = null;
    let localOrderNumber: string | null = null;

    // Update local order status immediately to avoid race conditions with webhook
    try {
      const order = await prisma.order.findUnique({
        where: { razorpayOrderId: razorpay_order_id },
        include: { items: true, customer: true }
      });
      if (order) {
        localOrderId = order.id;
        localOrderNumber = order.internalOrderNumber;
        const now = new Date();
        const isCod =
          String(order.paymentMethod || '').toLowerCase().includes('cod') ||
          String(order.tags || '').toLowerCase().includes('cod');
        const targetPaymentStatus = isCod ? 'cod_upfront_paid' : 'paid';
        const alreadyPaid =
          order.paymentStatus === 'paid' ||
          order.paymentStatus === 'cod_upfront_paid' ||
          order.paymentStatus === 'partially_paid';

        // Promote ZBPP/ZBPF → real ZB when payment is confirmed
        let promotedNumber = order.internalOrderNumber;
        if (isFailedPrefixNumber(promotedNumber)) {
          const oldNumber = promotedNumber!;
          let minted = '';
          try {
            minted = await assignUniversalOrderNumber(prisma);
          } catch {
            minted = `ZB${Date.now().toString().slice(-8)}`;
          }
          const previousNumbers = [order.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
          const promoted = await prisma.order.updateMany({
            where: { id: order.id, internalOrderNumber: oldNumber },
            data: {
              internalOrderNumber: minted,
              previousOrderNumbers: previousNumbers || null,
            },
          });
          if (promoted.count > 0) {
            promotedNumber = minted;
            await prisma.mobileOrder.updateMany({
              where: { orderNumber: oldNumber },
              data: { orderNumber: minted },
            }).catch(() => {});
            await prisma.webStoreOrder.updateMany({
              where: { orderNumber: oldNumber },
              data: { orderNumber: minted },
            }).catch(() => {});
            console.log(`[Verify] Promoted order number: ${oldNumber} → ${minted}`);
          } else {
            const fresh = await prisma.order.findUnique({
              where: { id: order.id },
              select: { internalOrderNumber: true },
            });
            if (fresh?.internalOrderNumber && !isFailedPrefixNumber(fresh.internalOrderNumber)) {
              promotedNumber = fresh.internalOrderNumber;
            }
          }
        }
        localOrderNumber = promotedNumber;

        if (!alreadyPaid) {
          // ─── Sync with Shopify ───
          let shopifyOrderId = order.shopifyOrderId;
          let tags = order.tags || 'mobile-app';

          await prisma.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: targetPaymentStatus,
              razorpayPaymentId: razorpay_payment_id,
              paymentCapturedAt: now,
              status: isCod ? 'open' : 'approved',
              tags: `${tags}, ${isCod ? 'cod_upfront_paid' : 'Prepaid, Razorpay'}`,
              internalOrderNumber: promotedNumber || order.internalOrderNumber,
            }
          });

          if (!shopifyOrderId || !/^\d+$/.test(String(shopifyOrderId))) {
            try {
              const { syncOrderToShopify } = await import('@/lib/services/shopifyOrderSyncService');
              const syncRes = await syncOrderToShopify(order.id, { preserveAppTags: true });
              if (syncRes.success && syncRes.shopifyOrderId) {
                shopifyOrderId = syncRes.shopifyOrderId;
                tags = `${tags}, synced`;
              }
            } catch (syncErr: any) {
              console.error('[Verify] Shopify sync failed:', syncErr.message);
            }
          }

          // Update corresponding MobileOrder status
          const match = (order.tags || '').match(/zb-order-([A-Za-z0-9-]+)/);
          const mobileOrderNumber = promotedNumber || (match ? match[1] : order.shopifyOrderId?.replace(/^#/, ''));
          if (mobileOrderNumber) {
            try {
              await prisma.mobileOrder.updateMany({
                where: {
                  OR: [
                    { orderNumber: mobileOrderNumber },
                    ...(order.internalOrderNumber ? [{ orderNumber: order.internalOrderNumber }] : []),
                  ],
                },
                data: {
                  orderNumber: promotedNumber || mobileOrderNumber,
                  status: 'synced',
                  paymentStatus: targetPaymentStatus === 'cod_upfront_paid' ? 'cod_upfront_paid' : 'paid',
                  paymentId: razorpay_payment_id,
                  shopifyOrderId: shopifyOrderId,
                  syncedAt: now,
                  tags: `${tags}, synced`,
                }
              });
              console.log(`[Verify] MobileOrder ${mobileOrderNumber} status updated`);
            } catch (moErr: any) {
              console.warn('[Verify] Failed to update corresponding MobileOrder:', moErr.message);
            }
          }

          // Record payment (skip if customer missing — never fail verify after capture)
          if (order.customerId) {
            let recordedAmount = Number((order as any).codUpfrontPaid) || 0;
            if (targetPaymentStatus !== 'cod_upfront_paid') {
              recordedAmount = Number(order.totalPrice) || 0;
            }
            if (!(recordedAmount > 0)) {
              recordedAmount = Number(order.totalPrice) || 0;
            }
            // Prefer live Razorpay capture amount when available
            try {
              const creds = await resolveRazorpayCredentials();
              const razorpay = new Razorpay({
                key_id: creds.key_id.trim(),
                key_secret: creds.key_secret.trim(),
              });
              const livePayment: any = await razorpay.payments.fetch(razorpay_payment_id);
              const liveRupees = Number(livePayment?.amount) / 100;
              if (Number.isFinite(liveRupees) && liveRupees > 0) {
                recordedAmount = liveRupees;
              }
            } catch {
              /* keep fallback amount */
            }
            await prisma.payment.create({
              data: {
                orderId: order.id,
                customerId: order.customerId,
                amount: recordedAmount,
                type: 'CAPTURE',
                status: 'success',
                gateway: 'razorpay',
              }
            }).catch(() => {});
          }
          console.log(`[Verify] Local order ${order.id} marked as ${targetPaymentStatus}`);

          // ─── Snap MOBILE_APP Purchase (never the website pixel) ───
          // lib/snap/app-purchase.ts rebuilds it from the stored order + the device
          // context the app sent at payment start, and sends once (ledger). Only a
          // CAPTURED payment counts; otherwise the payment.captured webhook sends it.
          emitSnapAppPurchase(order.id, {
            paymentConfirmed: paymentCaptured,
            device: verifyBody?.snapDevice,
            req: appRequestContext(req, order.customerId),
          }).catch(() => {});

          // ─── Authoritative server-side OpenAI Ads order_created ───
          // Mobile app — no browser pixel to dedup against, so action_source = 'mobile_app'.
          try {
            const oaiAddr = typeof order.shippingAddress === 'string'
              ? JSON.parse(order.shippingAddress)
              : order.shippingAddress;
            const oaiCustName = order.customer?.name || oaiAddr?.name || '';

            const openAiContents = (order.items || []).map((li: any) => {
              const raw = li.sku || li.variantId || li.productId || '';
              const s = String(raw);
              const stripped = s.startsWith('variant:') ? s.slice(8) : s;
              const m = stripped.match(/(\d+)\s*$/);
              const itemId = m ? m[1] : stripped;
              return {
                id: itemId,
                name: li.title,
                content_type: 'product' as const,
                quantity: li.quantity || 1,
                amount: oaiToMinorUnits(parseFloat(li.price || '0'), order.currency || 'INR'),
                currency: order.currency || 'INR',
              };
            });

            sendOpenAiEvent({
              eventName: 'order_created',
              eventId: order.id,
              eventSourceUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/orders/${order.id}/confirmation`,
              userAgent: req.headers.get('user-agent') || '',
              actionSource: 'mobile_app',
              ipAddress: req.headers.get('do-connecting-ip')
                || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
                || req.headers.get('x-real-ip') || undefined,
              userData: {
                em: order.customer?.email || undefined,
                ph: order.customer?.phone || undefined,
                fn: oaiCustName.trim().split(/\s+/)[0] || undefined,
                ln: oaiCustName.trim().split(/\s+/).slice(1).join(' ') || undefined,
                ct: oaiAddr?.city || undefined,
                st: oaiAddr?.province || oaiAddr?.state || undefined,
                zp: oaiAddr?.zip || oaiAddr?.pincode || undefined,
                country: oaiAddr?.country || undefined,
              },
              data: {
                type: 'contents',
                amount: oaiToMinorUnits(Number(order.totalPrice || 0), order.currency || 'INR'),
                currency: order.currency || 'INR',
                contents: openAiContents,
              },
            }).catch(() => {}); // fire-and-forget
          } catch (oaiErr: any) {
            console.warn('[Verify] OpenAI CAPI order_created fire failed:', oaiErr.message);
          }
        } else if (promotedNumber && promotedNumber !== order.internalOrderNumber) {
          // Already paid but we just promoted the number — keep response ids fresh
          localOrderNumber = promotedNumber;
        }
      }
    } catch (dbErr: any) {
      console.warn('[Verify] Failed to update local order:', dbErr.message);
    }

    return NextResponse.json(
      {
        success: true,
        payment_id: razorpay_payment_id,
        orderId: localOrderId,
        orderNumber: localOrderNumber,
      },
      { headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error('[Verify] Internal Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error during verification' },
      { status: 500, headers: corsHeaders }
    );
  }
}
