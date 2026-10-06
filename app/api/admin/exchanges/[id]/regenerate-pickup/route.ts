import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { createReversePickup } from "@/lib/delhivery";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    const exchangeRequest = await prisma.exchangeRequest.findUnique({
      where: { id },
      include: {
        exchanges: { include: { originalProduct: true } },
        order: { include: { customer: true } }
      }
    });

    if (!exchangeRequest) {
      return NextResponse.json({ error: "Exchange request not found" }, { status: 404 });
    }

    if (!["approved_pickup_failed", "approved", "pending_approval"].includes(exchangeRequest.status)) {
      return NextResponse.json({ error: `Cannot regenerate pickup for exchange in status: ${exchangeRequest.status}` }, { status: 400 });
    }

    let addrObj: any = {};
    const shippingRaw = exchangeRequest.order.shippingAddress;
    if (typeof shippingRaw === 'string') {
      try { addrObj = JSON.parse(shippingRaw); } catch (_) { addrObj = { add: shippingRaw }; }
    } else if (shippingRaw && typeof shippingRaw === 'object') {
      addrObj = shippingRaw;
    }

    const customer = exchangeRequest.order.customer;
    const name = addrObj.name || (addrObj.first_name ? `${addrObj.first_name} ${addrObj.last_name || ''}`.trim() : customer?.name || 'Customer');
    const add = addrObj.add || addrObj.address1 || addrObj.street || addrObj.fullAddress || (typeof shippingRaw === 'string' ? shippingRaw : 'Address Not Specified');
    const pin = addrObj.pin || addrObj.zip || addrObj.pincode || addrObj.postalCode || '110001';
    const phone = addrObj.phone || customer?.phone || '9876543210';
    const prodDesc = exchangeRequest.exchanges.map((ex: any) => ex.originalProduct?.sku || 'Item').join(', ');

    const pickupRes = await createReversePickup({
      name,
      add,
      pin: String(pin),
      phone: String(phone),
      order: exchangeRequest.id,
      products_desc: `Exchange Return: ${prodDesc}`,
      weight: '500',
      seller_name: 'Zica Bella',
      pickup_location_name: process.env.DELHIVERY_PICKUP_LOCATION || 'Zica Bella Warehouse',
    });

    const reverseAwb = pickupRes.awb;

    await prisma.$transaction([
      prisma.exchangeRequest.update({
        where: { id },
        data: {
          status: "approved",
          reverseAwb: reverseAwb
        }
      }),
      prisma.shipment.create({
        data: {
          orderId: exchangeRequest.orderId,
          awb: reverseAwb,
          trackingNumber: reverseAwb,
          courier: "Delhivery",
          status: pickupRes.status || "pickup_pending",
          type: "reverse_pickup",
          trackingUrl: `https://www.delhivery.com/track/package/${reverseAwb}`,
          rawDelhiveryResponse: JSON.stringify(pickupRes.rawResponse)
        }
      })
    ]);

    return NextResponse.json({
      success: true,
      awb: reverseAwb,
      status: "approved"
    });
  } catch (error: any) {
    console.error("Regenerate Exchange Pickup Error:", error);
    return NextResponse.json({ error: error.message || "Failed to regenerate reverse pickup" }, { status: 500 });
  }
}
