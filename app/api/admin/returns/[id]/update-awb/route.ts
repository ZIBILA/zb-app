import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { awb } = body;

    if (!awb || !String(awb).trim()) {
      return NextResponse.json({ error: "AWB number is required" }, { status: 400 });
    }

    const cleanAwb = String(awb).trim();

    const request = await prisma.returnRequest.findUnique({
      where: { id },
      include: { order: true },
    });

    if (!request) {
      return NextResponse.json({ error: "Return request not found" }, { status: 404 });
    }

    await prisma.returnRequest.update({
      where: { id },
      data: { reverseAwb: cleanAwb },
    });

    const trackingUrl = `https://shiprocket.co/tracking/${cleanAwb}`;
    await prisma.shipment.upsert({
      where: { awb: cleanAwb },
      update: {
        type: "reverse_pickup",
        trackingUrl,
        courier: (request as any).logisticsPartner || "Shiprocket",
      },
      create: {
        orderId: request.orderId,
        awb: cleanAwb,
        trackingNumber: cleanAwb,
        courier: (request as any).logisticsPartner || "Shiprocket",
        status: "pickup_pending",
        type: "reverse_pickup",
        trackingUrl,
      },
    });

    return NextResponse.json({ success: true, awb: cleanAwb });
  } catch (error: any) {
    console.error("Update Return AWB Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update AWB" }, { status: 500 });
  }
}
