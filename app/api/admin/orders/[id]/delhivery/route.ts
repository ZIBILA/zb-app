import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createDelhiveryShipment, cancelDelhiveryShipment, getShippingLabel, getExpectedTAT } from '@/lib/delhivery';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    let { id } = params;
    const body = await req.json();
    const { action } = body;

    // Check if it is a MobileOrder ID
    const mobileOrder = await prisma.mobileOrder.findUnique({
      where: { id }
    });
    if (mobileOrder && mobileOrder.shopifyOrderId) {
      const syncedOrder = await prisma.order.findUnique({
        where: { shopifyOrderId: mobileOrder.shopifyOrderId }
      });
      if (syncedOrder) {
        id = syncedOrder.id;
      }
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true }
    });

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    if (action === 'create_shipment') {
      const shippingAddr = typeof order.shippingAddress === 'string' 
        ? JSON.parse(order.shippingAddress) 
        : order.shippingAddress;

      const rawMethod = (order.paymentMethod || '').toLowerCase();
      const tagsLower = (order.tags || '').toLowerCase();
      const noteLower = (order.note || '').toLowerCase();
      const isCodOrder = rawMethod === 'cod' || tagsLower.includes('cod') || noteLower.includes('cod order') || noteLower.includes('upfront fee paid');

      let codUpfront = 0;
      if (isCodOrder) {
        const wsOrder = order.razorpayOrderId
          ? await prisma.webStoreOrder.findFirst({ where: { razorpayOrderId: order.razorpayOrderId } })
          : null;
        codUpfront = wsOrder?.codUpfrontPaid ? Number(wsOrder.codUpfrontPaid) : 99;
      }

      const codBalanceDue = isCodOrder ? Math.max(0, order.totalPrice - codUpfront) : 0;
      const paymentMode = (isCodOrder && codBalanceDue > 0) ? 'COD' : 'Prepaid';

      const shipmentPayload = {
        name: shippingAddr.name || order.customer.name || 'Customer',
        add: `${shippingAddr.address1} ${shippingAddr.address2 || ''} ${shippingAddr.city} ${shippingAddr.province}`,
        pin: shippingAddr.zip || shippingAddr.pincode,
        phone: shippingAddr.phone || order.customer.phone || '',
        order: order.shopifyOrderId.replace('#', ''),
        payment_mode: paymentMode as 'COD' | 'Prepaid',
        total_amount: String(Math.round(order.totalPrice)),
        cod_amount: paymentMode === 'COD' ? String(Math.round(codBalanceDue)) : '0.00',
        products_desc: order.items.map((i: any) => i.title).join(', '),
        weight: body.weight || '500', // Default weight if not provided
        shipment_length: body.shipment_length || '30',
        shipment_width: body.shipment_width || '20',
        shipment_height: body.shipment_height || '5',
        shipping_mode: (body.shippingMode || 'Surface') as 'Surface' | 'Express',
        seller_name: 'Zica Bella',
      };

      const result = await createDelhiveryShipment(shipmentPayload, body.pickupLocation || 'Main Warehouse');

      const isSuccess = result.success || result.status === 'success' || result.status === 'Successful' || (result.packages && result.packages.length > 0);

      if (isSuccess) {
        const waybill = result.packages?.[0]?.waybill || result.upload_wbn;
        if (!waybill) {
          return NextResponse.json({ success: false, error: 'Waybill not returned by Delhivery API', details: result });
        }
        // Update order with shipment info
        await prisma.shipment.create({
          data: {
            orderId: order.id,
            awb: String(waybill),
            courier: 'Delhivery',
            status: 'manifested',
            trackingUrl: `https://www.delhivery.com/track/package/${waybill}`,
            rawDelhiveryResponse: JSON.stringify(result)
          }
        });

        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryStatus: 'manifested' }
        });

        return NextResponse.json({ success: true, waybill: String(waybill) });
      } else {
        return NextResponse.json({ success: false, error: result.error || result.errors || result.message || 'Delhivery API error', details: result });
      }
    }

    if (action === 'generate_label') {
      const shipment = await prisma.shipment.findFirst({
        where: { orderId: order.id, courier: 'Delhivery' },
        orderBy: { createdAt: 'desc' }
      });

      if (!shipment || !shipment.awb) {
        return NextResponse.json({ success: false, error: 'No waybill found for this order. Manifest the order first.' });
      }

      const result = await getShippingLabel(shipment.awb);
      const labelUrl = result.packages_url || result.packages?.[0]?.pdf_download_link || result.packages?.[0]?.pdf_url || result.pdf_download_link || result.pdf_url;
      return NextResponse.json({ success: true, labelUrl, rawResult: result });
    }

    if (action === 'get_tat') {
      const shippingAddr = typeof order.shippingAddress === 'string' 
        ? JSON.parse(order.shippingAddress) 
        : order.shippingAddress;
      
      const shop = await prisma.shop.findFirst();
      const originPin = shop?.zipCode || '110001'; // Default origin if not set
      const destinationPin = shippingAddr.zip || shippingAddr.pincode;

      if (!destinationPin) {
        return NextResponse.json({ success: false, error: 'Destination pincode missing' });
      }

      const result = await getExpectedTAT(originPin, destinationPin, body.mot || 'S');
      return NextResponse.json({ success: true, tat: result });
    }

    if (action === 'cancel_shipment') {
      const shipment = await prisma.shipment.findFirst({
        where: { orderId: order.id, courier: 'Delhivery' },
        orderBy: { createdAt: 'desc' }
      });

      if (!shipment || !shipment.awb) {
        return NextResponse.json({ success: false, error: 'No Delhivery shipment found for this order' });
      }

      const result = await cancelDelhiveryShipment(shipment.awb);
      
      if (result.success || result.status === 'cancelled') {
        await prisma.shipment.update({
          where: { id: shipment.id },
          data: { status: 'cancelled' }
        });
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryStatus: 'cancelled' }
        });
        return NextResponse.json({ success: true });
      } else {
        return NextResponse.json({ success: false, error: result.errors || 'Cancellation failed' });
      }
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[Delhivery API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
