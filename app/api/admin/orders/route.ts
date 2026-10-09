import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { enrichItemsWithSize } from '@/lib/enrichSize';
import { resolveStoredCodUpfrontPaid, DEFAULT_COD_UPFRONT_AMOUNT } from '@/lib/cod-upfront';
import { parseLinkedId } from '@/lib/linkedIds';
import { isLogisticsFilter, LOGISTICS_BUCKET_STATUSES, pickActiveOutboundShipment, shipmentAwb } from '@/lib/logistics/status';

/** Same definition of "COD order" the rest of the app uses (see isCodOrder below). */
const COD_ORDER_WHERE = {
  OR: [
    { paymentMethod: { equals: 'cod', mode: 'insensitive' } },
    { tags: { contains: 'cod', mode: 'insensitive' } },
    { note: { contains: 'cod order', mode: 'insensitive' } },
    { note: { contains: 'upfront fee paid', mode: 'insensitive' } },
    { paymentStatus: { in: ['cod_upfront_paid', 'partially_paid'] } },
  ],
} as const;

const PAID_LIKE = ['paid', 'PAID', 'success', 'SUCCESS'];
const COD_PAID_LIKE = [...PAID_LIKE, 'cod_upfront_paid', 'partially_paid'];
const REFUNDED_LIKE = ['refunded', 'REFUNDED', 'partially_refunded', 'PARTIALLY_REFUNDED'];

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requirePermission('ORDERS', 'view');
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const paymentStatus = searchParams.get('paymentStatus');
    const fulfillmentStatus = searchParams.get('fulfillmentStatus');
    const logisticsParam = searchParams.get('logistics');
    const search = searchParams.get('search');
    const conditions: Record<string, unknown>[] = [];
    const isExplicitQuery =
      (paymentStatus && paymentStatus !== 'any') ||
      (status && status !== 'any') ||
      (logisticsParam && logisticsParam !== 'any') ||
      Boolean(search);

    if (!isExplicitQuery) {
      conditions.push({
        NOT: {
          OR: [
            // Exclude failed order numbers
            { internalOrderNumber: { startsWith: 'ZBPF' } },
            // Exclude pending orders that never completed payment
            {
              AND: [
                { internalOrderNumber: { startsWith: 'ZBPP' } },
                { paymentStatus: { in: ['pending', 'payment_pending', 'failed', 'payment_failed'] } }
              ]
            },
            // Exclude mobile app orders awaiting approval
            {
              AND: [
                { orderType: 'MOBILE_APP' },
                { status: 'awaiting_approval' }
              ]
            },
            // Exclude cancelled Shopify orders (payment timed out, customer cancelled, etc.)
            { status: 'cancelled' },
            // Exclude orders with voided/cancelled payment
            { paymentStatus: { in: ['cancelled', 'CANCELLED', 'canceled', 'CANCELED', 'voided', 'VOIDED'] } },
          ]
        }
      });
    }

    if (status && status !== 'any') {
      conditions.push({ status });
    }

    if (paymentStatus && paymentStatus !== 'any') {
      if (paymentStatus === 'failed') {
        conditions.push({ 
          OR: [
            { paymentStatus: { in: ['failed', 'payment_failed', 'FAILED', 'PAYMENT_FAILED', 'voided'] } },
            { status: 'payment_failed' },
            { internalOrderNumber: { startsWith: 'ZBPF' } }
          ]
        });
      } else if (paymentStatus === 'settled') {
        // Paid / Settled: prepaid orders that are paid, plus COD orders whose cash was
        // collected on delivery. COD orders still awaiting delivery are "COD Upfront".
        conditions.push({
          OR: [
            { AND: [{ NOT: COD_ORDER_WHERE }, { paymentStatus: { in: PAID_LIKE } }] },
            { AND: [COD_ORDER_WHERE, { deliveryStatus: 'delivered' }, { paymentStatus: { in: COD_PAID_LIKE } }] },
          ],
        });
      } else if (paymentStatus === 'cod_upfront') {
        conditions.push({
          AND: [
            COD_ORDER_WHERE,
            { paymentStatus: { in: COD_PAID_LIKE } },
            { NOT: { deliveryStatus: 'delivered' } },
          ],
        });
      } else if (paymentStatus === 'refunded') {
        conditions.push({
          OR: [
            { paymentStatus: { in: REFUNDED_LIKE } },
            { refundStatus: { in: ['completed', 'COMPLETED'] } },
          ],
        });
      } else if (paymentStatus === 'pending') {
        conditions.push({ 
          OR: [
            { paymentStatus: { in: ['pending', 'payment_pending', 'PENDING', 'PAYMENT_PENDING'] } },
            { internalOrderNumber: { startsWith: 'ZBPP' } }
          ]
        });
      } else {
        conditions.push({ paymentStatus });
      }
    }

    if (fulfillmentStatus && fulfillmentStatus !== 'any') {
      conditions.push({ fulfillmentStatus });
    }

    if (isLogisticsFilter(logisticsParam) && logisticsParam !== 'any') {
      if (logisticsParam === 'returned') {
        conditions.push({
          OR: [
            { returnRequests: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
            { returns: { some: { status: { notIn: ['CANCELLED', 'REJECTED'] } } } },
          ],
        });
      } else if (logisticsParam === 'exchanged') {
        conditions.push({
          OR: [
            { exchangeRequests: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
            { exchanges: { some: { status: { notIn: ['CANCELLED', 'REJECTED'] } } } },
            { orderType: 'EXCHANGE' },
          ],
        });
      } else if (logisticsParam === 'rto') {
        // RTO bucket = RTO delivery statuses, plus orders auto-tagged RTO that have not been re-shipped yet.
        conditions.push({
          OR: [
            { deliveryStatus: { in: LOGISTICS_BUCKET_STATUSES.rto } },
            {
              AND: [
                { tags: { contains: 'RTO', mode: 'insensitive' } },
                { NOT: { tags: { contains: 'Reshipped', mode: 'insensitive' } } },
                { deliveryStatus: { notIn: ['delivered', 'cancelled'] } },
              ],
            },
          ],
        });
      } else {
        conditions.push({ deliveryStatus: { in: LOGISTICS_BUCKET_STATUSES[logisticsParam] } });
      }
    }

    if (search) {
      const trimmed = search.trim();
      const digitsOnly = trimmed.replace(/\D/g, '');
      const searchClauses: Record<string, unknown>[] = [];

      // 1. Phone number search (if 7+ digits)
      if (digitsOnly.length >= 7) {
        const last10 = digitsOnly.slice(-10);
        searchClauses.push(
          { customer: { phone: { contains: last10 } } },
          { customer: { phoneLast10: { contains: last10 } } }
        );
      }

      // 2. Email search (if contains @)
      if (trimmed.includes('@')) {
        searchClauses.push({ customer: { email: { contains: trimmed, mode: 'insensitive' } } });
      }

      // 3. Order number / Shopify identifier search
      if (trimmed.startsWith('#') || /^\d+$/.test(trimmed) || trimmed.toUpperCase().startsWith('ZB')) {
        const cleanNum = trimmed.replace(/^#/, '');
        searchClauses.push(
          { shopifyOrderName: { contains: trimmed, mode: 'insensitive' } },
          { shopifyOrderName: { contains: cleanNum, mode: 'insensitive' } },
          { internalOrderNumber: { contains: trimmed, mode: 'insensitive' } },
          { internalOrderNumber: { contains: cleanNum, mode: 'insensitive' } },
          { shopifyOrderId: { contains: cleanNum, mode: 'insensitive' } }
        );
      }

      // 3b. Linked ids: R_ZB… (return), E_ZB… (exchange), G_E_ZB… (replacement shipment)
      const linked = parseLinkedId(trimmed);
      if (linked) {
        searchClauses.push(
          { returnRequests: { some: { displayId: { contains: linked.id, mode: 'insensitive' } } } },
          {
            exchangeRequests: {
              some: {
                OR: [
                  { displayId: { contains: linked.id, mode: 'insensitive' } },
                  { replacementDisplayId: { contains: linked.id, mode: 'insensitive' } },
                ],
              },
            },
          },
          // the replacement order itself (internalOrderNumber = G_E_…) and the original order
          { internalOrderNumber: { contains: linked.id, mode: 'insensitive' } },
          { internalOrderNumber: { equals: linked.baseNumber, mode: 'insensitive' } },
          { shopifyOrderName: { contains: linked.baseNumber, mode: 'insensitive' } }
        );
      }

      // 4. General search: customer name, email, and order name
      if (searchClauses.length === 0) {
        searchClauses.push(
          { shopifyOrderName: { contains: trimmed, mode: 'insensitive' } },
          { internalOrderNumber: { contains: trimmed, mode: 'insensitive' } },
          { customer: { name: { contains: trimmed, mode: 'insensitive' } } },
          { customer: { email: { contains: trimmed, mode: 'insensitive' } } }
        );
      }

      conditions.push({ OR: searchClauses });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            }
          },
          items: true,
          shipments: {
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          returnRequests: { select: { id: true, displayId: true, status: true }, orderBy: { createdAt: 'desc' } },
          exchangeRequests: { select: { id: true, displayId: true, status: true }, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.order.count({ where })
    ]);

    // ─── BATCHED WEB STORE ORDER LOOKUP (ELIMINATES N+1 DB QUERIES) ───
    const razorpayIds = orders.map((o: Record<string, unknown>) => o.razorpayOrderId as string).filter(Boolean);
    const localIdNotes = orders.map((o: Record<string, unknown>) => `Local: ${o.id as string}`);
    const shopifyIdNotes = orders.map((o: Record<string, unknown>) => o.shopifyOrderId ? `Shopify: ${o.shopifyOrderId as string}` : null).filter(Boolean) as string[];

    const orClauses: Record<string, unknown>[] = [];
    if (razorpayIds.length > 0) {
      orClauses.push({ razorpayOrderId: { in: razorpayIds } });
    }
    localIdNotes.forEach((noteStr: string) => {
      orClauses.push({ notes: { contains: noteStr } });
    });
    shopifyIdNotes.forEach((noteStr: string) => {
      orClauses.push({ notes: { contains: noteStr } });
    });

    const webStoreOrders = orClauses.length > 0
      ? await prisma.webStoreOrder.findMany({ where: { OR: orClauses as Prisma.WebStoreOrderWhereInput[] } })
      : [];

    const byRazorpayId = new Map<string, Record<string, unknown>>();
    const byNotes = new Map<string, Record<string, unknown>>();

    webStoreOrders.forEach((wso: Record<string, unknown>) => {
      if (wso.razorpayOrderId) byRazorpayId.set(wso.razorpayOrderId as string, wso);
      if (wso.notes) byNotes.set(wso.notes as string, wso);
    });

    const enrichedOrders = orders.map((order: Record<string, unknown>) => {
      let webStoreOrder: Record<string, unknown> | null = null;
      if (order.razorpayOrderId) {
        webStoreOrder = byRazorpayId.get(order.razorpayOrderId as string) || null;
      }
      if (!webStoreOrder) {
        for (const [notes, wso] of byNotes.entries()) {
          if (notes.includes(`Local: ${order.id as string}`)) {
            webStoreOrder = wso;
            break;
          }
        }
      }
      if (!webStoreOrder && order.shopifyOrderId) {
        for (const [notes, wso] of byNotes.entries()) {
          if (notes.includes(`Shopify: ${order.shopifyOrderId as string}`)) {
            webStoreOrder = wso;
            break;
          }
        }
      }

      const rawMethod = ((webStoreOrder?.paymentMethod as string) || (order.paymentMethod as string) || '').toLowerCase();
      const tagsLower = ((order.tags as string) || '').toLowerCase();
      const noteLower = ((order.note as string) || '').toLowerCase();
      const isCodOrder = rawMethod === 'cod' || tagsLower.includes('cod') || noteLower.includes('cod order') || noteLower.includes('upfront fee paid');
      const paymentMethod = isCodOrder ? 'COD' : ((webStoreOrder?.paymentMethod as string) || (order.paymentMethod as string) || 'razorpay');
      let paymentStatus = (webStoreOrder?.paymentStatus as string) || (order.paymentStatus as string);
      // COD lifecycle: upfront paid → (delivered + cash collected by courier) → Paid / Settled.
      const isDelivered = String(order.deliveryStatus || '').toLowerCase() === 'delivered';
      const settledCod =
        isCodOrder &&
        isDelivered &&
        ['paid', 'cod_upfront_paid', 'partially_paid', 'pending', 'payment_pending'].includes(
          String(paymentStatus || '').toLowerCase()
        );
      if (settledCod) {
        paymentStatus = 'paid';
      } else if (isCodOrder && paymentStatus === 'paid') {
        paymentStatus = 'cod_upfront_paid';
      }

      let discountAmount = webStoreOrder?.discountAmount 
        ? Number(webStoreOrder.discountAmount) 
        : ((order.discountAmount as number) || 0);

      const discountCode = (webStoreOrder?.discountCode as string) || (order.discountCode as string);
      if (isCodOrder && discountCode && discountCode.toUpperCase().includes('PREPAID')) {
        discountAmount = 0;
      }

      const paymentProofId =
        (webStoreOrder?.codUpfrontPaymentId as string) ||
        (webStoreOrder?.razorpayPaymentId as string) ||
        ((order as any).codUpfrontPaymentId as string) ||
        (order.razorpayPaymentId as string) ||
        null;
      const codUpfrontPaid = isCodOrder
        ? resolveStoredCodUpfrontPaid({
            storedPaid:
              Number(webStoreOrder?.codUpfrontPaid) ||
              Number((order as any).codUpfrontPaid) ||
              0,
            paymentStatus,
            paymentMethod: order.paymentMethod as string,
            tags: order.tags as string,
            note: order.note as string,
            paymentId: paymentProofId,
            configuredFallback: DEFAULT_COD_UPFRONT_AMOUNT,
          })
        : 0;

      const totalPrice = order.totalPrice;
      
      let paidAmount = 0;
      if (isCodOrder) {
        paidAmount = settledCod ? (totalPrice as number) : codUpfrontPaid;
      } else if (paymentStatus === 'paid' || paymentStatus === 'success') {
        paidAmount = totalPrice as number;
      }

      const orderIdStr = order.id as string;
      const shopifyIdStr = order.shopifyOrderId as string;
      const displayOrderNumber = (order.internalOrderNumber as string) || (order.shopifyOrderName as string) || (shopifyIdStr && !shopifyIdStr.startsWith('app_') ? `#${shopifyIdStr.replace('#', '')}` : null) || `#${orderIdStr.slice(-6).toUpperCase()}`;

      // Forward shipment only (never a cancelled one or a return/exchange pickup).
      const latestShipment: any = pickActiveOutboundShipment(order.shipments as any[]);
      const trackingNumber = shipmentAwb(latestShipment) || (latestShipment ? null : (order.delhivery_awb as string)) || (latestShipment ? null : (webStoreOrder?.trackingNumber as string)) || null;
      const trackingUrl = latestShipment?.trackingUrl || (webStoreOrder?.trackingUrl as string) || (trackingNumber ? `https://zicabella.shiprocket.co/tracking/${trackingNumber}` : null);
      const courier = latestShipment?.courier || (order.delhivery_awb ? 'Delhivery' : (trackingNumber ? 'Standard Express' : null));

      return {
        ...order,
        displayOrderNumber,
        totalPrice,
        codUpfrontPaid,
        paymentMethod,
        paymentStatus,
        paidAmount,
        discountAmount,
        trackingNumber,
        trackingUrl,
        courier,
      };
    });

    const fullyEnrichedOrders = await Promise.all(
      enrichedOrders.map(async (order: Record<string, unknown>) => ({
        ...order,
        items: await enrichItemsWithSize((order.items as Record<string, unknown>[]) || [], order)
      }))
    );

    return NextResponse.json({
      success: true,
      orders: fullyEnrichedOrders,
      total,
      hasMore: total > offset + limit
    });
  } catch (error: unknown) {
    return handleAuthError(error);
  }
}
