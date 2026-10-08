import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { orderBaseNumber } from '@/lib/linkedIds';
import { buildRequestSummaries, isInternalExchangeReturn } from '@/lib/services/requestEnrichment';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * GET /api/app/returns?customerId=...
 * GET /api/app/returns?phone=...
 * GET /api/app/returns?email=...
 *
 * List all return requests for a customer.
 * Used by the React Native app to show return status in Order Detail / Profile.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const customerId = url.searchParams.get('customerId')?.trim();
    const phone = url.searchParams.get('phone')?.trim();
    const email = url.searchParams.get('email')?.trim();

    if (!customerId && !phone && !email) {
      return NextResponse.json(
        { returns: [], error: 'customerId, phone or email query parameter required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Resolve customer IDs
    const customerWhere: any = { OR: [] };
    if (customerId) customerWhere.OR.push({ id: customerId });
    if (phone) customerWhere.OR.push({ phone });
    if (email) customerWhere.OR.push({ email });

    const customers = await prisma.customer.findMany({
      where: customerWhere,
      select: { id: true },
    });

    if (customers.length === 0) {
      return NextResponse.json({ returns: [] }, { headers: corsHeaders });
    }

    const customerIds = customers.map((c: { id: string }) => c.id);

    // Grouped requests (R_… ids) — the same records the website and admin work with.
    const allRequests = await prisma.returnRequest.findMany({
      where: {
        OR: [{ customerId: { in: customerIds } }, { order: { customerId: { in: customerIds } } }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true, shopifyOrderId: true, shopifyOrderName: true, internalOrderNumber: true,
            paymentMethod: true, paymentStatus: true, tags: true, note: true, shipments: true,
          },
        },
        returns: {
          include: {
            product: { select: { id: true, title: true, shopifyProductId: true, featuredImage: true } },
          },
        },
      },
    });

    // The auto-created return behind an exchange is internal — customers only see the exchange.
    const requests = allRequests.filter((r: any) => !isInternalExchangeReturn(r));

    const { returnSummaries } = await buildRequestSummaries(
      requests.map((r: any) => ({ ...r.order, returnRequests: [r], exchangeRequests: [] }))
    );

    const formatItem = (r: any) => ({
      id: r.id,
      product: {
        id: r.product?.id || null,
        title: r.product?.title || r.title || 'Unknown Product',
        shopifyProductId: r.product?.shopifyProductId || null,
        image: r.product?.featuredImage || null,
      },
      sku: r.sku,
      quantity: r.quantity,
      size: r.size || null,
      reason: r.reason,
    });

    const grouped = requests.map((req: any) => {
      const summary = returnSummaries.get(req.id) || null;
      const first = (req.returns || [])[0];
      const items = (req.returns || []).map(formatItem);
      return {
        id: req.id,
        requestId: req.id,
        kind: 'return',
        displayId: req.displayId || null,
        orderId: req.orderId,
        orderNumber: req.order ? orderBaseNumber(req.order) : null,
        product: items[0]?.product || { id: null, title: 'Product', shopifyProductId: null, image: null },
        items,
        sku: first?.sku || null,
        reason: req.reason || first?.reason || '',
        status: req.status,
        returnMethod: first?.returnMethod || null,
        trackingNumber: req.reverseAwb || null,
        refundAmount: req.actualRefund ?? req.estimatedRefund ?? 0,
        refundStatus: summary?.refund?.stateLabel || first?.refundStatus || null,
        requestedAt: req.createdAt,
        updatedAt: req.updatedAt,
        receivedAt: req.receivedAt || null,
        summary,
      };
    });

    // Legacy standalone item rows (created before requests were grouped)
    const legacy = await prisma.return.findMany({
      where: { customerId: { in: customerIds }, returnRequestId: null },
      orderBy: { requestedAt: 'desc' },
      include: {
        order: { select: { id: true, shopifyOrderId: true, shopifyOrderName: true, internalOrderNumber: true, totalPrice: true } },
        product: { select: { id: true, title: true, shopifyProductId: true, featuredImage: true } },
      },
    });

    const legacyFormatted = legacy.map((r: any) => ({
      id: r.id,
      requestId: null,
      kind: 'return',
      displayId: null,
      orderId: r.orderId,
      orderNumber: r.order ? orderBaseNumber(r.order) : null,
      product: {
        id: r.product?.id || null,
        title: r.product?.title || 'Unknown Product',
        shopifyProductId: r.product?.shopifyProductId || null,
        image: r.product?.featuredImage || null,
      },
      sku: r.sku,
      reason: r.reason,
      status: r.status,
      returnMethod: r.returnMethod,
      trackingNumber: r.trackingNumber,
      refundAmount: r.refundAmount,
      refundStatus: r.refundStatus,
      requestedAt: r.requestedAt,
      updatedAt: r.updatedAt,
      receivedAt: null,
      summary: null,
    }));

    const formatted = [...grouped, ...legacyFormatted].sort(
      (a: any, b: any) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );

    return NextResponse.json({ returns: formatted }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[App API] Returns list error:', error.message);
    return NextResponse.json(
      { returns: [], error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
