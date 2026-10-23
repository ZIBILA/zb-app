import { NextResponse } from 'next/server';
import { 
  fetchProductById, 
  updateProduct, 
  updateVariant, 
  setInventoryLevel, 
  fetchLocations,
  updateProductMetafield
} from '@/lib/shopify-admin';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin('PRODUCTS', 'view');
    const product = await fetchProductById(params.id);
    return NextResponse.json({ product });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('Shopify Product GET Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin('PRODUCTS', 'edit');
    const body = await req.json();
    const { status, title, tags, body_html, product_type, vendor, variants, metafields } = body;
    
    // Update Shopify Product fields
    await updateProduct(params.id, { 
      status, 
      title, 
      tags, 
      body_html, 
      product_type, 
      vendor 
    });

    // Update Shopify Variants and Inventory Stock if requested
    if (variants && Array.isArray(variants)) {
      let locationId: string | null = null;
      try {
        const locations = await fetchLocations();
        const activeLocation = locations.find((l) => l.active) || locations[0];
        if (activeLocation) {
          locationId = String(activeLocation.id);
        }
      } catch (locErr: any) {
        console.warn('Failed to fetch Shopify locations for inventory update:', locErr.message);
      }

      for (const variant of variants) {
        const variantUpdates: any = {};
        if (variant.price !== undefined) variantUpdates.price = variant.price;
        if (variant.compare_at_price !== undefined) variantUpdates.compare_at_price = variant.compare_at_price;
        if (variant.sku !== undefined) variantUpdates.sku = variant.sku;
        if (variant.barcode !== undefined) variantUpdates.barcode = variant.barcode;

        if (Object.keys(variantUpdates).length > 0) {
          await updateVariant(String(variant.id), variantUpdates);
        }

        if (variant.inventory_quantity !== undefined && variant.inventory_item_id && locationId) {
          await setInventoryLevel(
            String(variant.inventory_item_id),
            locationId,
            parseInt(variant.inventory_quantity, 10)
          );
        }
      }
    }

    // Update Shopify Metafields if requested
    if (metafields && typeof metafields === 'object') {
      for (const [fullKey, value] of Object.entries(metafields)) {
        const parts = fullKey.split('.');
        const namespace = parts[0] || 'custom';
        const key = parts[1];
        if (key) {
          try {
            await updateProductMetafield(params.id, {
              namespace,
              key,
              value: String(value || ''),
              type: 'multi_line_text_field'
            });
          } catch (metaErr: any) {
            console.error(`Failed to update metafield ${fullKey}:`, metaErr.message);
          }
        }
      }
    }

    // Retrieve the fully updated product from Shopify
    const finalProduct = await fetchProductById(params.id);

    // Sync to local Prisma Database
    try {
      const firstVariant = finalProduct.variants?.[0];
      const shop = await prisma.shop.findFirst();
      if (shop) {
        // Upsert Product record
        const localProduct = await prisma.product.upsert({
          where: { shopifyProductId: String(finalProduct.id) },
          create: {
            shopId: shop.id,
            shopifyProductId: String(finalProduct.id),
            title: finalProduct.title,
            handle: finalProduct.handle,
            price: parseFloat(firstVariant?.price || '0'),
            sku: firstVariant?.sku || null,
            barcode: firstVariant?.barcode || null,
            inventoryItemId: firstVariant ? String(firstVariant.inventory_item_id) : null,
            featuredImage: finalProduct.image?.src || finalProduct.images?.[0]?.src || null,
          },
          update: {
            title: finalProduct.title,
            handle: finalProduct.handle,
            price: parseFloat(firstVariant?.price || '0'),
            sku: firstVariant?.sku || null,
            barcode: firstVariant?.barcode || null,
            inventoryItemId: firstVariant ? String(firstVariant.inventory_item_id) : null,
            featuredImage: finalProduct.image?.src || finalProduct.images?.[0]?.src || null,
          },
        });

        // Upsert inventory levels for variants in local DB
        const locations = await fetchLocations();
        const activeLocation = locations.find((l) => l.active) || locations[0];
        if (activeLocation) {
          const locId = String(activeLocation.id);
          for (const variant of finalProduct.variants) {
            await prisma.inventory.upsert({
              where: {
                productId_locationId: {
                  productId: localProduct.id,
                  locationId: locId,
                },
              },
              create: {
                productId: localProduct.id,
                locationId: locId,
                stockQuantity: variant.inventory_quantity ?? 0,
                reservedQuantity: 0,
              },
              update: {
                stockQuantity: variant.inventory_quantity ?? 0,
              },
            });
          }
        }
      }
    } catch (syncErr: any) {
      console.error('Failed to sync updated product to local DB:', syncErr.message);
    }

    return NextResponse.json({ product: finalProduct });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('Shopify Product PATCH Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
