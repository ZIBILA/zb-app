import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { enrichSingleItem } from "@/lib/enrichSize";
import { allocateLinkedId, parseLinkedId } from "@/lib/linkedIds";
import { resolveRefundMethod, isCodOrder } from "@/lib/returnPolicy";
import { countByReverseStageFilter } from "@/lib/returnPolicy";
import { filterByLiveStage, liveReverseFields } from "@/lib/services/reverseShipmentExtras";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = "force-dynamic";

const LIVE_STAGE_FILTERS = new Set([
  'pending',
  'pickup_scheduled',
  'in_transit',
  'failed',
  'received',
]);

async function GET_impl(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || searchParams.get('stage');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const isLiveFilter = LIVE_STAGE_FILTERS.has(String(status || '').toLowerCase());

    // Linked-id search (R_ZB…, E_ZB…, G_E_ZB…) is resolved server-side so it also finds older requests.
    const parsedQ = parseLinkedId(searchParams.get('search'));
    // Live stage filters are applied after deriveReverseStage — don't restrict DB status.
    const statusWhere: any =
      status && status !== 'all' && !isLiveFilter ? { status } : {};
    const baseWhere: any = parsedQ
      ? {
          ...statusWhere,
          OR: [
          { displayId: { contains: parsedQ.id, mode: 'insensitive' } },
          { order: { OR: [{ internalOrderNumber: { contains: parsedQ.baseNumber, mode: 'insensitive' } }, { shopifyOrderName: { contains: parsedQ.baseNumber, mode: 'insensitive' } }] } },
          ],
        }
      : statusWhere;
    // Auto-created pickups for exchanges (reason EXCHANGE_RETURN) belong to the exchange, not the Returns list.
    const notInternalExchange = { OR: [{ reason: null }, { NOT: { reason: { contains: 'EXCHANGE_RETURN' } } }] };
    const where: any = { AND: [baseWhere, notInternalExchange] };
    const standaloneWhere = parsedQ
      ? ({ id: '__none__' } as any)
      : status && status !== 'all' && !isLiveFilter
        ? { returnRequestId: null, status: status.toUpperCase() }
        : { returnRequestId: null };

    // Cap row fetch to avoid unbounded concurrent DB load (counts still via groupBy)
    const rowCap = Math.min(Math.max(limit + offset, limit), 100);

    const [returns, total, statusGroups, standaloneReturns, standaloneTotal, standaloneStatusGroups] = await Promise.all([
      prisma.returnRequest.findMany({
        where,
        include: {
          returns: {
            include: { product: true }
          },
          order: {
            include: {
              customer: true,
              shipments: {
                select: {
                  awb: true,
                  trackingNumber: true,
                  status: true,
                  currentLocation: true,
                  estimatedDelivery: true,
                  courier: true,
                  trackingUrl: true,
                },
              },
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: rowCap,
      }),
      prisma.returnRequest.count({ where }),
      prisma.returnRequest.groupBy({
        by: ['status'],
        where: notInternalExchange,
        _count: { id: true }
      }),
      prisma.return.findMany({
        where: standaloneWhere,
        include: {
          product: true,
          customer: true,
          order: {
            include: {
              customer: true,
              shipments: {
                select: {
                  awb: true,
                  trackingNumber: true,
                  status: true,
                  currentLocation: true,
                  estimatedDelivery: true,
                  courier: true,
                  trackingUrl: true,
                },
              },
            }
          }
        },
        orderBy: { requestedAt: "desc" },
        take: rowCap,
      }),
      prisma.return.count({ where: standaloneWhere }),
      prisma.return.groupBy({
        by: ['status'],
        where: { returnRequestId: null },
        _count: { id: true }
      })
    ]);

    const formattedReturns = await Promise.all(
      returns.map(async (r: any) => {
        const enrichedItems = await Promise.all(
          (r.returns || []).map(async (item: any) => {
            const enriched = await enrichSingleItem({
              ...item,
              title: item.title || item.product?.title || "Product",
              variantTitle: item.variantTitle || null,
              size: item.size || null,
            });
            return enriched;
          })
        );

        const live = liveReverseFields({
          requestStatus: r.status,
          receivedAt: r.receivedAt,
          reverseAwb: r.reverseAwb,
          shipments: r.order?.shipments,
        });
        return {
          returnRequestId: r.id,
          displayId: r.displayId || null,
          logisticsPartner: r.logisticsPartner || null,
          reverseAwb: r.reverseAwb || null,
          receivedAt: r.receivedAt || null,
          isCod: isCodOrder(r.order),
          orderId: r.orderId,
          shopifyOrderId: r.order?.shopifyOrderName || r.order?.internalOrderNumber || (r.order?.shopifyOrderId && `#${r.order.shopifyOrderId.replace('#', '')}`) || r.orderId,
          orderCreatedAt: r.order?.createdAt,
          userId: r.customerId,
          userName: r.order?.customer?.name || "Unknown",
          userEmail: r.order?.customer?.email || "",
          status: r.status,
          estimatedRefund: r.estimatedRefund,
          actualRefund: r.actualRefund,
          createdAt: r.createdAt,
          items: enrichedItems,
          ...live,
        };
      })
    );

    const formattedStandalone = await Promise.all(
      standaloneReturns.map(async (sr: any) => {
        const rawItem = {
          id: sr.id,
          productId: sr.productId,
          sku: sr.sku,
          quantity: sr.quantity || 1,
          reason: sr.reason,
          refundAmount: sr.refundAmount,
          status: sr.status,
          product: sr.product,
          title: sr.title || sr.product?.title || "Product",
          variantTitle: sr.variantTitle || null,
          size: sr.size || null,
        };
        const enrichedItem = await enrichSingleItem(rawItem);

        const live = liveReverseFields({
          requestStatus: sr.status?.toLowerCase(),
          receivedAt: null,
          reverseAwb: null,
          shipments: sr.order?.shipments,
        });
        return {
          returnRequestId: sr.id,
          isCod: isCodOrder(sr.order),
          orderId: sr.orderId,
          shopifyOrderId: sr.order?.shopifyOrderName || sr.order?.internalOrderNumber || (sr.order?.shopifyOrderId && `#${sr.order.shopifyOrderId.replace('#', '')}`) || sr.orderId,
          orderCreatedAt: sr.order?.createdAt,
          userId: sr.customerId,
          userName: sr.order?.customer?.name || sr.customer?.name || "Unknown",
          userEmail: sr.order?.customer?.email || sr.customer?.email || "",
          status: sr.status.toLowerCase(),
          estimatedRefund: sr.refundAmount || 0,
          actualRefund: sr.refundAmount || null,
          createdAt: sr.requestedAt || sr.updatedAt,
          isStandalone: true,
          items: [enrichedItem],
          ...live,
        };
      })
    );

    const combined = [...formattedReturns, ...formattedStandalone].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const statusCounts: Record<string, number> = {
      ...countByReverseStageFilter(combined.map((r: any) => r.liveStage)),
    };
    
    // Keep legacy DB status counts for refunded/rejected chips
    statusGroups.forEach((g: any) => {
      const s = g.status.toLowerCase();
      statusCounts[s] = (statusCounts[s] || 0) + g._count.id;
    });
    standaloneStatusGroups.forEach((g: any) => {
      const s = g.status.toLowerCase();
      statusCounts[s] = (statusCounts[s] || 0) + g._count.id;
    });

    const stageFiltered = isLiveFilter || status === 'rejected' || status === 'refunded'
      ? filterByLiveStage(combined, status)
      : combined;
    const paginated = stageFiltered.slice(offset, offset + limit);

    return NextResponse.json({
      returns: paginated,
      total: stageFiltered.length,
      statusCounts
    });
  } catch (error: any) {
    console.error("Fetch Admin Returns Error:", error?.message || "db error");
    return NextResponse.json({ error: "Failed to fetch returns" }, { status: 500 });
  }
}

async function POST_impl(req: Request) {
  try {
    const { orderId, customerId, items, estimatedRefund } = await req.json();

    if (!orderId || !items || !items.length) {
      return NextResponse.json({ error: "Order ID and items are required" }, { status: 400 });
    }

    // Resolve product IDs and metadata for each item
    const resolvedItems = await Promise.all(items.map(async (item: any) => {
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: item.lineItemId }
      });
      
      if (!orderItem) {
        throw new Error(`Order item ${item.lineItemId} not found`);
      }

      return {
        productId: orderItem.productId,
        sku: orderItem.sku,
        quantity: item.quantity || orderItem.quantity,
        reason: item.reason || "Admin manual return",
        refundAmount: (orderItem.price * (item.quantity || orderItem.quantity)),
        variantTitle: orderItem.variantTitle,
        size: orderItem.size,
        title: orderItem.title,
      };
    }));

    const parentOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!parentOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const displayId = await allocateLinkedId(prisma as any, 'return', parentOrder);
    const manualRefundMethod = resolveRefundMethod(parentOrder, null);

    const returnRequest = await prisma.$transaction(async (tx: any) => {
      const rr = await tx.returnRequest.create({
        data: {
          displayId,
          refundType: manualRefundMethod === 'store_credit' ? 'store_credit' : 'original_source',
          orderId,
          customerId,
          estimatedRefund: parseFloat(estimatedRefund) || resolvedItems.reduce((acc: any, i: any) => acc + i.refundAmount, 0),
          status: 'pending_approval',
          returns: {
            create: resolvedItems.map((item: any) => ({
              productId: item.productId,
              customerId: customerId,
              orderId: orderId,
              sku: item.sku,
              quantity: item.quantity,
              reason: item.reason,
              refundAmount: item.refundAmount,
              status: "REQUESTED",
              refundMethod: manualRefundMethod,
              refundStatus: "PENDING",
              variantTitle: item.variantTitle,
              size: item.size,
              title: item.title,
            }))
          }
        },
        include: {
          returns: true
        }
      });

      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'return_initiated' }
      });

      return rr;
    });

    return NextResponse.json({ success: true, returnRequest });
  } catch (error: any) {
    console.error("Create Admin Return Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: any) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'view');
  } catch (authError) {
    return handleAuthError(authError);
  }
  return (GET_impl as any)(req, ctx);
}

export async function POST(req: Request, ctx: any) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
  } catch (authError) {
    return handleAuthError(authError);
  }
  return (POST_impl as any)(req, ctx);
}
