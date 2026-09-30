import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createShipment } from '@/lib/delhivery/api';
import { DelhiveryOrder } from '@/lib/delhivery/types';

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

    const delhiveryOrder: DelhiveryOrder = {
      shopifyOrderId: order.shopifyOrderId.replace('#', ''),
      paymentMode: order.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
      total: order.totalPrice,
      quantity: order.items.reduce((acc: any, item: any) => acc + item.quantity, 0),
      weight: weight ? Number(weight) : 500,
      shipment_length: shipment_length ? Number(shipment_length) : 30,
      shipment_width: shipment_width ? Number(shipment_width) : 20,
      shipment_height: shipment_height ? Number(shipment_height) : 5,
      shipping_mode: shipping_mode || 'Surface',
      sellerInvoice: order.shopifyOrderId.replace('#', ''),
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

      // Also create a shipment in the Shipment table for tracking continuity
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
