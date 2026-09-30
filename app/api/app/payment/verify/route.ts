import crypto from 'crypto';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';

import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import prisma from '@/lib/db';
import { sendSnapEvent } from '@/lib/snap-capi';
import { sendOpenAiEvent, toMinorUnits as oaiToMinorUnits } from '@/lib/openai-capi';

import { getCorsHeaders, handleCorsOptions } from '@/lib/cors';

export async function OPTIONS(req: Request) {
  return handleCorsOptions(req);
}

export async function POST(req: Request) {
  const corsHeaders = getCorsHeaders(req);
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    
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
    }

    console.log(`[Verify] ✅ Payment verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);

    // Update local order status immediately to avoid race conditions with webhook
    try {
      const order = await prisma.order.findUnique({
        where: { razorpayOrderId: razorpay_order_id },
        include: { items: true, customer: true }
      });
      if (order && order.paymentStatus !== 'paid') {
        const now = new Date();
        
        // ─── Sync with Shopify ───
        let shopifyOrderId = order.shopifyOrderId;
        let tags = order.tags || 'mobile-app';
        
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'paid',
            razorpayPaymentId: razorpay_payment_id,
            paymentCapturedAt: now,
            status: 'approved', // Auto-approved upon payment
            tags: `${tags}, Prepaid, Razorpay`,
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
        const mobileOrderNumber = match ? match[1] : order.shopifyOrderId?.replace(/^#/, '');
        if (mobileOrderNumber) {
          try {
            await prisma.mobileOrder.updateMany({
              where: { orderNumber: mobileOrderNumber },
              data: {
                status: 'synced',
                paymentStatus: 'paid',
                paymentId: razorpay_payment_id,
                shopifyOrderId: shopifyOrderId,
                syncedAt: now,
                tags: `${tags}, synced`,
              }
            });
            console.log(`[Verify] MobileOrder ${mobileOrderNumber} status updated to synced`);
          } catch (moErr: any) {
            console.warn('[Verify] Failed to update corresponding MobileOrder:', moErr.message);
          }
        }
        
        // Record payment
        await prisma.payment.create({
          data: {
            orderId: order.id,
            customerId: order.customerId!,
            amount: order.totalPrice,
            type: 'CAPTURE',
            status: 'success',
            gateway: 'razorpay',
          }
        });
        console.log(`[Verify] Local order ${order.id} marked as PAID and synced to Shopify`);

        // ─── FIX 3: Authoritative server-side Snap CAPI Purchase ───
        // Fires when Razorpay payment is verified for mobile-app prepaid orders.
        // Uses eventId = order.id to match browser pixel's Purchase event for Snap dedup.
        try {
          const address = typeof order.shippingAddress === 'string'
            ? JSON.parse(order.shippingAddress)
            : order.shippingAddress;
          const custName = order.customer?.name || address?.name || '';

          const toSnapItemId = (li: any): string => {
            const raw = li.sku || li.variantId || li.productId || '';
            const s = String(raw);
            const stripped = s.startsWith('variant:') ? s.slice(8) : s;
            const m = stripped.match(/(\d+)\s*$/);
            return m ? m[1] : stripped;
          };

          sendSnapEvent({
            eventName: 'PURCHASE',
            eventId: order.id,
            eventSourceUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/orders/${order.id}/confirmation`,
            userAgent: req.headers.get('user-agent') || '',
            ipAddress: req.headers.get('do-connecting-ip')
              || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
              || req.headers.get('x-real-ip') || undefined,
            userData: {
              em: order.customer?.email || undefined,
              ph: order.customer?.phone || undefined,
              fn: custName.trim().split(/\s+/)[0] || undefined,
              ln: custName.trim().split(/\s+/).slice(1).join(' ') || undefined,
              ct: address?.city || undefined,
              st: address?.province || address?.state || undefined,
              zp: address?.zip || address?.pincode || undefined,
              country: address?.country || undefined,
            },
            customData: {
              price: Number(order.totalPrice || 0),
              currency: order.currency || 'INR',
              item_ids: order.items?.map(toSnapItemId) || [],
              transaction_id: order.id,
              number_items: order.items?.length || 1,
            },
          }).catch(() => {}); // fire-and-forget; never block order response
        } catch (snapErr: any) {
          console.warn('[Verify] Snap CAPI Purchase fire failed:', snapErr.message);
        }

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
      }
    } catch (dbErr: any) {
      console.warn('[Verify] Failed to update local order:', dbErr.message);
    }

    return NextResponse.json({ success: true, payment_id: razorpay_payment_id }, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error('[Verify] Internal Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error during verification' },
      { status: 500, headers: corsHeaders }
    );
  }
}
