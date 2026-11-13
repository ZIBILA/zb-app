import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { checkOrderAddress } from '@/lib/services/addressQuality';

export const dynamic = 'force-dynamic';

async function loadOrder(id: string) {
  return prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      internalOrderNumber: true,
      shopifyOrderName: true,
      shippingAddress: true,
      paymentMethod: true,
      totalPrice: true,
      codUpfrontPaid: true,
      customer: { select: { name: true, phone: true, email: true } },
    },
  });
}

/** GET: address check for the order page (see lib/services/addressQuality.ts for what is and isn't Shiprocket data). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('ORDERS', 'view');
    const order = await loadOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    return NextResponse.json({ success: true, quality: await checkOrderAddress(order) });
  } catch (error) {
    return handleAuthError(error);
  }
}

/**
 * POST { name, phone, address1, address2, city, state, pincode }: correct the delivery address before the AWB
 * (saved on the order, Shopify and the Shiprocket draft; refused once an AWB exists), then check it again.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('ORDERS', 'edit');
    const order = await loadOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const orderNumber = order.internalOrderNumber || order.shopifyOrderName;
    if (!orderNumber) return NextResponse.json({ error: 'This order has no order number to update' }, { status: 400 });

    const { updateOrderAddressForAI } = await import('@/lib/services/aiSupportMutations');
    const raw = await updateOrderAddressForAI(
      {
        order_number: orderNumber,
        name: body.name,
        phone: body.phone,
        address1: body.address1,
        address2: body.address2,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
      },
      { kind: 'admin', adminId: 'dashboard', role: 'ADMIN' }
    );
    const result = JSON.parse(raw);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Could not update the address', needs: result.needs || null }, { status: 400 });
    }
    const updated = await loadOrder(params.id);
    return NextResponse.json({ success: true, update: result, quality: updated ? await checkOrderAddress(updated) : null });
  } catch (error) {
    return handleAuthError(error);
  }
}
