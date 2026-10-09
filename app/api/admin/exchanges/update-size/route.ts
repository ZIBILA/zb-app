import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

/**
 * PATCH /api/admin/exchanges/update-size
 * Updates size for original or replacement item in an Exchange.
 * Payload: { exchangeId: string, itemType: 'original' | 'new', size: string, variantTitle?: string }
 */
async function PATCH_impl(req: Request) {
  try {
    const body = await req.json();
    const { exchangeId, itemType, size, variantTitle } = body;

    if (!exchangeId || !size || !itemType) {
      return NextResponse.json({ error: "Missing required fields: exchangeId, itemType, size" }, { status: 400 });
    }

    const cleanSize = size.trim().toUpperCase();
    const cleanVariant = variantTitle?.trim() || `Size: ${cleanSize}`;

    const exchange = await prisma.exchange.findUnique({
      where: { id: exchangeId },
      include: { order: { include: { items: true } } }
    });

    if (!exchange) {
      return NextResponse.json({ error: "Exchange item not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (itemType === 'original') {
      updateData.originalSize = cleanSize;
      updateData.originalVariantTitle = cleanVariant;
    } else if (itemType === 'new') {
      updateData.newSize = cleanSize;
      updateData.newVariantTitle = cleanVariant;
    } else {
      return NextResponse.json({ error: "itemType must be 'original' or 'new'" }, { status: 400 });
    }

    const updatedExchange = await prisma.exchange.update({
      where: { id: exchangeId },
      data: updateData,
    });

    // Also update order item size if original product matches
    if (itemType === 'original' && exchange.order?.items) {
      const matchingItem = exchange.order.items.find(
        (i: any) => i.productId === exchange.originalProductId
      );
      if (matchingItem) {
        await prisma.orderItem.update({
          where: { id: matchingItem.id },
          data: {
            size: cleanSize,
            variantTitle: cleanVariant,
          }
        });
      }
    }

    return NextResponse.json({
      success: true,
      exchange: updatedExchange
    });
  } catch (error: any) {
    console.error("Update Exchange Size Error:", error.message);
    return NextResponse.json({ error: "Failed to update size" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: any) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
  } catch (authError) {
    return handleAuthError(authError);
  }
  return (PATCH_impl as any)(req, ctx);
}
