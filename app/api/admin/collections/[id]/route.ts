import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { fetchCollections, fetchProductsByCollectionId, clearShopifyCache } from "@/lib/shopify-admin";
import { refreshStorefront } from "@/lib/storefrontRefresh";
import { parseOrderConfig, serializeOrderConfig, readPlacement, writePlacement } from "@/lib/storefrontCatalog";

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const collectionId = params.id;
    const allCollections = await fetchCollections();
    const collection = allCollections.find(c => String(c.id) === String(collectionId));

    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    // Fetch products in the collection
    const products = await fetchProductsByCollectionId(collectionId).catch(() => []);

    // Get product IDs in the collection
    const productIds = products.map(p => String(p.id));

    // Find local products to get their db IDs
    const localProducts = await prisma.product.findMany({
      where: {
        shopifyProductId: {
          in: productIds
        }
      },
      select: { id: true, shopifyProductId: true }
    });

    const localProductIds = localProducts.map((p: { id: string }) => p.id);

    // Find orders containing these products
    const orders = await prisma.order.findMany({
      where: {
        items: {
          some: {
            productId: {
              in: localProductIds
            }
          }
        }
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Fetch custom order list from DB
    const shop = await prisma.shop.findFirst({
      select: { collectionProductOrders: true }
    });
    
    const customOrder = readPlacement(parseOrderConfig(shop?.collectionProductOrders), {
      id: collectionId,
      handle: collection.handle,
    }).order;

    return NextResponse.json({
      collection,
      products,
      orders,
      customOrder
    });
  } catch (error: any) {
    console.error("Collection details GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const collectionId = params.id;
    const { productIds } = await req.json();

    if (!Array.isArray(productIds)) {
      return NextResponse.json({ error: "Invalid productIds list" }, { status: 400 });
    }

    const shop = await prisma.shop.findFirst();
    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    const collection = (await fetchCollections()).find((c) => String(c.id) === String(collectionId));
    const placement = { id: collectionId, handle: collection?.handle };
    const cfg = parseOrderConfig(shop.collectionProductOrders);
    const keep = readPlacement(cfg, placement);
    // Only the order changes here; products hidden from this collection stay hidden.
    const next = writePlacement(cfg, placement, productIds.map(String), keep.hidden);

    await prisma.shop.update({
      where: { id: shop.id },
      data: { collectionProductOrders: serializeOrderConfig(next) },
    });

    // Drop cached Shopify data and re-render the live pages (the live route is /collections/<handle>).
    refreshStorefront();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Collection details POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
