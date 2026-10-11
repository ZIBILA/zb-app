import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { orderBaseNumber } from '@/lib/linkedIds';
import { buildRequestSummaries } from '@/lib/services/requestEnrichment';
import { resolveRequestCustomer, resolveCustomerIdentityIds } from '@/lib/requestAuth';

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
 * GET /api/app/exchanges?customerId=...
 * GET /api/app/exchanges?phone=...
 * GET /api/app/exchanges?email=...
 *
 * List all exchange requests for a customer.
 * Used by the React Native app to show exchange status in Order Detail / Profile.
 */
export async function GET(req: Request) {
  try {
    // Identity comes from the verified token only. The customerId / phone / email query params
    // are ignored — they used to let anyone read another customer's exchanges.
    const authCustomer = await resolveRequestCustomer(req);
    if (!authCustomer) {
      return NextResponse.json(
        { exchanges: [], error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const customerIds = await resolveCustomerIdentityIds(authCustomer);

    // Find all orders for these customers, then get exchanges from those orders
    const orders = await prisma.order.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true },
    });

    const orderIds = orders.map((o: { id: string }) => o.id);

    if (orderIds.length === 0) {
      return NextResponse.json({ exchanges: [] }, { headers: corsHeaders });
    }

    const productSelect = { select: { id: true, title: true, shopifyProductId: true, featuredImage: true } };
    const productShape = (p: any, fallback: string) => ({
      id: p?.id || null,
      title: p?.title || fallback,
      shopifyProductId: p?.shopifyProductId || null,
      image: p?.featuredImage || null,
    });

    // Grouped requests (E_… ids with their G_E_… replacement)
    const requests = await prisma.exchangeRequest.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true, shopifyOrderId: true, shopifyOrderName: true, internalOrderNumber: true,
            paymentMethod: true, paymentStatus: true, tags: true, note: true, shipments: true,
          },
        },
        exchanges: { include: { originalProduct: productSelect, newProduct: productSelect } },
      },
    });

    const { exchangeSummaries } = await buildRequestSummaries(
      requests.map((e: any) => ({ ...e.order, returnRequests: [], exchangeRequests: [e] }))
    );

    const grouped = requests.map((req: any) => {
      const first = (req.exchanges || [])[0];
      const items = (req.exchanges || []).map((x: any) => ({
        id: x.id,
        originalProduct: productShape(x.originalProduct, 'Unknown'),
        newProduct: productShape(x.newProduct, 'Unknown'),
        originalSize: x.originalSize || null,
        newSize: x.newSize || null,
        reason: x.reason || null,
      }));
      return {
        id: req.id,
        requestId: req.id,
        kind: 'exchange',
        displayId: req.displayId || null,
        replacementDisplayId: req.replacementDisplayId || null,
        orderId: req.orderId,
        orderNumber: req.order ? orderBaseNumber(req.order) : null,
        originalProduct: items[0]?.originalProduct || productShape(null, 'Unknown'),
        newProduct: items[0]?.newProduct || productShape(null, 'Unknown'),
        items,
        status: req.status,
        priceDifference: req.priceDifference,
        paymentStatus: req.paymentStatus,
        newOrderId: req.replacementOrderId || first?.newOrderId || null,
        createdAt: req.createdAt,
        updatedAt: req.updatedAt,
        receivedAt: req.receivedAt || null,
        summary: exchangeSummaries.get(req.id) || null,
      };
    });

    // Legacy standalone rows (created before requests were grouped)
    const legacy = await prisma.exchange.findMany({
      where: { orderId: { in: orderIds }, exchangeRequestId: null },
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { id: true, shopifyOrderId: true, shopifyOrderName: true, internalOrderNumber: true } },
        originalProduct: productSelect,
        newProduct: productSelect,
      },
    });

    const legacyFormatted = legacy.map((e: any) => ({
      id: e.id,
      requestId: null,
      kind: 'exchange',
      displayId: null,
      replacementDisplayId: null,
      orderId: e.orderId,
      orderNumber: e.order ? orderBaseNumber(e.order) : null,
      originalProduct: productShape(e.originalProduct, 'Unknown'),
      newProduct: productShape(e.newProduct, 'Unknown'),
      status: e.status,
      priceDifference: e.priceDifference,
      paymentStatus: e.paymentStatus,
      newOrderId: e.newOrderId,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      receivedAt: null,
      summary: null,
    }));

    const formatted = [...grouped, ...legacyFormatted].sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({ exchanges: formatted }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[App API] Exchanges list error:', error.message);
    return NextResponse.json(
      { exchanges: [], error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
