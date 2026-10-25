/**
 * SKU Lifecycle Service
 * 
 * Shared utility functions for managing product_skus status transitions
 * across the order lifecycle: ORDER_OUT, CANCEL, RETURN, EXCHANGE, RTO.
 * 
 * The product_skus table is managed via raw SQL (not a Prisma model)
 * since it's created dynamically by the price tag printing system.
 */

import prisma from '@/lib/db';

// Custom SKU format: ZB01AB02CDM1234
function isCustomSku(sku: string | null | undefined): boolean {
  if (!sku) return false;
  return /^ZB\d{2}[A-Z]{2}\d{2}[A-Z]{2}(XS|S|M|L|XL|XXL)\d+$/i.test(sku);
}

interface SkuRecord {
  id: string;
  product_id: string;
  sku: string;
  size: string;
  quantity: number;
  status: string;
  shopify_variant_id: string | null;
  inventory_item_id: string | null;
}

/**
 * Find a SKU record in the product_skus table by SKU string.
 * Returns null if not found.
 */
async function findSkuRecord(sku: string): Promise<SkuRecord | null> {
  try {
    const records: SkuRecord[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM product_skus WHERE UPPER(sku) = $1`,
      sku.trim().toUpperCase()
    );
    return records.length > 0 ? records[0] : null;
  } catch (err) {
    console.error(`[SkuService] Error finding SKU ${sku}:`, err);
    return null;
  }
}

/**
 * Update a SKU's status in the product_skus table.
 */
async function updateSkuStatus(skuId: string, status: string, quantity: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE product_skus SET status = $1, quantity = $2 WHERE id = $3`,
    status, quantity, skuId
  );
}

/**
 * Resolve the correct variant-level inventory_item_id for a SKU record.
 * 
 * Priority:
 * 1. Use the inventory_item_id stored on the product_skus row (backfilled or set at print time)
 * 2. Fall back to a live Shopify API lookup by product + size match
 * 3. Fall back to Product.inventoryItemId as last resort (legacy behavior)
 */
async function resolveVariantInventoryItemId(skuRec: SkuRecord): Promise<string | null> {
  // 1. Direct from SKU record (best case — already resolved)
  if (skuRec.inventory_item_id) {
    return skuRec.inventory_item_id;
  }

  // 2. Live Shopify lookup by product + size
  try {
    const dbProduct = await prisma.product.findUnique({
      where: { id: skuRec.product_id }
    });

    if (dbProduct) {
      const { fetchProductById } = await import('@/lib/shopify-admin');
      const shopifyProduct = await fetchProductById(dbProduct.shopifyProductId);

      if (shopifyProduct?.variants) {
        const sizeUpper = skuRec.size.toUpperCase().trim();
        const matchedVariant = shopifyProduct.variants.find((v: any) =>
          (v.option1 && v.option1.toUpperCase().trim() === sizeUpper) ||
          (v.title && v.title.toUpperCase().trim() === sizeUpper)
        );

        if (matchedVariant) {
          const inventoryItemId = String(matchedVariant.inventory_item_id);

          // Opportunistically backfill the SKU record
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE product_skus SET shopify_variant_id = $1, inventory_item_id = $2 WHERE id = $3`,
              String(matchedVariant.id),
              inventoryItemId,
              skuRec.id
            );
            console.log(`[SkuService] Backfilled variant IDs for SKU ${skuRec.sku}: inv_item=${inventoryItemId}`);
          } catch (e) {
            console.error(`[SkuService] Failed to backfill variant IDs for SKU ${skuRec.sku}:`, e);
          }

          return inventoryItemId;
        }
      }

      // 3. Last resort: Product-level inventoryItemId (legacy, may be wrong variant)
      if (dbProduct.inventoryItemId) {
        console.warn(`[SkuService] Using product-level inventoryItemId for SKU ${skuRec.sku} (variant lookup failed). This may adjust the wrong variant.`);
        return dbProduct.inventoryItemId;
      }
    }
  } catch (err) {
    console.error(`[SkuService] Error resolving variant inventory_item_id for SKU ${skuRec.sku}:`, err);
  }

  return null;
}

/**
 * Adjust Shopify + local inventory for a product by delta (+1 or -1).
 * Uses the variant-specific inventory_item_id, NOT the product-level one.
 * Silently catches errors to avoid breaking the parent flow.
 */
async function adjustProductInventory(
  productId: string,
  inventoryItemId: string | null,
  delta: number
): Promise<{ beforeStock: number; afterStock: number }> {
  const dbProduct = await prisma.product.findUnique({
    where: { id: productId },
    include: { inventory: true }
  });

  const beforeStock = dbProduct?.inventory?.[0]?.stockQuantity ?? 0;
  let afterStock = Math.max(0, beforeStock + delta);

  if (inventoryItemId) {
    try {
      const { adjustInventoryLevel, fetchLocations } = await import('@/lib/shopify-admin');
      const locations = await fetchLocations();
      const activeLocation = locations.find((l: any) => l.active) || locations[0];
      const locationId = activeLocation ? String(activeLocation.id) : null;

      if (locationId) {
        const updatedLevel = await adjustInventoryLevel(inventoryItemId, locationId, delta);
        afterStock = updatedLevel.available ?? afterStock;
      }
    } catch (shopifyErr) {
      console.error(`[SkuService] Shopify inventory adjust error for product ${productId} (inv_item=${inventoryItemId}):`, shopifyErr);
    }

    // Sync local inventory
    const localInv = dbProduct?.inventory?.[0];
    if (localInv) {
      await prisma.inventory.update({
        where: { id: localInv.id },
        data: { stockQuantity: afterStock }
      });
    }
  } else {
    console.warn(`[SkuService] No inventoryItemId available for product ${productId}. Shopify inventory NOT adjusted.`);
  }

  return { beforeStock, afterStock };
}

/**
 * Create a ScanRecord for audit trail.
 */
async function createScanRecord(params: {
  productId: string;
  productTitle: string;
  variantInfo: string;
  sku: string;
  actionType: string;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  staffName?: string;
}): Promise<void> {
  try {
    await prisma.scanRecord.create({
      data: {
        productId: params.productId,
        productTitle: params.productTitle,
        variantInfo: params.variantInfo,
        sku: params.sku,
        actionType: params.actionType,
        quantity: params.quantity,
        beforeStock: params.beforeStock,
        afterStock: params.afterStock,
        locationId: 'LOCAL',
        staffName: params.staffName || 'System (Auto)'
      }
    });
  } catch (err) {
    console.error(`[SkuService] ScanRecord creation error:`, err);
  }
}

/**
 * Mark a SKU to a specific status WITHOUT restocking inventory.
 * Used for intermediate states like RETURNED, EXCHANGED.
 */
export async function markSkuStatus(
  sku: string,
  newStatus: string,
  actionType: string,
  staffName?: string
): Promise<boolean> {
  if (!isCustomSku(sku)) return false;

  const skuRec = await findSkuRecord(sku);
  if (!skuRec) {
    console.warn(`[SkuService] SKU ${sku} not found in product_skus for status=${newStatus}`);
    return false;
  }

  await updateSkuStatus(skuRec.id, newStatus, 0);

  const dbProduct = await prisma.product.findUnique({
    where: { id: skuRec.product_id },
    include: { inventory: true }
  });

  const currentStock = dbProduct?.inventory?.[0]?.stockQuantity ?? 0;

  await createScanRecord({
    productId: skuRec.product_id,
    productTitle: dbProduct?.title || 'Unknown Product',
    variantInfo: `Size ${skuRec.size}`,
    sku: skuRec.sku,
    actionType,
    quantity: 1,
    beforeStock: currentStock,
    afterStock: currentStock, // No inventory change for status-only updates
    staffName
  });

  console.log(`[SkuService] SKU ${sku} → ${newStatus} (${actionType})`);
  return true;
}

/**
 * Restore a SKU to IN_STOCK and increment inventory by 1.
 * Uses the variant-specific inventory_item_id from the SKU record.
 * Used for cancellations, returns received, exchange QC passed, RTO.
 */
export async function restoreSkuToStock(
  sku: string,
  actionType: string,
  staffName?: string,
  opts?: { adjustShopify?: boolean }
): Promise<boolean> {
  if (!isCustomSku(sku)) return false;

  const skuRec = await findSkuRecord(sku);
  if (!skuRec) {
    console.warn(`[SkuService] SKU ${sku} not found in product_skus for restore`);
    return false;
  }

  // Already in stock — don't double-count
  if (skuRec.status === 'IN_STOCK') {
    console.warn(`[SkuService] SKU ${sku} is already IN_STOCK, skipping restore`);
    return false;
  }

  await updateSkuStatus(skuRec.id, 'IN_STOCK', 1);

  // Resolve the variant-specific inventory_item_id
  const variantInvItemId = await resolveVariantInventoryItemId(skuRec);

  const dbProduct = await prisma.product.findUnique({
    where: { id: skuRec.product_id },
    include: { inventory: true }
  });

  const adjustShopify = opts?.adjustShopify !== false;
  const { beforeStock, afterStock } = adjustShopify
    ? await adjustProductInventory(skuRec.product_id, variantInvItemId, +1)
    : {
        beforeStock: dbProduct?.inventory?.[0]?.stockQuantity ?? 0,
        afterStock: dbProduct?.inventory?.[0]?.stockQuantity ?? 0,
      };

  await createScanRecord({
    productId: skuRec.product_id,
    productTitle: dbProduct?.title || 'Unknown Product',
    variantInfo: `Size ${skuRec.size}`,
    sku: skuRec.sku,
    actionType,
    quantity: 1,
    beforeStock,
    afterStock,
    staffName
  });

  console.log(`[SkuService] SKU ${sku} restored to IN_STOCK (+1 inventory, inv_item=${variantInvItemId}) via ${actionType}`);
  return true;
}

/**
 * Restore all custom SKUs assigned to an order's items.
 * Used for order cancellation and RTO.
 */
export async function restoreOrderSkus(
  orderId: string,
  actionType: string,
  staffName?: string,
  opts?: { adjustShopify?: boolean }
): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true }
  });

  if (!order) {
    console.error(`[SkuService] Order ${orderId} not found for SKU restoration`);
    return 0;
  }

  let restoredCount = 0;

  for (const item of order.items) {
    if (item.sku && isCustomSku(item.sku)) {
      const restored = await restoreSkuToStock(item.sku, actionType, staffName, opts);
      if (restored) restoredCount++;
    }
  }

  console.log(`[SkuService] Restored ${restoredCount} SKUs for order ${orderId} (${actionType})`);
  return restoredCount;
}

