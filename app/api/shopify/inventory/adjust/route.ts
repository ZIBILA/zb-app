import { NextResponse } from 'next/server';
import { adjustInventoryLevel, fetchLocations } from '@/lib/shopify-admin';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopify/inventory/adjust
 * Body: { inventoryItemId, locationId?, delta }
 * If locationId is 0 or omitted, auto-resolves the first active Shopify location.
 * Adjusts inventory in Shopify and syncs to local DB.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin('INVENTORY', 'edit');

    const body = await req.json();
    const { inventoryItemId, delta } = body;
    let { locationId } = body;

    if (!inventoryItemId || typeof delta !== 'number') {
      return NextResponse.json(
        { error: 'inventoryItemId and delta (number) are required' },
        { status: 400 }
      );
    }

    // Auto-resolve location if not provided or is 0
    if (!locationId || locationId === 0) {
      const locations = await fetchLocations();
      const activeLocation = locations.find((l) => l.active) || locations[0];
      if (!activeLocation) {
        return NextResponse.json({ error: 'No Shopify location found' }, { status: 400 });
      }
      locationId = String(activeLocation.id);
    }

    // Push adjustment to Shopify
    const updatedLevel = await adjustInventoryLevel(
      String(inventoryItemId),
      String(locationId),
      delta
    );

    // Sync local DB (first-variant Product.inventoryItemId, else product_skus)
    let product = await prisma.product.findUnique({
      where: { inventoryItemId: String(inventoryItemId) },
    });
    if (!product) {
      try {
        const skuRows: { product_id: string }[] = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT product_id FROM product_skus WHERE inventory_item_id = $1 LIMIT 1`,
          String(inventoryItemId)
        );
        if (skuRows[0]?.product_id) {
          product = await prisma.product.findUnique({ where: { id: skuRows[0].product_id } });
        }
      } catch (skuLookupErr) {
        console.warn('[Inventory Adjust] product_skus lookup failed:', skuLookupErr);
      }
    }

    if (product) {
      await prisma.inventory.upsert({
        where: {
          productId_locationId: {
            productId: product.id,
            locationId: String(locationId),
          },
        },
        create: {
          productId: product.id,
          locationId: String(locationId),
          stockQuantity: updatedLevel.available ?? 0,
          reservedQuantity: 0,
        },
        update: {
          stockQuantity: updatedLevel.available ?? 0,
        },
      });
    }

    return NextResponse.json({ success: true, inventoryLevel: updatedLevel });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Inventory Adjust Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
