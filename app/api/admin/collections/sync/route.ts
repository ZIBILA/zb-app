import { NextResponse } from "next/server";
import { clearShopifyCache, fetchCollections } from "@/lib/shopify-admin";
import { collectionProductCount } from "@/lib/adminCollectionMetrics";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    clearShopifyCache();
    const collections = await fetchCollections();
    return NextResponse.json({
      success: true,
      message: "Collections refreshed from Shopify",
      count: collections.length,
      products: collections.reduce((sum, c) => sum + collectionProductCount(c), 0),
    });
  } catch (error: any) {
    console.error("Sync collections cache error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
