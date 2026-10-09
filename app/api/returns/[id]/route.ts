import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { resolveRequestCustomer } from "@/lib/requestAuth";

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    // Must be a verified app token or web session — a bare "Bearer x" header is not enough.
    const customer = await resolveRequestCustomer(req);
    if (!customer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id },
      include: {
        returns: true,
        order: { select: { customerId: true } },
      }
    });

    // Same response for "missing" and "not yours" so ids can't be probed.
    const ownerId = returnRequest?.customerId || returnRequest?.order?.customerId || null;
    if (!returnRequest || ownerId !== customer.id) {
      return NextResponse.json({ error: "Return request not found" }, { status: 404 });
    }

    return NextResponse.json({
      returnRequestId: returnRequest.id,
      orderId: returnRequest.orderId,
      status: returnRequest.status,
      estimatedRefund: returnRequest.estimatedRefund,
      actualRefund: returnRequest.actualRefund,
      createdAt: returnRequest.createdAt,
      approvedAt: returnRequest.approvedAt,
      items: returnRequest.returns
    });
  } catch (error: any) {
    console.error("Get Return Request Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
