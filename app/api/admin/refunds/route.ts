import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/refunds
 * Returns all return & exchange refund requests requiring QC review and admin approval.
 * Enriched with customer info, order details, payment method, QC status, and stats.
 */
export async function GET(req: Request) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'view');

    const { searchParams } = new URL(req.url);
    const summaryOnly = searchParams.get('summaryOnly') === 'true' || searchParams.get('countOnly') === 'true';

    // Fast path: returns & other pages needing only the pending refund counter
    if (summaryOnly) {
      const [pendingRequests, pendingStandalone] = await Promise.all([
        prisma.returnRequest.count({
          where: { status: { in: ['received', 'refund_pending', 'approved'] } }
        }),
        prisma.return.count({
          where: {
            returnRequestId: null,
            status: { in: ['received', 'refund_pending', 'approved'] }
          }
        }),
      ]);
      return NextResponse.json({
        refunds: [],
        summary: {
          pendingCount: pendingRequests + pendingStandalone,
        }
      });
    }

    const statusFilter = searchParams.get('status') || 'all'; // all, pending, completed, rejected
    const methodFilter = searchParams.get('method') || 'all'; // all, original_method, store_credit
    const search = searchParams.get('search')?.trim().toLowerCase();

    // 1. Fetch ReturnRequests
    const returnRequests = await prisma.returnRequest.findMany({
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
    });

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

    // Combine and normalize into a unified Refund Queue List
    const allRefundItems: any[] = [];

    // Map ReturnRequests
    for (const reqItem of returnRequests) {
      const order = reqItem.order;
      const customer = order?.customer;
      const returns = reqItem.returns || [];

      const refundMethod = returns[0]?.refundMethod || 'original_method';
      const rawRefundStatus = (returns[0]?.refundStatus || reqItem.status || 'PENDING').toUpperCase();
      
      let isCompleted = rawRefundStatus === 'COMPLETED' || reqItem.status === 'refunded';
      let isRejected = rawRefundStatus === 'REJECTED' || reqItem.status === 'rejected';
      let isPending = !isCompleted && !isRejected;

      const totalAmount = reqItem.actualRefund || reqItem.estimatedRefund || returns.reduce((sum: number, r: any) => sum + (r.refundAmount || 0), 0);

      allRefundItems.push({
        id: reqItem.id,
        type: 'RETURN_REQUEST',
        returnRequestId: reqItem.id,
        orderId: order?.id,
        shopifyOrderId: order?.shopifyOrderId || order?.id,
        customerId: reqItem.customerId,
        customerName: customer?.name || 'Customer',
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        status: reqItem.status,
        refundStatus: isCompleted ? 'COMPLETED' : isRejected ? 'REJECTED' : 'PENDING',
        refundAmount: totalAmount,
        refundMethod: refundMethod === 'store_credit' ? 'store_credit' : 'original_method',
        paymentMethod: order?.paymentMethod || 'Razorpay',
        razorpayPaymentId: order?.razorpayPaymentId,
        qcStatus: reqItem.status === 'qc_passed' ? 'PASSED' : reqItem.status === 'received' ? 'AWAITING_QC' : reqItem.status === 'approved' ? 'AWAITING_ITEM' : 'PENDING',
        createdAt: reqItem.createdAt,
        updatedAt: reqItem.updatedAt,
        reason: reqItem.reason || returns[0]?.reason || 'Customer Return',
        items: returns.map((r: any) => ({
          id: r.id,
          title: r.product?.title || r.sku || 'Returned Product',
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
      const rawRefundStatus = (standalone.refundStatus || standalone.status || 'PENDING').toUpperCase();

      let isCompleted = rawRefundStatus === 'COMPLETED' || standalone.status === 'REFUNDED';
      let isRejected = rawRefundStatus === 'REJECTED' || standalone.status === 'REJECTED';

      allRefundItems.push({
        id: standalone.id,
        type: 'STANDALONE_RETURN',
        returnRequestId: standalone.id,
        orderId: standalone.orderId,
        shopifyOrderId: order?.shopifyOrderId || standalone.orderId,
        customerId: standalone.customerId,
        customerName: customer?.name || 'Customer',
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        status: standalone.status,
        refundStatus: isCompleted ? 'COMPLETED' : isRejected ? 'REJECTED' : 'PENDING',
        refundAmount: standalone.refundAmount || 0,
        refundMethod: standalone.refundMethod === 'store_credit' ? 'store_credit' : 'original_method',
        paymentMethod: order?.paymentMethod || 'Razorpay',
        razorpayPaymentId: order?.razorpayPaymentId,
        qcStatus: standalone.status === 'QC_PASSED' ? 'PASSED' : standalone.status === 'RECEIVED' ? 'AWAITING_QC' : 'PENDING',
        createdAt: standalone.requestedAt,
        updatedAt: standalone.updatedAt,
        reason: standalone.reason || 'Customer Return',
        items: [{
          id: standalone.id,
          title: standalone.product?.title || standalone.sku || 'Returned Item',
          sku: standalone.sku,
          quantity: standalone.quantity || 1,
          refundAmount: standalone.refundAmount || 0,
          reason: standalone.reason
        }]
      });
    }

    // Sort by createdAt descending
    allRefundItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Calculate aggregated statistics
    let pendingCount = 0;
    let completedCount = 0;
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
      } else if (item.refundStatus === 'COMPLETED') {
        completedCount++;
        totalCompletedAmount += item.refundAmount;
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
        completedCount,
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
