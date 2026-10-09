import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/options';
import { getAppAuthFromRequest } from '@/lib/appAuth';
import { getOrderTracking } from '@/lib/services/orderTracking';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'max-age=60',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id: orderId } = params;
    const url = new URL(req.url);
    const qPhone = url.searchParams.get('phone');
    const qEmail = url.searchParams.get('email');

    // 1. Next-Auth Session (Web clients)
    const session = await getServerSession(authOptions);
    const sessionUserId = session?.user ? (session.user as any).id : null;
    const sessionEmail = session?.user?.email;

    // 2. Bearer Token JWT (React Native app clients)
    const auth = getAppAuthFromRequest(req);
    const authCustomerId = auth?.customerId;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404, headers: corsHeaders });
    }

    // 3. Authorization Check
    let isAuthorized = false;
    if (sessionUserId && order.customerId === sessionUserId) {
      isAuthorized = true;
    } else if (sessionEmail && order.customer?.email === sessionEmail) {
      isAuthorized = true;
    } else if (authCustomerId && order.customerId === authCustomerId) {
      isAuthorized = true;
    } else if (order.customer) {
      // Check query parameters for guest tracking
      // A customerId in the query string is NOT a credential. Guests prove the buyer's email / phone.
      if (qEmail && order.customer.email && order.customer.email.toLowerCase() === qEmail.trim().toLowerCase()) isAuthorized = true;
      if (qPhone) {
        const orderPhone = order.customer.phone?.replace(/\D/g, '').slice(-10);
        const inputPhone = qPhone.replace(/\D/g, '').slice(-10);
        if (orderPhone && inputPhone.length === 10 && orderPhone === inputPhone) isAuthorized = true;
      }
    }

    if (!isAuthorized && !auth) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in again.' }, { status: 401, headers: corsHeaders });
    }
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized access to order' }, { status: 403, headers: corsHeaders });
    }

    // Provider-aware: AWB may be on Shipment.awb (Shiprocket), Shipment.trackingNumber
    // (Delhivery) or the legacy Order.delhivery_awb.
    const tracking = await getOrderTracking({
      id: order.id,
      delhivery_awb: order.delhivery_awb,
      tracking_status: order.tracking_status,
      createdAt: order.createdAt,
    });

    return NextResponse.json(tracking, { headers: corsHeaders });
  } catch (err: any) {
    console.error('[App Order Tracking API] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500, headers: corsHeaders });
  }
}
