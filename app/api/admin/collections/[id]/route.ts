import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { fetchCollections, fetchProductsByCollectionId } from "@/lib/shopify-admin";
import { refreshStorefront } from "@/lib/storefrontRefresh";
import { parseOrderConfig, serializeOrderConfig, readPlacement, writePlacement } from "@/lib/storefrontCatalog";
import {
  COLLECTION_EXCLUDED_ORDER_STATUSES,
  COLLECTION_SUCCESS_PAYMENT_STATUSES,
  collectionDateRange,
  collectionProductCount,
  normalizeShopifyId,
  type CollectionDatePreset,
} from "@/lib/adminCollectionMetrics";

export const dynamic = "force-dynamic";

function slimOrder(order: any, matchingItems: any[]) {
  return {
    id: order.id,
    shopifyOrderName: order.shopifyOrderName,
    createdAt: order.createdAt,
    totalPrice: matchingItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0),
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    customer: order.customer
      ? {
          name: order.customer.name || null,
          email: order.customer.email,
        }
      : null,
    items: matchingItems.map((item) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    })),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const collectionId = params.id;
    const url = new URL(req.url);
    const preset = (url.searchParams.get("range") || "last7") as CollectionDatePreset;
    const customFrom = url.searchParams.get("from");
    const customTo = url.searchParams.get("to");
    const { from, to } = collectionDateRange(
      ["today", "yesterday", "last7", "month", "custom"].includes(preset) ? preset : "last7",
      customFrom,
      customTo
    );

    const allCollections = await fetchCollections();
    const collection = allCollections.find((c) => String(c.id) === String(collectionId));

    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    const products = await fetchProductsByCollectionId(collectionId).catch(() => []);
    const shopifyProductIds = new Set(products.map((p) => normalizeShopifyId(p.id)).filter(Boolean));
    const shopifyVariantIds = new Set(
      products.flatMap((p) => (p.variants || []).map((v) => normalizeShopifyId(v.id))).filter(Boolean)
    );
    const variantLookup = Array.from(shopifyVariantIds).flatMap((id) => [id, `gid://shopify/ProductVariant/${id}`]);
    const productLookup = Array.from(shopifyProductIds).flatMap((id) => [id, `gid://shopify/Product/${id}`]);

    const localProducts = shopifyProductIds.size
      ? await prisma.product.findMany({
          where: { shopifyProductId: { in: Array.from(shopifyProductIds) } },
          select: { id: true, shopifyProductId: true },
        })
      : [];
    const localProductIds = new Set(localProducts.map((p: any) => p.id));

    const createdAt =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;

    const itemOr = [
      localProductIds.size ? { productId: { in: Array.from(localProductIds) } } : undefined,
      variantLookup.length ? { variantId: { in: variantLookup } } : undefined,
      productLookup.length
        ? { product: { shopifyProductId: { in: Array.from(shopifyProductIds) } } }
        : undefined,
    ].filter(Boolean) as any[];

    const orders = itemOr.length === 0 ? [] : await prisma.order.findMany({
      where: {
        paymentStatus: { in: [...COLLECTION_SUCCESS_PAYMENT_STATUSES] },
        status: { notIn: [...COLLECTION_EXCLUDED_ORDER_STATUSES] },
        ...(createdAt ? { createdAt } : {}),
        items: { some: { OR: itemOr } },
      },
      select: {
        id: true,
        shopifyOrderName: true,
        createdAt: true,
        totalPrice: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        customer: { select: { name: true, email: true } },
        items: {
          select: {
            id: true,
            title: true,
            quantity: true,
            price: true,
            variantId: true,
            productId: true,
            product: { select: { shopifyProductId: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const itemBelongs = (item: any) => {
      const variantId = normalizeShopifyId(item.variantId);
      const localId = String(item.productId || "");
      const shopifyPid = normalizeShopifyId(item.product?.shopifyProductId);
      return (
        (variantId && shopifyVariantIds.has(variantId)) ||
        (localId && localProductIds.has(localId)) ||
        (shopifyPid && shopifyProductIds.has(shopifyPid))
      );
    };

    const mapped = orders
      .map((order: any) => {
        const matchingItems = (order.items || []).filter(itemBelongs);
        if (matchingItems.length === 0) return null;
        return slimOrder(order, matchingItems);
      })
      .filter(Boolean);

    const revenue = mapped.reduce((sum: number, order: any) => sum + Number(order.totalPrice || 0), 0);

    const shop = await prisma.shop.findFirst({
      select: { collectionProductOrders: true },
    });

    const customOrder = readPlacement(parseOrderConfig(shop?.collectionProductOrders), {
      id: collectionId,
      handle: collection.handle,
    }).order;

    return NextResponse.json({
      collection: {
        ...collection,
        productsCount: collectionProductCount(collection) || products.length,
      },
      products,
      orders: mapped,
      customOrder,
      stats: {
        totalProducts: products.length,
        totalOrders: mapped.length,
        totalSales: revenue,
        range: preset,
        from: from?.toISOString() || null,
        to: to?.toISOString() || null,
      },
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
    const next = writePlacement(cfg, placement, productIds.map(String), keep.hidden);

    await prisma.shop.update({
      where: { id: shop.id },
      data: { collectionProductOrders: serializeOrderConfig(next) },
    });

    refreshStorefront();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Collection details POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
