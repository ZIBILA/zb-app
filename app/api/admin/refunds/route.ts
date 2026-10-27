import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { calculateOrderRefundLimits } from '@/lib/services/refundAccuracy';
import { resolveRefundMethod } from '@/lib/returnPolicy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/refunds
 * Returns all return & exchange refund requests requiring QC review and admin approval.
 * Enriched with customer info, order details, payment method, QC status, discount adjustments, and stats.
 */
export async function GET(req: Request) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'view');

    const { searchParams } = new URL(req.url);
    const summaryOnly = searchParams.get('summaryOnly') === 'true' || searchParams.get('countOnly') === 'true';

    // Fast path: returns & other pages needing only the pending refund counter
    if (summaryOnly) {
      const [pendingRequests, pendingStandalone, pendingExchanges] = await Promise.all([
        prisma.returnRequest.count({
          where: {
            OR: [{ reason: null }, { NOT: { reason: { contains: 'EXCHANGE_RETURN' } } }],
            status: { in: ['qc_passed', 'refund_failed'] },
            refundReleasedAt: null,
          }
        }),
        prisma.return.count({
          where: {
            returnRequestId: null,
            status: 'QC_PASSED',
            refundStatus: { notIn: ['COMPLETED', 'REJECTED'] }
          }
        }),
        prisma.exchangeRequest.count({
          where: {
            priceDifference: { lt: 0 },
            paymentStatus: { in: ['refund_original_pending', 'refund_credit_pending', 'refund_pending', 'refund_failed'] },
            status: { notIn: ['cancelled', 'rejected'] }
          }
        }),
      ]);
      return NextResponse.json({
        refunds: [],
        summary: {
          pendingCount: pendingRequests + pendingStandalone + pendingExchanges,
        }
      });
    }

    const statusFilter = searchParams.get('status') || 'all'; // all, pending, processing, completed, failed, rejected
    const methodFilter = searchParams.get('method') || 'all'; // all, original_method, store_credit
    const search = searchParams.get('search')?.trim().toLowerCase();

    // 1. Fetch ReturnRequests
    const returnRequests = (await prisma.returnRequest.findMany({
      where: { OR: [{ reason: null }, { NOT: { reason: { contains: 'EXCHANGE_RETURN' } } }] },
      include: {
        returns: {
          include: {
            product: true
          }
        },
        order: {
          include: {
            customer: true,
            items: true,
            payments: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })) as any[];

    // 2. Fetch standalone Returns (if any not linked to ReturnRequest)
    const standaloneReturns = await prisma.return.findMany({
      where: { returnRequestId: null },
      include: {
        product: true,
        customer: true,
        order: {
          include: {
            customer: true,
            items: true,
            payments: true
          }
        }
      },
      orderBy: { requestedAt: 'desc' }
    });

    // 3. Fetch ExchangeRequests with negative price difference (refundable balance)
    const exchangeRequests = await prisma.exchangeRequest.findMany({
      where: {
        OR: [
          { priceDifference: { lt: 0 } },
          { paymentStatus: { in: ['refund_original_pending', 'refund_credit_pending', 'refund_pending', 'refund_failed'] } }
        ]
      },
      include: {
        exchanges: {
          include: {
            originalProduct: true,
            newProduct: true
          }
        },
        order: {
          include: {
            customer: true,
            items: true,
            payments: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Combine and normalize into a unified Refund Queue List
    const allRefundItems: any[] = [];

    // Map ReturnRequests
    for (const reqItem of returnRequests) {
      const order = reqItem.order;
      const customer = order?.customer;
      const returns = reqItem.returns || [];

      const initialMethod = returns[0]?.refundMethod || reqItem.refundType || 'original_method';
      const effectiveMethod = resolveRefundMethod(order, initialMethod);

      const rawStatus = String(reqItem.status || '').toLowerCase();
      const rawRefundStatus = String(returns[0]?.refundStatus || '').toUpperCase();

      let refundStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED' = 'PENDING';
      if (rawStatus === 'refunded' || rawRefundStatus === 'COMPLETED') {
        refundStatus = 'COMPLETED';
      } else if (rawStatus === 'rejected' || rawRefundStatus === 'REJECTED') {
        refundStatus = 'REJECTED';
      } else if (rawStatus === 'refund_failed' || rawRefundStatus === 'FAILED') {
        refundStatus = 'FAILED';
      } else if (rawStatus === 'refund_pending' || rawRefundStatus === 'PROCESSING') {
        refundStatus = 'PROCESSING';
      }

      // Determine QC Status
      let qcStatus: 'PASSED' | 'FAILED' | 'AWAITING_QC' | 'AWAITING_ITEM' | 'PENDING' = 'PENDING';
      if (['qc_passed', 'refund_pending', 'refund_failed', 'refunded'].includes(rawStatus)) {
        qcStatus = 'PASSED';
      } else if (rawStatus === 'qc_failed') {
        qcStatus = 'FAILED';
      } else if (rawStatus === 'received') {
        qcStatus = 'AWAITING_QC';
      } else if (['approved', 'pickup_scheduled', 'in_transit'].includes(rawStatus)) {
        qcStatus = 'AWAITING_ITEM';
      }

      // Calculate refund amount
      const orderLimits = order ? await calculateOrderRefundLimits(order.id).catch(() => null) : null;
      let calculatedAmount = reqItem.actualRefund || reqItem.estimatedRefund || returns.reduce((sum: number, r: any) => sum + (r.refundAmount || 0), 0);

      // Bound by remaining order refundable balance
      if (orderLimits && orderLimits.maxRemainingRefundable !== undefined && refundStatus === 'PENDING') {
        calculatedAmount = Math.min(calculatedAmount, orderLimits.maxRemainingRefundable);
      }

      allRefundItems.push({
        id: reqItem.id,
        type: 'RETURN_REQUEST',
        returnRequestId: reqItem.id,
        orderId: order?.id,
        orderNumber: order?.internalOrderNumber || order?.shopifyOrderName || order?.shopifyOrderId || order?.id,
        shopifyOrderId: order?.shopifyOrderId || order?.id,
        customerId: reqItem.customerId,
        customerName: customer?.name || 'Customer',
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        status: reqItem.status,
        refundStatus,
        refundAmount: calculatedAmount,
        originalAmount: reqItem.estimatedRefund || calculatedAmount,
        refundMethod: effectiveMethod,
        paymentMethod: order?.paymentMethod || 'Razorpay',
        razorpayPaymentId: order?.razorpayPaymentId,
        qcStatus,
        createdAt: reqItem.createdAt,
        updatedAt: reqItem.updatedAt,
        reason: reqItem.reason || returns[0]?.reason || 'Customer Return',
        refundError: order?.refundError || null,
        orderTotal: order?.totalPrice || 0,
        orderDiscount: orderLimits?.orderDiscountAmount || 0,
        maxRemainingRefundable: orderLimits?.maxRemainingRefundable ?? null,
        items: returns.map((r: any) => ({
          id: r.id,
          title: r.product?.title || r.title || r.sku || 'Returned Product',
          sku: r.sku,
          quantity: r.quantity || 1,
          refundAmount: r.refundAmount || 0,
          reason: r.reason
        }))
      });
    }

    // Map Standalone Returns
    for (const standalone of standaloneReturns) {
      const order = standalone.order;
      const customer = standalone.customer || order?.customer;
      const initialMethod = standalone.refundMethod || 'original_method';
      const effectiveMethod = resolveRefundMethod(order, initialMethod);

      const rawStatus = String(standalone.status || '').toUpperCase();
      const rawRefundStatus = String(standalone.refundStatus || '').toUpperCase();

      let refundStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED' = 'PENDING';
      if (rawStatus === 'REFUNDED' || rawRefundStatus === 'COMPLETED') {
        refundStatus = 'COMPLETED';
      } else if (rawStatus === 'REJECTED' || rawRefundStatus === 'REJECTED') {
        refundStatus = 'REJECTED';
      } else if (rawStatus === 'FAILED' || rawRefundStatus === 'FAILED') {
        refundStatus = 'FAILED';
      } else if (rawRefundStatus === 'PROCESSING') {
        refundStatus = 'PROCESSING';
      }

      let qcStatus: 'PASSED' | 'FAILED' | 'AWAITING_QC' | 'AWAITING_ITEM' | 'PENDING' = 'PENDING';
      if (rawStatus === 'QC_PASSED' || rawStatus === 'REFUNDED') {
        qcStatus = 'PASSED';
      } else if (rawStatus === 'QC_FAILED') {
        qcStatus = 'FAILED';
      } else if (rawStatus === 'RECEIVED') {
        qcStatus = 'AWAITING_QC';
      } else {
        qcStatus = 'AWAITING_ITEM';
      }

      const orderLimits = order ? await calculateOrderRefundLimits(order.id).catch(() => null) : null;
      let calculatedAmount = standalone.refundAmount || 0;
      if (orderLimits && orderLimits.maxRemainingRefundable !== undefined && refundStatus === 'PENDING') {
        calculatedAmount = Math.min(calculatedAmount, orderLimits.maxRemainingRefundable);
      }

      allRefundItems.push({
        id: standalone.id,
        type: 'STANDALONE_RETURN',
        returnRequestId: standalone.id,
        orderId: standalone.orderId,
        orderNumber: order?.internalOrderNumber || order?.shopifyOrderName || order?.shopifyOrderId || standalone.orderId,
        shopifyOrderId: order?.shopifyOrderId || standalone.orderId,
        customerId: standalone.customerId,
        customerName: customer?.name || 'Customer',
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        status: standalone.status,
        refundStatus,
        refundAmount: calculatedAmount,
        originalAmount: standalone.refundAmount || calculatedAmount,
        refundMethod: effectiveMethod,
        paymentMethod: order?.paymentMethod || 'Razorpay',
        razorpayPaymentId: order?.razorpayPaymentId,
        qcStatus,
        createdAt: standalone.requestedAt,
        updatedAt: standalone.updatedAt,
        reason: standalone.reason || 'Customer Return',
        refundError: order?.refundError || null,
        orderTotal: order?.totalPrice || 0,
        orderDiscount: orderLimits?.orderDiscountAmount || 0,
        maxRemainingRefundable: orderLimits?.maxRemainingRefundable ?? null,
        items: [{
          id: standalone.id,
          title: standalone.product?.title || standalone.title || standalone.sku || 'Returned Item',
          sku: standalone.sku,
          quantity: standalone.quantity || 1,
          refundAmount: standalone.refundAmount || 0,
          reason: standalone.reason
        }]
      });
    }

    // Map ExchangeRequests (Exchange Price Difference Refunds)
    for (const exReq of exchangeRequests) {
      const order = exReq.order;
      const customer = order?.customer;
      const exchanges = exReq.exchanges || [];

      const initialMethod =
        exReq.settlementPreference === 'REFUND_STORE_CREDIT' ? 'store_credit' : 'original_method';
      const effectiveMethod = resolveRefundMethod(order, initialMethod);

      const rawPaymentStatus = String(exReq.paymentStatus || '').toLowerCase();
      const rawRequestStatus = String(exReq.status || '').toLowerCase();

      let refundStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED' = 'PENDING';
      if (['refunded', 'refunded_original'].includes(rawPaymentStatus)) {
        refundStatus = 'COMPLETED';
      } else if (rawPaymentStatus === 'rejected' || rawRequestStatus === 'rejected') {
        refundStatus = 'REJECTED';
      } else if (rawPaymentStatus === 'refund_failed') {
        refundStatus = 'FAILED';
      } else if (rawPaymentStatus === 'refund_pending') {
        refundStatus = 'PROCESSING';
      }

      // QC Status for Exchange
      let qcStatus: 'PASSED' | 'FAILED' | 'AWAITING_QC' | 'AWAITING_ITEM' | 'PENDING' = 'PENDING';
      const hasQcFail = exchanges.some((e: any) => String(e.qcStatus || '').toLowerCase() === 'failed');
      if (hasQcFail) {
        qcStatus = 'FAILED';
      } else if (exchanges.length > 0 && exchanges.every((e: any) => String(e.qcStatus || '').toLowerCase() === 'passed')) {
        qcStatus = 'PASSED';
      } else if (rawRequestStatus === 'received' || !!exReq.receivedAt) {
        qcStatus = 'AWAITING_QC';
      } else if (['approved', 'return_created', 'in_transit'].includes(rawRequestStatus)) {
        qcStatus = 'AWAITING_ITEM';
      }

      const orderLimits = order ? await calculateOrderRefundLimits(order.id).catch(() => null) : null;
      let calculatedAmount = Math.abs(exReq.priceDifference || 0);

      if (orderLimits && orderLimits.maxRemainingRefundable !== undefined && refundStatus === 'PENDING') {
        calculatedAmount = Math.min(calculatedAmount, orderLimits.maxRemainingRefundable);
      }

      allRefundItems.push({
        id: exReq.id,
        type: 'EXCHANGE_REQUEST',
        returnRequestId: exReq.id,
        orderId: order?.id,
        orderNumber: exReq.displayId || order?.internalOrderNumber || order?.shopifyOrderName || order?.shopifyOrderId || order?.id,
        shopifyOrderId: order?.shopifyOrderId || order?.id,
        customerId: exReq.customerId,
        customerName: customer?.name || 'Customer',
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        status: exReq.status,
        refundStatus,
        refundAmount: calculatedAmount,
        originalAmount: Math.abs(exReq.priceDifference || 0),
        refundMethod: effectiveMethod,
        paymentMethod: order?.paymentMethod || 'Razorpay',
        razorpayPaymentId: order?.razorpayPaymentId,
        qcStatus,
        createdAt: exReq.createdAt,
        updatedAt: exReq.updatedAt,
        reason: exReq.reason || 'Exchange for lower-priced item (refundable balance)',
        refundError: order?.refundError || null,
        orderTotal: order?.totalPrice || 0,
        orderDiscount: orderLimits?.orderDiscountAmount || 0,
        maxRemainingRefundable: orderLimits?.maxRemainingRefundable ?? null,
        items: exchanges.map((e: any) => ({
          id: e.id,
          title: `Exchange: ${e.originalProduct?.title || 'Original Item'} ➔ ${e.newProduct?.title || 'Replacement'}`,
          sku: e.originalProduct?.sku || e.newProduct?.sku,
          quantity: 1,
          refundAmount: Math.abs(e.priceDifference || 0),
          reason: e.reason || 'Price difference'
        }))
      });
    }

    // Sort by createdAt descending
    allRefundItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Calculate aggregated statistics
    let pendingCount = 0;
    let processingCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let rejectedCount = 0;
    let totalPendingAmount = 0;
    let totalCompletedAmount = 0;
    let razorpayPendingCount = 0;
    let storeCreditPendingCount = 0;

    for (const item of allRefundItems) {
      if (item.refundStatus === 'PENDING') {
        pendingCount++;
        totalPendingAmount += item.refundAmount;
        if (item.refundMethod === 'store_credit') {
          storeCreditPendingCount++;
        } else {
          razorpayPendingCount++;
        }
      } else if (item.refundStatus === 'PROCESSING') {
        processingCount++;
        totalPendingAmount += item.refundAmount;
      } else if (item.refundStatus === 'COMPLETED') {
        completedCount++;
        totalCompletedAmount += item.refundAmount;
      } else if (item.refundStatus === 'FAILED') {
        failedCount++;
      } else if (item.refundStatus === 'REJECTED') {
        rejectedCount++;
      }
    }

    // Apply Filters
    let filteredItems = allRefundItems;

    if (statusFilter !== 'all') {
      filteredItems = filteredItems.filter(i => i.refundStatus.toLowerCase() === statusFilter.toLowerCase());
    }

    if (methodFilter !== 'all') {
      filteredItems = filteredItems.filter(i => i.refundMethod.toLowerCase() === methodFilter.toLowerCase());
    }

    if (search) {
      filteredItems = filteredItems.filter(i =>
        (i.shopifyOrderId && i.shopifyOrderId.toLowerCase().includes(search)) ||
        (i.orderNumber && i.orderNumber.toLowerCase().includes(search)) ||
        (i.orderId && i.orderId.toLowerCase().includes(search)) ||
        (i.customerName && i.customerName.toLowerCase().includes(search)) ||
        (i.customerEmail && i.customerEmail.toLowerCase().includes(search)) ||
        (i.customerPhone && i.customerPhone.includes(search))
      );
    }

    return NextResponse.json({
      refunds: filteredItems,
      summary: {
        totalRequests: allRefundItems.length,
        pendingCount,
        processingCount,
        completedCount,
        failedCount,
        rejectedCount,
        totalPendingAmount,
        totalCompletedAmount,
        razorpayPendingCount,
        storeCreditPendingCount
      }
    });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('GET /api/admin/refunds Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to fetch refunds' }, { status: 500 });
  }
}
