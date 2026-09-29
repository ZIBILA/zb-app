import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createShipment } from '@/lib/delhivery/api';
import { DelhiveryOrder } from '@/lib/delhivery/types';
import { shipOrder } from '@/lib/services/logistics';

function hasDelhiveryToken(): boolean {
  const token = (process.env.DELHIVERY_API_KEY || process.env.DELHIVERY_API_TOKEN || '').trim();
  return token.length > 0;
}

export async function POST(req: Request) {
  try {
    const { orderId, weight, shipment_length, shipment_width, shipment_height, shipping_mode } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true }
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const shippingAddr = typeof order.shippingAddress === 'string'
      ? JSON.parse(order.shippingAddress)
      : order.shippingAddress || {};

    // No Delhivery credentials: mock only in non-prod (or explicit opt-in).
    // Production with a real DELHIVERY_API_KEY uses the Delhivery path below unchanged.
    if (!hasDelhiveryToken()) {
      const allowMock =
        process.env.NODE_ENV !== 'production' ||
        process.env.ALLOW_MOCK_LOGISTICS === '1' ||
        process.env.ALLOW_MOCK_LOGISTICS === 'true';
      if (!allowMock) {
        return NextResponse.json(
          { error: 'DELHIVERY_API_KEY is not configured. Refusing mock shipment in production.' },
          { status: 503 }
        );
      }

      const result = await shipOrder(
        order.id,
        order.items.map((i: any) => ({
          title: i.title,
          sku: i.sku,
          quantity: i.quantity,
          price: Number(i.price) || 0,
        })),
        {
          name: shippingAddr.name || order.customer?.name || 'Customer',
          address1: shippingAddr.address1 || '',
          city: shippingAddr.city || '',
          province: shippingAddr.province || shippingAddr.state || '',
          zip: String(shippingAddr.zip || shippingAddr.pincode || ''),
          country: shippingAddr.country || 'India',
          phone: shippingAddr.phone || order.customer?.phone || '',
        }
      );

      await prisma.order.update({
        where: { id: orderId },
        data: {
          delhivery_awb: result.trackingNumber,
          status: 'Shipped',
          deliveryStatus: 'confirmed',
        },
      });

      return NextResponse.json({
        awb: result.trackingNumber,
        status: 'confirmed',
        courier: result.courier,
        mock: true,
      });
    }

    const delhiveryOrder: DelhiveryOrder = {
      shopifyOrderId: (order.shopifyOrderId || order.internalOrderNumber || order.id).replace('#', ''),
      paymentMode: order.paymentMethod === 'COD' || (order.paymentMethod || '').toLowerCase() === 'cod' ? 'COD' : 'Prepaid',
      total: order.totalPrice,
      quantity: order.items.reduce((acc: any, item: any) => acc + item.quantity, 0),
      weight: weight ? Number(weight) : 500,
      shipment_length: shipment_length ? Number(shipment_length) : 30,
      shipment_width: shipment_width ? Number(shipment_width) : 20,
      shipment_height: shipment_height ? Number(shipment_height) : 5,
      shipping_mode: shipping_mode || 'Surface',
      sellerInvoice: (order.shopifyOrderId || order.internalOrderNumber || order.id).replace('#', ''),
      shippingAddress: {
        name: shippingAddr.name || order.customer?.name || 'Customer',
        add: `${shippingAddr.address1 || ''} ${shippingAddr.address2 || ''} ${shippingAddr.city || ''} ${shippingAddr.province || ''}`.trim() || 'No street address',
        pin: String(shippingAddr.zip || shippingAddr.pincode || ''),
        city: shippingAddr.city || '',
        state: shippingAddr.province || shippingAddr.state || '',
        phone: shippingAddr.phone || order.customer?.phone || '',
      },
      items: order.items.map((i: any) => ({
        title: i.title,
      })),
    };

    const result = await createShipment(delhiveryOrder);

    if (result.awb) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          delhivery_awb: result.awb,
          status: 'Shipped',
          deliveryStatus: 'shipped'
        }
      });

      await prisma.shipment.create({
        data: {
          orderId: order.id,
          awb: result.awb,
          trackingNumber: result.awb,
          courier: 'Delhivery',
          status: 'shipped',
          trackingUrl: `https://www.delhivery.com/track/package/${result.awb}`,
        }
      });

      return NextResponse.json({ awb: result.awb, status: result.status });
    } else {
      console.error('[Create Shipment API] Delhivery error returned:', result.error);
      return NextResponse.json({ error: result.error || 'Delhivery shipment creation failed' }, { status: 500 });
    }
  } catch (err: any) {
    console.error('[Create Shipment API] Critical exception:', err.message, err.stack);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
