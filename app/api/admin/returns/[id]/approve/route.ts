import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { actualRefund, isStoreCredit, customerId } = body;

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id },
      include: { 
        returns: true,
        order: {
          include: {
            customer: true
          }
        }
      }
    });

    if (!returnRequest) {
      return NextResponse.json({ error: "Return request not found" }, { status: 404 });
    }

    const refundAmount = actualRefund !== undefined ? actualRefund : returnRequest.estimatedRefund;

    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Update the return request status
      const updatedRequest = await tx.returnRequest.update({
        where: { id },
        data: {
          status: "approved",
          actualRefund: refundAmount,
          approvedAt: new Date()
        }
      });

      // 2. Update individual return items (keep refundStatus PENDING until QC and Admin Refund Approval)
      await tx.return.updateMany({
        where: { returnRequestId: id },
        data: { 
          status: "APPROVED",
          refundAmount: isStoreCredit ? refundAmount : refundAmount,
          storeCreditAmount: isStoreCredit ? refundAmount : 0,
          refundStatus: "PENDING",
          refundMethod: isStoreCredit ? "store_credit" : "original_method"
        }
      });

      // 4. Update order status & auto-cancel any pending exchange requests for mutual exclusivity
      await tx.order.update({
        where: { id: returnRequest.orderId },
        data: { status: "return_approved" }
      });

      await tx.exchangeRequest.updateMany({
        where: {
          orderId: returnRequest.orderId,
          status: { in: ["pending_approval", "submitted"] }
        },
        data: {
          status: "cancelled",
          reason: "Auto-cancelled due to approved Return Request"
        }
      });

      // 5. Create a reverse shipment tracking record with real Delhivery reverse pickup
      let reverseAwb: string | null = null;
      let pickupStatus = 'pickup_pending';
      let requestStatus = 'approved';
      let delhiveryRaw: any = null;

      try {
        const { createReversePickup } = await import('@/lib/delhivery');
        
        let addrObj: any = {};
        const shippingRaw = returnRequest.order.shippingAddress;
        if (typeof shippingRaw === 'string') {
          try { addrObj = JSON.parse(shippingRaw); } catch (_) { addrObj = { add: shippingRaw }; }
        } else if (shippingRaw && typeof shippingRaw === 'object') {
          addrObj = shippingRaw;
        }

        const customer = returnRequest.order.customer;
        const name = addrObj.name || (addrObj.first_name ? `${addrObj.first_name} ${addrObj.last_name || ''}`.trim() : customer?.name || 'Customer');
        const add = addrObj.add || addrObj.address1 || addrObj.street || addrObj.fullAddress || (typeof shippingRaw === 'string' ? shippingRaw : 'Address Not Specified');
        const pin = addrObj.pin || addrObj.zip || addrObj.pincode || addrObj.postalCode || '110001';
        const phone = addrObj.phone || customer?.phone || '9876543210';
        const prodDesc = returnRequest.returns.map((r: any) => r.sku || 'Item').join(', ');

        const pickupRes = await createReversePickup({
          name,
          add,
          pin: String(pin),
          phone: String(phone),
          order: returnRequest.id, // Deterministic request reference
          products_desc: `Return: ${prodDesc}`,
          weight: '500',
          seller_name: 'Zica Bella',
          pickup_location_name: process.env.DELHIVERY_PICKUP_LOCATION || 'Zica Bella Warehouse',
        });

        reverseAwb = pickupRes.awb;
        pickupStatus = pickupRes.status;
        requestStatus = 'approved';
        delhiveryRaw = pickupRes.rawResponse;
      } catch (dErr: any) {
        console.error('[Return Approve] Delhivery reverse pickup failed:', dErr.message);
        pickupStatus = 'pickup_registration_failed';
        requestStatus = 'approved_pickup_failed';
        delhiveryRaw = { error: dErr.message, note: 'Delhivery pickup creation failed. Marked as approved_pickup_failed for admin retry.' };
      }

      await tx.shipment.create({
        data: {
          orderId: returnRequest.orderId,
          awb: reverseAwb,
          trackingNumber: reverseAwb,
          courier: "Delhivery",
          status: pickupStatus,
          type: "reverse_pickup",
          trackingUrl: reverseAwb ? `https://www.delhivery.com/track/package/${reverseAwb}` : null,
          rawDelhiveryResponse: JSON.stringify(delhiveryRaw)
        }
      });

      // Update ReturnRequest status & store reverseAwb
      const finalRequest = await tx.returnRequest.update({
        where: { id },
        data: {
          status: requestStatus,
          reverseAwb: reverseAwb
        }
      });

      return { finalRequest, reverseAwb };
    });

    // Mark SKUs on returned items as RETURNED (not yet restocked — that happens on RECEIVED)
    try {
      const { markSkuStatus } = await import('@/lib/services/skuService');
      for (const ret of returnRequest.returns) {
        if (ret.sku) {
          await markSkuStatus(ret.sku, 'RETURNED', 'RETURN_IN', 'Admin (Return Approve)');
        }
      }
    } catch (skuErr) {
      console.error('[Return Approve] SKU status update failed:', skuErr);
    }

    // Auto-send Return Pickup Scheduled WhatsApp notification
    try {
      const { sendReturnPickupScheduled } = await import('@/lib/whatsapp/templates');
      const cust = returnRequest.order.customer;
      let phone = cust?.phone;
      if (!phone && returnRequest.order.shippingAddress) {
        try {
          const parsed = typeof returnRequest.order.shippingAddress === 'string'
            ? JSON.parse(returnRequest.order.shippingAddress)
            : returnRequest.order.shippingAddress;
          phone = parsed?.phone;
        } catch (_) {}
      }
      if (phone) {
        const orderIdDisplay = returnRequest.order.shopifyOrderId || returnRequest.orderId;
        const customerName = cust?.name || 'Valued Customer';
        await sendReturnPickupScheduled({
          phone,
          customerName,
          orderId: orderIdDisplay,
          pickupDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          awbNumber: result.reverseAwb || 'Pickup Scheduled',
        });
      }
    } catch (waErr: any) {
      console.error('[Return Approve] WhatsApp pickup notification error:', waErr.message);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Approve Return Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
