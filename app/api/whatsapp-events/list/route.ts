import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

const COMMERCE_EVENTS = [
  'Product Viewed', 'Category Viewed', 'Search Performed', 'Add To Wishlist', 'Add To Cart', 
  'Remove From Cart', 'Checkout Started', 'Payment Initiated', 'Payment Success', 'Payment Failed', 
  'Purchase Completed', 'COD Order Placed', 'Order Cancelled', 'Refund Requested', 'Refund Completed'
];

const CUSTOMER_EVENTS = [
  'Lead Created', 'User Registered', 'User Login', 'WhatsApp Chat Started', 
  'Customer Support Conversation Started', 'Customer Support Conversation Resolved'
];

const MARKETING_EVENTS = [
  'WhatsApp Campaign Sent', 'WhatsApp Campaign Delivered', 'WhatsApp Campaign Read', 
  'WhatsApp Campaign Clicked', 'Promotional Template Sent', 'Transactional Template Sent'
];

export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const eventType = searchParams.get('eventType') || 'all';
    const exportCsv = searchParams.get('exportCsv') || 'false';

    const skip = (page - 1) * limit;
    const where: any = {};

    // Apply category filters
    if (eventType === 'commerce') {
      where.eventName = { in: COMMERCE_EVENTS };
    } else if (eventType === 'customer') {
      where.eventName = { in: CUSTOMER_EVENTS };
    } else if (eventType === 'marketing') {
      where.eventName = { in: MARKETING_EVENTS };
    } else if (eventType !== 'all' && eventType !== '') {
      where.eventName = eventType;
    }

    // Apply search filter
    if (search) {
      where.OR = [
        { customerPhone: { contains: search } },
        { eventName: { contains: search, mode: 'insensitive' } },
        { orderId: { contains: search } },
        { productId: { contains: search } },
        { eventSource: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Handle CSV Export
    if (exportCsv === 'true') {
      const allEvents = await db.whatsAppEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });

      const csvRows = [
        ['ID', 'Event Name', 'Customer ID', 'Customer Phone', 'Order ID', 'Product ID', 'Event Source', 'Status', 'Created At']
      ];

      for (const e of allEvents) {
        csvRows.push([
          e.id,
          e.eventName,
          e.customerId || '',
          e.customerPhone || '',
          e.orderId || '',
          e.productId || '',
          e.eventSource,
          e.status,
          e.createdAt.toISOString()
        ]);
      }

      const csvContent = csvRows
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=zicabella_whatsapp_events.csv'
        }
      });
    }

    // Standard paginated JSON response
    const [events, total] = await Promise.all([
      db.whatsAppEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          logs: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        }
      }),
      db.whatsAppEvent.count({ where })
    ]);

    return NextResponse.json({
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('[List Events API Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
