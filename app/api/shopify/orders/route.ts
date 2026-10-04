import { NextResponse } from 'next/server';
import {
  adminUrl,
  headers,
  ShopifyOrder,
  fetchOrders,
} from '@/lib/shopify-admin';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await requirePermission('ORDERS', 'edit');

    const body = await request.json();
    
    // Construct the Shopify order payload
    const payload = {
      order: {
        line_items: body.line_items || [],
        customer: body.customer ? {
          first_name: body.customer.first_name,
          last_name: body.customer.last_name,
          email: body.customer.email,
        } : undefined,
        shipping_address: body.shipping_address,
        billing_address: body.billing_address || body.shipping_address,
        financial_status: body.financial_status || 'pending',
        tags: body.tags || '',
        note: body.note || '',
      }
    };

    const res = await fetch(await adminUrl('orders.json'), {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Shopify Create Order Error:', res.status);
      return NextResponse.json(
        { error: 'Failed to create order on Shopify' },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({ success: true, order: data.order as ShopifyOrder });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Error in create order route:', error?.message || error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await requirePermission('ORDERS', 'view');

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'any';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100);

    // Single-page fetch only — never pull the full Shopify order history on dashboard polls
    const orders = await fetchOrders(limit, status) || [];

    if (!Array.isArray(orders)) {
      return NextResponse.json({ orders: [] });
    }

    // Enrich with local delivery status
    const shopifyOrderIds = orders.map(o => String(o.id));

    let localOrders: any[] = [];
    try {
      localOrders = await prisma.order.findMany({
        where: { shopifyOrderId: { in: shopifyOrderIds } },
        select: { shopifyOrderId: true, deliveryStatus: true }
      });
    } catch (prismaErr: any) {
      console.error('[Orders API] Local enrichment failed:', prismaErr?.message || 'db error');
    }
    
    const deliveryMap = Object.fromEntries(localOrders.map(o => [o.shopifyOrderId, o.deliveryStatus]));
    const enrichedOrders = orders.map(o => ({
      ...o,
      deliveryStatus: deliveryMap[String(o.id)] || 'pending'
    }));
    
    return NextResponse.json({ orders: enrichedOrders });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    // Shopify network blips are common in local/dev — return empty list, not a stack dump
    console.warn('[Orders API] Shopify fetch failed:', error?.cause?.code || error?.message || 'error');
    return NextResponse.json({ orders: [], error: 'shopify_unavailable' }, { status: 200 });
  }
}
