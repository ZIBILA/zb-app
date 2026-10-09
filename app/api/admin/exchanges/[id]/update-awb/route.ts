import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

async function POST_impl(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { awb } = body;
    const awbType: 'forward' | 'reverse' = body.type === 'forward' ? 'forward' : 'reverse';

    if (!awb || !String(awb).trim()) {
      return NextResponse.json({ error: "AWB number is required" }, { status: 400 });
    }

    const cleanAwb = String(awb).trim();

    const request = await prisma.exchangeRequest.findUnique({
      where: { id },
      include: { order: true },
    });

    if (!request) {
      return NextResponse.json({ error: "Exchange request not found" }, { status: 404 });
    }

    const trackingUrl = `https://shiprocket.co/tracking/${cleanAwb}`;
    const courier = (request as any).logisticsPartner || "Shiprocket";

    // An AWB belongs to exactly one shipment. Never re-point another order's parcel at this exchange.
    const existing = await prisma.shipment.findUnique({ where: { awb: cleanAwb }, select: { orderId: true, type: true } });

    if (awbType === 'forward') {
      // Outbound parcel of the replacement (G_E_) order — not the original order, not the pickup.
      if (!request.replacementOrderId) {
        return NextResponse.json({ error: "The replacement order has not been created yet." }, { status: 400 });
      }
      if (existing && existing.orderId !== request.replacementOrderId) {
        return NextResponse.json({ error: "This AWB is already assigned to a different order." }, { status: 409 });
      }
      await prisma.$transaction([
        prisma.shipment.upsert({
          where: { awb: cleanAwb },
          update: { trackingUrl, courier },
          create: {
            orderId: request.replacementOrderId,
            awb: cleanAwb,
            trackingNumber: cleanAwb,
            courier,
            status: "confirmed",
            type: "outbound",
            trackingUrl,
          },
        }),
        prisma.order.update({ where: { id: request.replacementOrderId }, data: { delhivery_awb: cleanAwb } }),
      ]);
      return NextResponse.json({ success: true, awb: cleanAwb, type: 'forward' });
    }

    if (existing && existing.orderId !== request.orderId) {
      return NextResponse.json({ error: "This AWB is already assigned to a different order." }, { status: 409 });
    }
    if (existing && existing.type && !['reverse_pickup', 'reverse', 'return', 'exchange_pickup'].includes(String(existing.type))) {
      return NextResponse.json({ error: "This AWB belongs to the outbound parcel, not a pickup." }, { status: 409 });
    }

    await prisma.exchangeRequest.update({
      where: { id },
      data: { reverseAwb: cleanAwb },
    });

    await prisma.shipment.upsert({
      where: { awb: cleanAwb },
      update: {
        type: "reverse_pickup",
        trackingUrl,
        courier,
      },
      create: {
        orderId: request.orderId,
        awb: cleanAwb,
        trackingNumber: cleanAwb,
        courier,
        status: "pickup_pending",
        type: "reverse_pickup",
        trackingUrl,
      },
    });

    return NextResponse.json({ success: true, awb: cleanAwb });
  } catch (error: any) {
    console.error("Update Exchange AWB Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update AWB" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: any) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
  } catch (authError) {
    return handleAuthError(authError);
  }
  return (POST_impl as any)(req, ctx);
}
