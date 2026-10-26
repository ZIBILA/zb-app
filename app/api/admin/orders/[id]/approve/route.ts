import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { syncOrderToShopify } from '@/lib/services/shopifyOrderSyncService';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Update status to approved locally first
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'approved',
      },
      include: {
        items: true,
        customer: true,
      },
    });

    // Delegate to the single Shopify sync choke point
    const syncRes = await syncOrderToShopify(id, { preserveAppTags: true });

    if (!syncRes.success) {
      console.error(`[Admin Order Approve] Failed to sync order ${id} to Shopify:`, syncRes.error);
      return NextResponse.json({
        success: false,
        error: syncRes.error || 'Failed to sync to Shopify',
      }, { status: 500 });
    }

    // Module 3: Automatic Order Approved Email Webhook Trigger (Non-blocking / Fire-and-forget)
    try {
      const localApiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.zicabella.com'}/api/orders/status-update`;
      const apiSecret = process.env.INTERNAL_API_SECRET;
      
      if (apiSecret && updatedOrder.customer && updatedOrder.customer.email) {
        const payload = {
          orderId: updatedOrder.id,
          newStatus: 'approved',
          customerEmail: updatedOrder.customer.email,
          customerName: updatedOrder.customer.name || 'Valued Customer',
          items: updatedOrder.items.map((i: any) => ({
            name: i.title,
            size: i.sku?.split('-')?.pop() || 'M',
            quantity: i.quantity,
            price: i.price,
            image: i.image || null,
          })),
          total: updatedOrder.totalPrice,
          currency: updatedOrder.currency || 'INR',
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
        .then(resData => console.log('[Admin Order Approve Status Trigger] Email status webhook success:', resData))
        .catch((err: any) => console.error('[Admin Order Approve Status Trigger] Email status webhook fetch error:', err));
      }
    } catch (emailErr) {
      console.error('[Admin Order Approve Status Trigger] Background email trigger failed:', emailErr);
    }

    return NextResponse.json({ 
      success: true, 
      shopifyOrderId: syncRes.shopifyOrderId,
      shopifyOrderName: syncRes.shopifyOrderName,
      message: 'Order successfully synced to Shopify and approved.'
    });

  } catch (error: any) {
    console.error('[Admin Order Approve API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
