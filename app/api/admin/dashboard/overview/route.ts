import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth/rbac';
import { fetchCatalogForAdmin } from '@/lib/shopify-admin';
import { isStorefrontEligible } from '@/lib/storefrontCatalog';

export const dynamic = 'force-dynamic';

// Canonical status sets for accurate financial reporting
const REALIZED_PAYMENT_STATUSES = [
  'paid',
  'PAID',
  'success',
  'SUCCESS',
  'cod_upfront_paid',
  'partially_paid',
] as const;

const EXCLUDED_ORDER_STATUSES = [
  'cancelled',
  'CANCELLED',
  'payment_failed',
  'failed',
  'FAILED',
  'draft',
  'abandoned',
  'pending',
  'payment_pending',
] as const;

// Normalize status badge and label
function normalizeStatus(status: string | null | undefined, receivedAt: Date | string | null | undefined) {
  const s = String(status || '').toLowerCase().trim();
  if (receivedAt || s === 'received') return { key: 'received', label: 'Received (QC Pending)' };
  if (s === 'pending_approval' || s === 'requested') return { key: 'pending_approval', label: 'Pending Approval' };
  if (s === 'approved') return { key: 'approved', label: 'Approved' };
  if (s === 'pickup_scheduled') return { key: 'pickup_scheduled', label: 'Pickup Scheduled' };
  if (s === 'in_transit') return { key: 'in_transit', label: 'In Transit' };
  if (s === 'new_order_created') return { key: 'new_order_created', label: 'Exchange Dispatched' };
  if (s === 'refunded') return { key: 'refunded', label: 'Refunded' };
  if (s === 'completed') return { key: 'completed', label: 'Completed' };
  if (s === 'rejected') return { key: 'rejected', label: 'Rejected' };
  return { key: s || 'pending', label: status || 'Pending' };
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get('platform')?.toLowerCase() || 'all'; // 'all' | 'web' | 'app'
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    // ─── 1. Build Date Filter ───
    let dateFilter: { gte?: Date; lte?: Date } | undefined;
    if (fromParam || toParam) {
      dateFilter = {};
      if (fromParam) dateFilter.gte = new Date(fromParam);
      if (toParam) {
        const toDate = new Date(toParam);
        // If date only (no time), include the full end of the day
        if (toParam.length === 10) {
          toDate.setHours(23, 59, 59, 999);
        }
        dateFilter.lte = toDate;
      }
    }

    // ─── 2. Build Platform Order Filter ───
    let platformOrderTypeFilter: Record<string, unknown> = {};
    if (platform === 'web') {
      platformOrderTypeFilter = { orderType: { in: ['WEB_STORE', 'REGULAR', 'EXCHANGE'] } };
    } else if (platform === 'app') {
      platformOrderTypeFilter = { orderType: { in: ['MOBILE', 'MOBILE_APP', 'APP'] } };
    }

    // ─── 3. Accurate Order Base WHERE Clause ───
    // Exclude failed, unpaid, and payment-pending orders.
    // Include only successfully paid orders and COD orders where upfront payment has been received.
    const orderWhere: any = {
      paymentStatus: { in: [...REALIZED_PAYMENT_STATUSES] },
      status: { notIn: [...EXCLUDED_ORDER_STATUSES] },
      ...platformOrderTypeFilter,
      NOT: [
        { internalOrderNumber: { startsWith: 'ZBPF' } },
        {
          AND: [
            { internalOrderNumber: { startsWith: 'ZBPP' } },
            { paymentStatus: { in: ['pending', 'payment_pending', 'failed', 'payment_failed'] } },
          ],
        },
      ],
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    // ─── Return & Exchange WHERE Clauses (Live Channel Backlog) ───
    // Operational queues (pending returns, pending exchanges, pending refunds) reflect
    // the current unfinished backlog for that channel. They are not cut off by historical date ranges.
    const channelReturnWhere: any = {
      ...(platform !== 'all' ? { order: platformOrderTypeFilter } : {}),
    };

    const channelExchangeWhere: any = {
      ...(platform !== 'all' ? { order: platformOrderTypeFilter } : {}),
    };

    // Date-filtered where specifically for recent historical activity events
    const returnActivityWhere: any = {
      ...channelReturnWhere,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    const exchangeActivityWhere: any = {
      ...channelExchangeWhere,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    // ─── 4. Parallel DB Aggregations ───
    const [
      revenueAndOrderAgg,
      recentOrdersRaw,
      totalReturnsCount,
      pendingReturnsCount,
      receivedReturnsCount,
      totalExchangesCount,
      pendingExchangesCount,
      pendingRefundsRaw,
      allReturnRequests,
      allExchangeRequests,
      totalCustomersCount,
    ] = await Promise.all([
      // A. Realized Revenue & Orders (Channel & Date Filtered)
      prisma.order.aggregate({
        where: orderWhere,
        _sum: { totalPrice: true },
        _count: true,
      }),

      // B. Recent Orders matching filter
      prisma.order.findMany({
        where: orderWhere,
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: { name: true, email: true, phone: true },
          },
        },
      }),

      // C. Returns Counts (Live Backlog filtered by order channel)
      prisma.returnRequest.count({ where: channelReturnWhere }),
      prisma.returnRequest.count({
        where: {
          ...channelReturnWhere,
          status: { notIn: ['refunded', 'rejected', 'cancelled', 'completed'] },
        },
      }),
      prisma.returnRequest.count({
        where: {
          ...channelReturnWhere,
          OR: [{ receivedAt: { not: null } }, { status: 'received' }],
          status: { notIn: ['refunded', 'rejected', 'cancelled'] },
        },
      }),

      // D. Exchanges Counts (Live Backlog filtered by order channel)
      prisma.exchangeRequest.count({ where: channelExchangeWhere }),
      prisma.exchangeRequest.count({
        where: {
          ...channelExchangeWhere,
          status: { notIn: ['completed', 'rejected', 'cancelled'] },
        },
      }),

      // E. Pending Refunds (Live Backlog filtered by order channel)
      prisma.returnRequest.findMany({
        where: {
          ...channelReturnWhere,
          status: { in: ['received', 'refund_pending', 'approved'] },
        },
        select: {
          id: true,
          displayId: true,
          actualRefund: true,
          estimatedRefund: true,
          status: true,
        },
      }),

      // F. Return Requests for Service Activity (Channel aware, date range aware)
      prisma.returnRequest.findMany({
        where: returnActivityWhere,
        take: 12,
        orderBy: { createdAt: 'desc' },
        include: {
          returns: {
            include: { product: true },
          },
          order: {
            include: { customer: true },
          },
        },
      }),

      // G. Exchange Requests for Service Activity (Channel aware, date range aware)
      prisma.exchangeRequest.findMany({
        where: exchangeActivityWhere,
        take: 12,
        orderBy: { createdAt: 'desc' },
        include: {
          exchanges: {
            include: { originalProduct: true, newProduct: true },
          },
          order: {
            include: { customer: true },
          },
        },
      }),

      // H. Customers Count (Platform & Date sensitive)
      (async () => {
        try {
          if (platform === 'web') {
            return await prisma.customer.count({
              where: {
                orders: {
                  some: {
                    orderType: { in: ['WEB_STORE', 'REGULAR', 'EXCHANGE'] },
                    ...(dateFilter ? { createdAt: dateFilter } : {}),
                  },
                },
              },
            });
          } else if (platform === 'app') {
            return await prisma.customer.count({
              where: {
                OR: [
                  {
                    orders: {
                      some: {
                        orderType: { in: ['MOBILE', 'MOBILE_APP', 'APP'] },
                        ...(dateFilter ? { createdAt: dateFilter } : {}),
                      },
                    },
                  },
                  {
                    mobileOrders: {
                      some: dateFilter ? { createdAt: dateFilter } : {},
                    },
                  },
                ],
              },
            });
          }
          return await prisma.customer.count({
            where: dateFilter ? { createdAt: dateFilter } : {},
          });
        } catch {
          return 0;
        }
      })(),
    ]);

    // ─── 5. Low Stock Catalog Products (100% GLOBAL Physical Warehouse Live Snapshot) ───
    // Inventory is a physical unified asset on warehouse shelves. Low-stock alerts
    // must not be hidden or restricted by channel/date filters.
    let lowStockProducts: Array<{
      title: string;
      sku: string | null;
      stock: number;
      variant: string;
      channel: string;
    }> = [];

    try {
      const catalog = await fetchCatalogForAdmin().catch(() => []);

      for (const p of catalog) {
        for (const v of p.variants || []) {
          if (v.inventory_quantity !== null && v.inventory_quantity < 10) {
            lowStockProducts.push({
              title: p.title,
              sku: v.sku || null,
              stock: v.inventory_quantity,
              variant: v.title !== 'Default Title' ? v.title : '',
              channel: 'Global Warehouse',
            });
          }
        }
      }
      lowStockProducts.sort((a, b) => a.stock - b.stock);
    } catch (catErr) {
      console.error('[Dashboard Overview] Low stock fetch error:', catErr);
    }

    // ─── 6. Format Recent Orders ───
    const recentOrders = recentOrdersRaw.map((o: any) => {
      const customerName = o.customer?.name || 'Customer';
      return {
        id: o.id,
        name: o.shopifyOrderName || o.internalOrderNumber || `#${o.id.slice(-6).toUpperCase()}`,
        total_price: String(o.totalPrice),
        financial_status: o.paymentStatus,
        fulfillment_status: o.fulfillmentStatus,
        customer: {
          first_name: customerName.split(' ')[0] || '',
          last_name: customerName.split(' ').slice(1).join(' ') || '',
        },
        created_at: o.createdAt.toISOString(),
        orderType: o.orderType,
      };
    });

    // ─── 7. Build Combined Service Activity & Received Items ───
    const serviceActivity: any[] = [];
    const receivedItemsAwaitingInspection: any[] = [];

    for (const r of allReturnRequests) {
      const orderNum =
        r.order?.shopifyOrderName ||
        r.order?.internalOrderNumber ||
        (r.order?.shopifyOrderId ? `#${r.order.shopifyOrderId.replace('#', '')}` : null) ||
        r.displayId ||
        'Order';

      const productTitle = r.returns?.[0]?.product?.title || r.returns?.[0]?.title || 'Return Item';
      const customerName = r.order?.customer?.name || 'Customer';
      const norm = normalizeStatus(r.status, r.receivedAt);
      const isReceived = !!r.receivedAt || String(r.status).toLowerCase() === 'received';

      const itemData = {
        id: r.id,
        displayId: r.displayId || `R_${r.id.slice(-6).toUpperCase()}`,
        type: 'return',
        status: norm.key,
        statusLabel: norm.label,
        isReceived,
        receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
        productTitle,
        customerName,
        date: (r.createdAt || new Date()).toISOString(),
        orderId: orderNum,
        refundAmount: r.actualRefund || r.estimatedRefund || 0,
        inspectUrl: `/dashboard/returns/${r.id}`,
      };

      serviceActivity.push(itemData);

      if (isReceived && r.status !== 'refunded' && r.status !== 'rejected') {
        receivedItemsAwaitingInspection.push(itemData);
      }
    }

    for (const e of allExchangeRequests) {
      const orderNum =
        e.order?.shopifyOrderName ||
        e.order?.internalOrderNumber ||
        (e.order?.shopifyOrderId ? `#${e.order.shopifyOrderId.replace('#', '')}` : null) ||
        e.displayId ||
        'Order';

      const originalTitle = e.exchanges?.[0]?.originalProduct?.title || 'Original Item';
      const newTitle = e.exchanges?.[0]?.newProduct?.title || 'New Item';
      const customerName = e.order?.customer?.name || 'Customer';
      const norm = normalizeStatus(e.status, e.receivedAt);
      const isReceived = !!e.receivedAt || String(e.status).toLowerCase() === 'received';

      const itemData = {
        id: e.id,
        displayId: e.displayId || `E_${e.id.slice(-6).toUpperCase()}`,
        type: 'exchange',
        status: norm.key,
        statusLabel: norm.label,
        isReceived,
        receivedAt: e.receivedAt ? e.receivedAt.toISOString() : null,
        productTitle: `${originalTitle} → ${newTitle}`,
        customerName,
        date: (e.createdAt || new Date()).toISOString(),
        orderId: orderNum,
        refundAmount: 0,
        inspectUrl: `/dashboard/exchanges`,
      };

      serviceActivity.push(itemData);

      if (isReceived && e.status !== 'completed' && e.status !== 'rejected') {
        receivedItemsAwaitingInspection.push(itemData);
      }
    }

    // Sort service activity newest first
    serviceActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    receivedItemsAwaitingInspection.sort(
      (a, b) =>
        new Date(b.receivedAt || b.date).getTime() - new Date(a.receivedAt || a.date).getTime()
    );

    // Calculate total pending refund amount
    const totalPendingRefundAmount = pendingRefundsRaw.reduce(
      (sum: number, r: any) => sum + (r.actualRefund || r.estimatedRefund || 0),
      0
    );

    const totalRevenue = revenueAndOrderAgg._sum.totalPrice || 0;
    const totalOrders = revenueAndOrderAgg._count || 0;

    return NextResponse.json({
      success: true,
      platform,
      dateRange: {
        from: fromParam || null,
        to: toParam || null,
      },
      stats: {
        totalRevenue,
        totalOrders,
        totalCustomers: totalCustomersCount,
        lowStockItems: lowStockProducts.length,
        recentOrders,
        lowStockProducts: lowStockProducts.slice(0, 6),
      },
      serviceSummary: {
        pendingReturns: pendingReturnsCount,
        totalReturns: totalReturnsCount,
        receivedReturns: receivedReturnsCount,
        pendingExchanges: pendingExchangesCount,
        totalExchanges: totalExchangesCount,
        pendingRefunds: pendingRefundsRaw.length,
        totalPendingRefundAmount,
        recentActivity: serviceActivity.slice(0, 8),
        receivedAwaitingInspection: receivedItemsAwaitingInspection,
      },
    });
  } catch (error: any) {
    console.error('[Dashboard Overview API Error]:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch dashboard overview' },
      { status: 500 }
    );
  }
}
