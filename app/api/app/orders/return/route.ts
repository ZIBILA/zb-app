import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { shopifyPatch } from '@/lib/shopify-admin';
import { createWithLinkedId } from '@/lib/linkedIds';
import { resolveRefundMethod, requestEligibilityError } from '@/lib/returnPolicy';
import { resolveRequestCustomer } from '@/lib/requestAuth';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

interface ReturnItem {
  lineItemId: string;
  quantity: number;
  reason: string;
  action?: 'return' | 'exchange';
}

export async function POST(req: Request) {
  try {
    const authCustomer = await resolveRequestCustomer(req);
    if (!authCustomer) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await req.json();
    const { orderId, items, notes, method, refundMethod } = body as {
      orderId: string;
      items: ReturnItem[];
      notes?: string;
      method?: 'DROP_OFF' | 'PICKUP';
      refundMethod?: 'ORIGINAL' | 'STORE_CREDIT';
    };

    if (!orderId || !items?.length) {
      return NextResponse.json(
        { success: false, error: 'orderId and items[] are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        customer: { select: { id: true, name: true, email: true, phone: true, storeCredits: true } },
        shipments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
        returnRequests: { select: { status: true, reason: true } },
        exchangeRequests: { select: { status: true } },
      },
    });

    // Same response for "missing" and "not yours" so order ids can't be probed.
    if (!order || order.customerId !== authCustomer.id) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Delivered + inside the shared window + no other active request (same rules as the website).
    const eligibilityError = requestEligibilityError(order as any, 'return');
    if (eligibilityError) {
      return NextResponse.json(
        { success: false, error: eligibilityError },
        { status: 400, headers: corsHeaders }
      );
    }

    // COD orders can only be refunded as store credit (policy); prepaid may choose.
    const effectiveRefundMethod = resolveRefundMethod(
      order,
      refundMethod === 'STORE_CREDIT' ? 'store_credit' : 'original_method'
    );
    const isStoreCredit = effectiveRefundMethod === 'store_credit';

    const returnRows: any[] = [];
    const exchangeRows: any[] = [];

    for (const item of items) {
      const orderItem = order.items.find(
        (oi: any) => oi.id === item.lineItemId || oi.shopifyLineItemId === item.lineItemId
      );

      if (!orderItem) continue;

      // Default action to 'return' if not specified (backward compatible)
      const action = item.action || 'return';

      if (action === 'return') {
        // Never trust the client quantity: 1..ordered quantity, whole units only.
        const orderedQty = Math.max(1, Math.floor(Number(orderItem.quantity) || 1));
        const qty = Math.min(orderedQty, Math.max(1, Math.floor(Number(item.quantity) || 1)));
        returnRows.push({
          orderId: order.id,
          productId: orderItem.productId || '',
          customerId: order.customerId,
          sku: orderItem.sku,
          quantity: qty,
          reason: item.reason || notes || 'Customer requested return via app',
          status: 'REQUESTED',
          returnMethod: method || null,
          refundMethod: effectiveRefundMethod,
          refundAmount: orderItem.price * qty,
          storeCreditAmount: isStoreCredit ? orderItem.price * qty : 0,
          refundStatus: 'PENDING',
          variantTitle: orderItem.variantTitle,
          size: orderItem.size,
          title: orderItem.title,
        });
      } else if (action === 'exchange') {
        if (!orderItem.productId) continue;
        exchangeRows.push({
          orderId: order.id,
          originalProductId: orderItem.productId,
          newProductId: orderItem.productId,
          status: 'REQUESTED',
          priceDifference: 0,
          qcStatus: 'pending',
          reason: item.reason || notes || 'Customer requested exchange via app',
          originalVariantTitle: orderItem.variantTitle,
          originalSize: orderItem.size,
        });
      }
    }

    // Group into proper requests so every return/exchange gets its linked id (R_ / E_)
    // and flows through the same admin state machine as the website.
    let createdReturns: any[] = [];
    let createdExchanges: any[] = [];
    let returnRequestRow: any = null;
    let exchangeRequestRow: any = null;

    if (returnRows.length > 0) {
      returnRequestRow = await createWithLinkedId(prisma as any, 'return', order, (displayId) => prisma.returnRequest.create({
        data: {
          displayId,
          refundType: isStoreCredit ? 'store_credit' : 'original_source',
          orderId: order.id,
          customerId: order.customerId,
          status: 'pending_approval',
          estimatedRefund: returnRows.reduce((sum, r) => sum + (r.refundAmount || 0), 0),
          reason: notes || returnRows[0].reason,
          returns: { create: returnRows.map(({ ...r }) => r) },
        },
        include: { returns: true },
      }));
      createdReturns = returnRequestRow.returns;
    }

    if (exchangeRows.length > 0) {
      exchangeRequestRow = await createWithLinkedId(prisma as any, 'exchange', order, (displayId) => prisma.exchangeRequest.create({
        data: {
          displayId,
          orderId: order.id,
          customerId: order.customerId,
          status: 'pending_approval',
          priceDifference: 0,
          paymentStatus: 'not_required',
          reason: notes || exchangeRows[0].reason,
          exchanges: { create: exchangeRows },
        },
        include: { exchanges: true },
      }));
      createdExchanges = exchangeRequestRow.exchanges;
    }

    const totalCreated = createdReturns.length + createdExchanges.length;
    if (totalCreated === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid items found for return/exchange' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Email + Shopify sync are non-critical for the customer — do them after the response.
    void (async () => {
      try {
        if (createdReturns.length > 0 || createdExchanges.length > 0) {
          const { sendRefundRequestNotification } = await import('@/lib/services/refundNotificationService');
          const isReturn = createdReturns.length > 0;
          const totalAmount = createdReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0);
          await sendRefundRequestNotification({
            returnRequestId: returnRequestRow?.id,
            exchangeRequestId: exchangeRequestRow?.id,
            orderId: order.id,
            shopifyOrderId: order.shopifyOrderId,
            customerName: order.customer?.name || 'Customer',
            customerEmail: order.customer?.email,
            customerPhone: order.customer?.phone,
            items: items.map((i) => {
              const oi = order.items.find((x: any) => x.id === i.lineItemId || x.shopifyLineItemId === i.lineItemId);
              return {
                title: oi?.title || oi?.name || 'Requested Item',
                sku: oi?.sku,
                quantity: i.quantity || 1,
                price: oi?.price || 0,
                reason: i.reason || notes,
              };
            }),
            totalRefundAmount: totalAmount,
            refundMethod: effectiveRefundMethod,
            reason: notes || items[0]?.reason,
            requestType: isReturn ? 'RETURN' : 'EXCHANGE',
          });
        }
      } catch (notifErr: any) {
        console.error('[AppOrderReturn] Notification email error:', notifErr);
      }

      if (order.shopifyOrderId) {
        try {
          const existingTags = (order as any).tags || '';
          const newTags = existingTags ? `${existingTags}, APP_RETURN_REQUEST` : 'APP_RETURN_REQUEST';
          const newNote = `${order.note || ''}\n\n[App Return/Exchange Request - ${new Date().toLocaleDateString()}]\nItems: ${items.map(i => `${i.action || 'return'}: ${i.lineItemId} (Reason: ${i.reason})`).join(', ')}${isStoreCredit ? '\nRefund: Store Credits' : ''}`;
          await shopifyPatch(`orders/${order.shopifyOrderId}.json`, {
            order: {
              id: parseInt(order.shopifyOrderId, 10),
              tags: newTags,
              note: newNote,
            }
          });
          await prisma.order.update({
            where: { id: order.id },
            data: { tags: newTags, note: newNote.trim() },
          });
        } catch (shopError: any) {
          console.warn(`[App API] Failed to sync to Shopify (non-critical):`, shopError.message);
        }
      }
    })();

    return NextResponse.json(
      {
        success: true,
        message: `${totalCreated} request(s) submitted successfully`,
        referenceNumber: returnRequestRow?.displayId || exchangeRequestRow?.displayId || `ZB-${createdReturns.length > 0 ? 'RET' : 'EXC'}-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        returnDisplayId: returnRequestRow?.displayId || null,
        exchangeDisplayId: exchangeRequestRow?.displayId || null,
        returnRequestId: returnRequestRow?.id || null,
        exchangeRequestId: exchangeRequestRow?.id || null,
        refundMethod: effectiveRefundMethod,
        returns: createdReturns.map((r: any) => ({ id: r.id, status: r.status, refundMethod: r.refundMethod })),
        exchanges: createdExchanges.map((e: any) => ({ id: e.id, status: e.status })),
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('[App API] Return/Exchange error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
