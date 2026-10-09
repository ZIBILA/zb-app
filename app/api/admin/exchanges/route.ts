import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { enrichSingleItem } from "@/lib/enrichSize";
import { extractItemVariantAndSize } from "@/lib/utils";
import { allocateLinkedId, parseLinkedId } from "@/lib/linkedIds";
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

const SHIPMENT_SELECT = {
  awb: true,
  trackingNumber: true,
  status: true,
  currentLocation: true,
  estimatedDelivery: true,
  courier: true,
  trackingUrl: true,
} as const;

async function GET_impl(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || searchParams.get('stage');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const isLiveFilter = LIVE_STAGE_FILTERS.has(String(status || '').toLowerCase());

    // Linked-id search (R_ZB…, E_ZB…, G_E_ZB…) is resolved server-side so it also finds older requests.
    const parsedQ = parseLinkedId(searchParams.get('search'));
    const statusWhere: any =
      status && status !== 'all' && !isLiveFilter ? { status } : {};
    const where: any = parsedQ
      ? {
          ...statusWhere,
          OR: [
          { displayId: { contains: parsedQ.id, mode: 'insensitive' } },
          { replacementDisplayId: { contains: parsedQ.id, mode: 'insensitive' } },
          { order: { OR: [{ internalOrderNumber: { contains: parsedQ.baseNumber, mode: 'insensitive' } }, { shopifyOrderName: { contains: parsedQ.baseNumber, mode: 'insensitive' } }] } },
          ],
        }
      : statusWhere;
    const standaloneWhere = parsedQ
      ? ({ id: '__none__' } as any)
      : status && status !== 'all' && !isLiveFilter
        ? { exchangeRequestId: null, status: status.toUpperCase() }
        : { exchangeRequestId: null };

    // Cap row fetch to avoid unbounded concurrent DB load (counts still via groupBy)
    const rowCap = Math.min(Math.max(limit + offset, limit), 100);

    const [exchanges, total, statusGroups, standaloneExchanges, standaloneTotal, standaloneStatusGroups] = await Promise.all([
      prisma.exchangeRequest.findMany({
        where,
        include: {
          exchanges: {
            include: { originalProduct: true, newProduct: true }
          },
          order: {
            include: { customer: true, shipments: { select: SHIPMENT_SELECT } }
          }
        },
        orderBy: { createdAt: "desc" },
        take: rowCap,
      }),
      prisma.exchangeRequest.count({ where }),
      prisma.exchangeRequest.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
      prisma.exchange.findMany({
        where: standaloneWhere,
        include: {
          originalProduct: true,
          newProduct: true,
          order: {
            include: { customer: true, shipments: { select: SHIPMENT_SELECT } }
          }
        },
        orderBy: { createdAt: "desc" },
        take: rowCap,
      }),
      prisma.exchange.count({ where: standaloneWhere }),
      prisma.exchange.groupBy({
        by: ['status'],
        where: { exchangeRequestId: null },
        _count: { id: true }
      })
    ]);

    const enrichExchangeItem = async (ex: any) => {
      let origSize = ex.originalSize;
      let origVariant = ex.originalVariantTitle;

      if (!origSize || !origVariant) {
        const enrichedOrig = await enrichSingleItem({
          title: ex.originalProduct?.title,
          sku: ex.originalProduct?.sku,
          productId: ex.originalProductId,
          size: ex.originalSize,
          variantTitle: ex.originalVariantTitle,
        });
        origSize = origSize || enrichedOrig.size;
        origVariant = origVariant || enrichedOrig.variantTitle;
      }

      let newSize = ex.newSize;
      let newVariant = ex.newVariantTitle;

      if (!newSize || !newVariant) {
        const enrichedNew = await enrichSingleItem({
          title: ex.newProduct?.title,
          sku: ex.newProduct?.sku,
          productId: ex.newProductId,
          size: ex.newSize,
          variantTitle: ex.newVariantTitle,
        });
        newSize = newSize || enrichedNew.size;
        newVariant = newVariant || enrichedNew.variantTitle;
      }

      return {
        ...ex,
        originalSize: origSize || null,
        originalVariant: origVariant || (origSize ? `Size: ${origSize}` : null),
        originalVariantTitle: origVariant || null,
        newSize: newSize || null,
        newVariant: newVariant || (newSize ? `Size: ${newSize}` : null),
        newVariantTitle: newVariant || null,
      };
    };

    const formattedExchanges = await Promise.all(
      exchanges.map(async (e: any) => {
        const enrichedItems = await Promise.all((e.exchanges || []).map(enrichExchangeItem));
        const live = liveReverseFields({
          requestStatus: e.status,
          receivedAt: e.receivedAt,
          reverseAwb: e.reverseAwb,
          shipments: e.order?.shipments,
        });
        return {
          exchangeRequestId: e.id,
          displayId: e.displayId || null,
          replacementDisplayId: e.replacementDisplayId || null,
          logisticsPartner: e.logisticsPartner || null,
          reverseAwb: e.reverseAwb || null,
          receivedAt: e.receivedAt || null,
          orderId: e.orderId,
          shopifyOrderId: e.order?.shopifyOrderName || e.order?.internalOrderNumber || (e.order?.shopifyOrderId && `#${e.order.shopifyOrderId.replace('#', '')}`) || e.orderId,
          orderCreatedAt: e.order?.createdAt,
          userId: e.customerId,
          userName: e.order?.customer?.name || "Unknown",
          userEmail: e.order?.customer?.email || "",
          status: e.status,
          priceDifference: e.priceDifference,
          paymentStatus: e.paymentStatus,
          createdAt: e.createdAt,
          reason: e.reason,
          returnRequestId: e.returnRequestId,
          newShopifyOrderId: e.newShopifyOrderId,
          items: enrichedItems,
          ...live,
        };
      })
    );

    const formattedStandalone = await Promise.all(
      standaloneExchanges.map(async (se: any) => {
        const enrichedItem = await enrichExchangeItem({
          id: se.id,
          orderId: se.orderId,
          originalProductId: se.originalProductId,
          newProductId: se.newProductId,
          status: se.status,
          priceDifference: se.priceDifference,
          createdAt: se.createdAt,
          updatedAt: se.updatedAt,
          paymentStatus: se.paymentStatus,
          newOrderId: se.newOrderId,
          exchangeRequestId: null,
          reason: se.reason,
          qcStatus: se.qcStatus,
          qcNotes: se.qcNotes,
          originalProduct: se.originalProduct,
          newProduct: se.newProduct,
          originalVariantTitle: se.originalVariantTitle,
          originalSize: se.originalSize,
          newVariantTitle: se.newVariantTitle,
          newSize: se.newSize,
        });

        const live = liveReverseFields({
          requestStatus: se.status?.toLowerCase(),
          receivedAt: null,
          reverseAwb: null,
          shipments: se.order?.shipments,
        });
        return {
          exchangeRequestId: se.id,
          orderId: se.orderId,
          shopifyOrderId: se.order?.shopifyOrderName || se.order?.internalOrderNumber || (se.order?.shopifyOrderId && `#${se.order.shopifyOrderId.replace('#', '')}`) || se.orderId,
          orderCreatedAt: se.order?.createdAt,
          userId: se.order?.customerId || "",
          userName: se.order?.customer?.name || "Unknown",
          userEmail: se.order?.customer?.email || "",
          status: se.status.toLowerCase(),
          priceDifference: se.priceDifference || 0,
          paymentStatus: se.paymentStatus || 'not_required',
          createdAt: se.createdAt,
          reason: se.reason,
          returnRequestId: null,
          newShopifyOrderId: se.newOrderId,
          isStandalone: true,
          items: [enrichedItem],
          ...live,
        };
      })
    );

    const combined = [...formattedExchanges, ...formattedStandalone].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const statusCounts: Record<string, number> = {
      ...countByReverseStageFilter(combined.map((e: any) => e.liveStage)),
    };
    
    statusGroups.forEach((g: any) => {
      const s = g.status.toLowerCase();
      statusCounts[s] = (statusCounts[s] || 0) + g._count.id;
    });
    standaloneStatusGroups.forEach((g: any) => {
      const s = g.status.toLowerCase();
      statusCounts[s] = (statusCounts[s] || 0) + g._count.id;
    });

    const stageFiltered =
      isLiveFilter ||
      status === 'rejected' ||
      status === 'completed' ||
      status === 'new_order_created'
        ? filterByLiveStage(combined, status)
        : combined;
    const paginated = stageFiltered.slice(offset, offset + limit);

    return NextResponse.json({
      exchanges: paginated,
      total: stageFiltered.length,
      statusCounts
    });
  } catch (error: any) {
    console.error("Fetch Admin Exchanges Error:", error?.message || "db error");
    return NextResponse.json({ error: "Failed to fetch exchanges" }, { status: 500 });
  }
}

