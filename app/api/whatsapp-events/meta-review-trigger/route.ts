import { NextRequest, NextResponse } from 'next/server';
import { eventTracker } from '@/lib/services/eventTracker';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Admin only: this sends sample (non-real) events to Meta for App Review demos.
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  try {
    const { eventType, customerPhone = '919876543210', customerName = 'Meta Reviewer' } = await req.json();

    const sampleCustomerId = 'meta_reviewer_id_123';
    const sampleProductId = 'prod_graphics_tee_001';
    const sampleOrderId = 'ord_meta_review_777';

    let result;
    if (eventType === 'Product Viewed') {
      result = await eventTracker.track({
        eventName: 'Product Viewed',
        customerId: sampleCustomerId,
        customerPhone,
        productId: sampleProductId,
        eventSource: 'web',
        forwardWebEvent: true, // deliberate App Review demo → WhatsApp dataset only
        metadata: {
          title: 'Zica Graphic Tee V1',
          price: '1499.00',
          category: 'Apparel'
        }
      });
    } else if (eventType === 'Add To Cart') {
      result = await eventTracker.track({
        eventName: 'Add To Cart',
        customerId: sampleCustomerId,
        customerPhone,
        productId: sampleProductId,
        eventSource: 'web',
        forwardWebEvent: true, // deliberate App Review demo → WhatsApp dataset only
        metadata: {
          title: 'Zica Graphic Tee V1',
          price: '1499.00',
          size: 'L',
          quantity: 1
        }
      });
    } else if (eventType === 'Purchase Completed') {
      result = await eventTracker.track({
        eventName: 'Purchase Completed',
        customerId: sampleCustomerId,
        customerPhone,
        orderId: sampleOrderId,
        eventSource: 'web',
        forwardWebEvent: true, // deliberate App Review demo → WhatsApp dataset only
        metadata: {
          value: 1499.00,
          currency: 'INR',
          paymentMethod: 'RAZORPAY',
          num_items: 1,
          content_ids: [sampleProductId]
        }
      });
    } else if (eventType === 'Lead Created') {
      result = await eventTracker.track({
        eventName: 'Lead Created',
        customerId: sampleCustomerId,
        customerPhone,
        eventSource: 'web',
        forwardWebEvent: true, // deliberate App Review demo → WhatsApp dataset only
        metadata: {
          name: customerName,
          source: 'meta_app_review_demo'
        }
      });
    } else {
      return NextResponse.json({ error: 'Unsupported event type' }, { status: 400 });
    }

    return NextResponse.json({ ...result, success: true });
  } catch (error: any) {
    console.error('[Trigger Review Event Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
