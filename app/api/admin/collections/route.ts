import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { fetchCollections } from "@/lib/shopify-admin";
import { revalidatePath } from "next/cache";

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/collections
 * Returns all Shopify collections and the current enabled handles for all locations.
 */
export async function GET() {
  try {
    const allCollections = await fetchCollections();
    const allHandles = allCollections.map(c => c.handle);
    const shop = await prisma.shop.findFirst();
    
    // Fallback to all handles if not set (initial state)
    const header = shop?.enabledCollectionsHeader ? JSON.parse(shop.enabledCollectionsHeader) : allHandles;
    const page = shop?.enabledCollectionsPage ? JSON.parse(shop.enabledCollectionsPage) : allHandles;
    const menu = shop?.enabledCollectionsMenu ? JSON.parse(shop.enabledCollectionsMenu) : allHandles;

    return NextResponse.json({
      allCollections,
      enabled: {
        header,
        page,
        menu
      }
    });
  } catch (error: any) {
    console.error("Admin Collections GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/collections
 * Saves the arrays of enabled collection handles to the DB.
 */
export async function POST(req: NextRequest) {
  try {
    const { header, page, menu } = await req.json();
    
    console.log("[Admin Collections] Saving settings:", { header, page, menu });

    if (!Array.isArray(header) || !Array.isArray(page) || !Array.isArray(menu)) {
      return NextResponse.json({ error: "Invalid handles arrays" }, { status: 400 });
    }

    const shop = await prisma.shop.findFirst();
    if (!shop) {
      console.error("[Admin Collections] No shop found in DB during update");
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        enabledCollectionsHeader: JSON.stringify(header),
        enabledCollectionsPage: JSON.stringify(page),
        enabledCollectionsMenu: JSON.stringify(menu),
      },
    });

    console.log("[Admin Collections] Successfully updated shop:", shop.id);

    const { refreshStorefront } = await import('@/lib/storefrontRefresh');
    refreshStorefront();
    revalidatePath("/");
    revalidatePath("/collections/[handle]", "page");
    revalidatePath("/api/shopify/collections");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin Collections POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