async function POST_impl(req: Request) {
  try {
    const { orderId, customerId, items } = await req.json();

    if (!orderId || !items || !items.length) {
      return NextResponse.json({ error: "Order ID and items are required" }, { status: 400 });
    }

    const resolvedExchanges = await Promise.all(items.map(async (item: any) => {
      const originalItem = await prisma.orderItem.findUnique({
        where: { id: item.originalLineItemId }
      });

      if (!originalItem) {
        throw new Error(`Original order item ${item.originalLineItemId} not found`);
      }

      let newProductId = item.newProductId;
      if (!newProductId && item.newVariantId) {
         const product = await prisma.product.findFirst({
           where: { shopifyProductId: item.newVariantId.split('/').pop() }
         });
         newProductId = product?.id;
      }

      const origV = extractItemVariantAndSize(originalItem.title, originalItem.sku, originalItem.variantTitle, originalItem.size);
      const newV = extractItemVariantAndSize(item.newVariantTitle || item.newTitle, item.newSku, item.newVariantTitle);

      // Accept newSize and newVariantTitle from the request payload (e.g., from the admin dashboard)
      const resolvedNewSize = item.newSize || newV.size || null;
      const resolvedNewVariant = item.newVariantTitle || newV.variant || (resolvedNewSize ? `Size: ${resolvedNewSize}` : null);

      return {
        originalProductId: originalItem.productId,
        newProductId: newProductId,
        reason: item.reason || "Admin manual exchange",
        originalVariantTitle: originalItem.variantTitle || origV.variant,
        originalSize: originalItem.size || origV.size,
        newVariantTitle: resolvedNewVariant,
        newSize: resolvedNewSize,
      };
    }));

    const parentOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!parentOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const displayId = await allocateLinkedId(prisma as any, 'exchange', parentOrder);

    const exchangeRequest = await prisma.$transaction(async (tx: any) => {
      const er = await tx.exchangeRequest.create({
        data: {
          displayId,
          orderId,
          customerId,
          status: 'pending_approval',
          exchanges: {
            create: resolvedExchanges.map((ex: any) => ({
              originalProductId: ex.originalProductId!,
              newProductId: ex.newProductId!,
              orderId,
              status: 'REQUESTED',
              reason: ex.reason,
              originalVariantTitle: ex.originalVariantTitle,
              originalSize: ex.originalSize,
              newVariantTitle: ex.newVariantTitle,
              newSize: ex.newSize,
            }))
          }
        },
        include: {
          exchanges: true
        }
      });

      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'exchange_initiated' }
      });

      return er;
    });

    return NextResponse.json({ success: true, exchangeRequest });
  } catch (error: any) {
    console.error("Create Admin Exchange Error:", error);
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
