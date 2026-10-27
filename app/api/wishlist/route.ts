import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getAppAuthFromRequest, resolveAuthCustomer } from "@/lib/appAuth";
import { fetchProductById, shopifyFetch, ShopifyProduct } from "@/lib/shopify-admin";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/options";

export const dynamic = "force-dynamic";

async function getCustomerFromSessionOrToken(req: Request) {
  let customer = null;

  // 1. Try NextAuth session first (web)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      const userId = (session.user as any).id;
      const email = session.user.email;
      const phone = (session as any).customer?.phone || (session.user as any).phone;

      const whereClause: any = { OR: [] };
      if (userId) whereClause.OR.push({ id: userId });
      if (email) whereClause.OR.push({ email });
      if (phone) whereClause.OR.push({ phone });

      if (whereClause.OR.length > 0) {
        customer = await prisma.customer.findFirst({
          where: whereClause
        });
      }
    }
  } catch (err) {
    console.error("NextAuth session check error in wishlist:", err);
  }

  // 2. Try mobile Bearer token next
  if (!customer) {
    const auth = getAppAuthFromRequest(req);
    if (auth) {
      customer = await resolveAuthCustomer(auth);
    }
  }

  return customer;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customerIdParam = url.searchParams.get("customerId") || url.searchParams.get("userId");
  const countOnly = url.searchParams.get("count") === "true";

  // Health-check / test bypass for the admin dashboard diagnostics
  if (customerIdParam === "test" || customerIdParam === "health-check" || countOnly) {
    if (countOnly) {
      const total = await prisma.wishlist.count().catch(() => 0);
      return NextResponse.json({ total, items: [] }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    return NextResponse.json({ items: [], isHealthCheck: true }, {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }

  const customer = await getCustomerFromSessionOrToken(req);
  if (!customer) {
    return NextResponse.json({ items: [] }, { status: 200 });
  }

  try {
    const wishlistItems = await prisma.wishlist.findMany({
      where: { customerId: customer.id },
      include: {
        product: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Extract all shopify product IDs
    const shopifyProductIds = wishlistItems
      .map((item: any) => item.product.shopifyProductId.replace(/^gid:\/\/shopify\/Product\//, ''))
      .filter((id: any) => !!id);

    let shopifyProducts: ShopifyProduct[] = [];
    if (shopifyProductIds.length > 0) {
      try {
        const data = await shopifyFetch<{ products: ShopifyProduct[] }>("products.json", {
          ids: shopifyProductIds.join(",")
        });
        shopifyProducts = data.products || [];
      } catch (e) {
        console.error("Failed to fetch wishlist products from Shopify:", e);
      }
    }

    // Map to a more useful format for the app
    const items = wishlistItems.map((item: any) => {
      const cleanId = item.product.shopifyProductId.replace(/^gid:\/\/shopify\/Product\//, '');
      const shopifyProduct = shopifyProducts.find(p => String(p.id) === cleanId);

      const productData: any = {
        ...item.product,
        // Ensure id is the GID if that's what the app expects for keys
        id: item.product.shopifyProductId.startsWith('gid://') 
          ? item.product.shopifyProductId 
          : `gid://shopify/Product/${item.product.shopifyProductId}`,
        // Map other fields to match FlatProduct
        price: String(item.product.price || '0'),
        image: item.product.featuredImage ? { src: item.product.featuredImage } : null,
        images: item.product.featuredImage ? [{ src: item.product.featuredImage }] : [],
        variants: [
          {
            id: `gid://shopify/ProductVariant/default_${item.product.shopifyProductId}`,
            price: String(item.product.price || '0'),
            title: 'Default Title',
            option1: 'Default Title'
          }
        ],
        isSoldOut: false,
        isOnSale: false,
      };

      if (shopifyProduct) {
        productData.title = shopifyProduct.title;
        productData.handle = shopifyProduct.handle;
        if (shopifyProduct.image?.src) {
          productData.image = { src: shopifyProduct.image.src };
        }
        if (shopifyProduct.images && shopifyProduct.images.length > 0) {
          productData.images = shopifyProduct.images.map(img => ({ src: img.src }));
        }
        if (shopifyProduct.options) {
          productData.options = shopifyProduct.options.map(opt => ({
            id: String(opt.id),
            name: opt.name,
            position: opt.position,
            values: opt.values
          }));
        }
        if (shopifyProduct.variants && shopifyProduct.variants.length > 0) {
          productData.variants = shopifyProduct.variants.map(v => ({
            id: `gid://shopify/ProductVariant/${v.id}`,
            price: String(v.price || '0'),
            title: v.title,
            option1: v.option1 || '',
            option2: v.option2 || '',
            option3: v.option3 || '',
            compareAtPrice: v.compare_at_price ? String(v.compare_at_price) : null,
            inventoryQuantity: v.inventory_quantity,
            inventory_quantity: v.inventory_quantity,
            inventoryManagement: v.inventory_management,
            inventory_management: v.inventory_management,
            isSoldOut: v.inventory_management && v.inventory_quantity <= 0
          }));
        }
        
        // Handle isSoldOut check for the product (all variants sold out)
        productData.isSoldOut = shopifyProduct.variants?.every(v => v.inventory_management && v.inventory_quantity <= 0) || false;
        
        // Check if product is on sale
        productData.isOnSale = shopifyProduct.variants?.some(v => v.compare_at_price && parseFloat(v.compare_at_price) > parseFloat(v.price)) || false;
      }

      return {
        ...item,
        product: productData
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error fetching wishlist:", error);
    return NextResponse.json({ error: "Failed to fetch wishlist" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const customer = await getCustomerFromSessionOrToken(req);
  if (!customer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { productId, variantId, size, action } = await req.json();

    if (!productId) {
      return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
    }

    // Strip GID prefix if present for database lookup
    const cleanId = productId.replace(/^gid:\/\/shopify\/Product\//, '');

    if (action === "remove") {
      const deleteWhere: any = {
        customerId: customer.id,
        product: {
          OR: [
            { id: productId },
            { shopifyProductId: cleanId }
          ]
        }
      };
      if (variantId) {
        deleteWhere.variantId = variantId;
      }
      await prisma.wishlist.deleteMany({
        where: deleteWhere
      });
      return NextResponse.json({ success: true, message: "Removed from wishlist" });
    } else {
      let product = await prisma.product.findFirst({
        where: {
          OR: [
            { id: productId },
            { shopifyProductId: cleanId }
          ]
        }
      });

      if (!product) {
        // Try fetching from Shopify if not in DB
        try {
          const shopifyProduct = await fetchProductById(cleanId);
          if (shopifyProduct) {
             const firstVariant = shopifyProduct.variants?.[0];
             const shop = await prisma.shop.findFirst();
             if (shop) {
               product = await prisma.product.create({
                 data: {
                   shopId: shop.id,
                   shopifyProductId: cleanId,
                   title: shopifyProduct.title,
                   handle: shopifyProduct.handle,
                   price: parseFloat(firstVariant?.price || '0'),
                   featuredImage: shopifyProduct.image?.src || null,
                 }
               });
             }
          }
        } catch (e) {
          console.error("Shopify fetch failed for wishlist add:", e);
        }
      }

      if (!product) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }

      const existing = await prisma.wishlist.findFirst({
        where: {
          customerId: customer.id,
          productId: product.id,
          variantId: variantId || null
        }
      });

      let item;
      if (existing) {
        item = await prisma.wishlist.update({
          where: { id: existing.id },
          data: {
            size: size || existing.size
          }
        });
      } else {
        item = await prisma.wishlist.create({
          data: {
            customerId: customer.id,
            productId: product.id,
            variantId: variantId || null,
            size: size || null
          }
        });
      }

      return NextResponse.json({ success: true, item });
    }
  } catch (error) {
    console.error("Error updating wishlist:", error);
    return NextResponse.json({ error: "Failed to update wishlist" }, { status: 500 });
  }
}
