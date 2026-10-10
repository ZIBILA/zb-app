import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const shopifyOrderId = params.id;

    if (!shopifyOrderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    const order = await prisma.order.findUnique({
      where: { shopifyOrderId },
    });

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found in local database. Please run Full Sync first.' },
        { status: 404 }
      );
    }

    const updated = await prisma.order.update({
      where: { shopifyOrderId },
      data: {
        deliveryStatus: 'delivered',
        deliveredAt: order.deliveredAt || new Date(),
      },
      include: {
        customer: true,
        items: true,
      }
    });

    try {
      const { releasePendingCouponCashback } = await import('@/lib/storeCreditsHelper');
      await releasePendingCouponCashback(updated.id);
    } catch (e) {
      console.error('Failed to release coupon cashback on deliver:', e);
    }

    try {
      const { NotificationService } = await import('@/lib/services/notification.service');
      await NotificationService.sendToUser(
        order.customerId,
        'Zica Bella Order Update',
        'Your order is now delivered',
        { orderId: order.id, status: 'delivered' }
      );
    } catch (e) {
      console.error('Failed to send push notification:', e);
    }

    // Module 3: Automatic Order Delivered Email Webhook Trigger (Non-blocking / Fire-and-forget)
    try {
      const localApiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.zicabella.com'}/api/orders/status-update`;
      const apiSecret = process.env.INTERNAL_API_SECRET || 'ZB_INTERNAL_SECRET_987654321';
      
      if (updated.customer && updated.customer.email) {
        const payload = {
          orderId: updated.id,
          newStatus: 'delivered',
          customerEmail: updated.customer.email,
          customerName: updated.customer.name || 'Valued Customer',
          items: updated.items.map((i: any) => ({
            name: i.title,
            size: i.sku?.split('-')?.pop() || 'M',
            quantity: i.quantity,
            price: i.price,
          })),
          total: updated.totalPrice,
          currency: updated.currency || 'INR',
        };

        fetch(localApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': apiSecret,
          },
          body: JSON.stringify(payload),
        })
        .then(res => res.json())
        .then(resData => console.log('[Admin Order Deliver Status Trigger] Email status webhook success:', resData))
        .catch((err: any) => console.error('[Admin Order Deliver Status Trigger] Email status webhook fetch error:', err));
      }
    } catch (emailErr) {
      console.error('[Admin Order Deliver Status Trigger] Background email trigger failed:', emailErr);
    }

    return NextResponse.json({ success: true, deliveryStatus: 'delivered' });
  } catch (error: any) {
    console.error('Error updating delivery status:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
