import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

async function POST_impl(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { reason } = body;

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id },
      include: { returns: true }
    });

    if (!returnRequest) {
      return NextResponse.json({ error: "Return request not found" }, { status: 404 });
    }

    const updatedRequest = await prisma.returnRequest.update({
      where: { id },
      data: {
        status: "rejected",
        reason
      }
    });

    // Update the individual return items
    await prisma.return.updateMany({
      where: { returnRequestId: id },
      data: { status: "REJECTED" }
    });

    // Update order status back to delivered or return_rejected
    await prisma.order.update({
      where: { id: returnRequest.orderId },
      data: { status: "delivered" } // or "return_rejected"
    });

    return NextResponse.json(updatedRequest);
  } catch (error: any) {
    console.error("Reject Return Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
