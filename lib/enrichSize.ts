import prisma from "@/lib/db";
import { extractItemVariantAndSize } from "@/lib/utils";

/**
 * Extracts size from an item using size property or SKU/title regex.
 */
export function extractSize(orderItem: any): string {
  if (orderItem?.size) return orderItem.size.toString().trim().toUpperCase();
  if (orderItem?.originalSize) return orderItem.originalSize.toString().trim().toUpperCase();
  if (orderItem?.newSize) return orderItem.newSize.toString().trim().toUpperCase();

  const vInfo = extractItemVariantAndSize(
    orderItem?.title || orderItem?.product?.title || orderItem?.originalProduct?.title || orderItem?.newProduct?.title,
    orderItem?.sku || orderItem?.product?.sku || orderItem?.originalProduct?.sku || orderItem?.newProduct?.sku,
    orderItem?.variantTitle || orderItem?.originalVariantTitle || orderItem?.newVariantTitle,
    orderItem?.size
  );
  return vInfo.size || "";
}

/**
 * Batched enrichment for an array of line items.
 * Replaces N+1 sequential database queries per item with <= 3 batched queries total.
 */
export async function enrichItemsWithSize(rawItems: any[], parentOrder?: any) {
  if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) return [];

  // 1. Initial pass: extract in-memory sizes and identify what needs DB resolution
  const itemsMeta = rawItems.map((item) => {
    if (!item) return { item, size: null, sku: null, variantTitle: null, productId: null, orderId: null };
    const size = extractSize(item);
    const variantTitle = item.variantTitle || item.originalVariantTitle || item.newVariantTitle || null;
    const sku = item.sku || item.product?.sku || item.originalProduct?.sku || item.newProduct?.sku || null;
    const productId = item.productId || item.product?.id || item.originalProductId || item.newProductId;
    const orderId = item.orderId || parentOrder?.id;
    return { item, size, sku, variantTitle, productId, orderId };
  });

  // Fast path: if all items already have size and sku, resolve in-memory with 0 queries
  const allResolved = itemsMeta.every((m) => !m.item || (m.size && m.sku));
  if (allResolved) {
    return itemsMeta.map((m) => {
      if (!m.item) return m.item;
      return {
        ...m.item,
        sku: m.sku,
        size: m.size,
        variantTitle: m.variantTitle || (m.size ? `Size: ${m.size}` : null),
      };
    });
  }

  // 2. Batched WebStoreOrder lookup (single query for parent order)
  let webOrder: any = null;
  const needsWebOrder = itemsMeta.some((m) => m.item && !m.size);
  if (needsWebOrder) {
    try {
      if (parentOrder?.razorpayOrderId) {
        webOrder = await prisma.webStoreOrder.findFirst({
          where: { razorpayOrderId: parentOrder.razorpayOrderId }
        });
      }
      if (!webOrder && (parentOrder?.internalOrderNumber || parentOrder?.shopifyOrderName)) {
        const orderNumSearch = (parentOrder.internalOrderNumber || parentOrder.shopifyOrderName || "").replace('#', '');
        if (orderNumSearch) {
          webOrder = await prisma.webStoreOrder.findFirst({
            where: { orderNumber: { contains: orderNumSearch, mode: 'insensitive' } }
          });
        }
      }
      if (!webOrder && parentOrder?.id) {
        const { isUuid } = await import('@/lib/is-uuid');
        webOrder = await prisma.webStoreOrder.findFirst({
          where: {
            OR: [
              { notes: { contains: `Local: ${parentOrder.id}` } },
              ...(isUuid(parentOrder.id) ? [{ id: parentOrder.id }] : []),
            ]
          }
        });
      }

      if (webOrder && Array.isArray(webOrder.items)) {
        itemsMeta.forEach((m) => {
          if (!m.item || m.size) return;
          const itemTitleUpper = (m.item.title || m.item.product?.title || '').trim().toUpperCase();
          const matchedWebItem: any = (webOrder.items as any[]).find((wItem: any) => {
            const wTitleUpper = (wItem.title || '').trim().toUpperCase();
            return wTitleUpper === itemTitleUpper ||
              (wItem.product_id && (wItem.product_id === m.productId || wItem.product_id === m.item.shopifyProductId)) ||
              (wItem.price && Number(wItem.price) === Number(m.item.price));
          });
          if (matchedWebItem && matchedWebItem.size) {
            m.size = matchedWebItem.size.toString().trim().toUpperCase();
            if (!m.variantTitle) {
              m.variantTitle = `Size: ${m.size}`;
            }
          }
        });
      }
    } catch (_) {}
  }

  // 3. Batched product_skus lookup by SKU for items still missing size
  const skusToLookup = Array.from(new Set(
    itemsMeta
      .filter((m) => m.item && !m.size && m.sku)
      .map((m) => m.sku!.trim().toUpperCase())
  ));

  const skuToSizeMap = new Map<string, string>();
  if (skusToLookup.length > 0) {
    try {
      const skuRecs: any[] = await prisma.$queryRawUnsafe(
        `SELECT UPPER(sku) as sku_upper, size FROM product_skus WHERE UPPER(sku) = ANY($1) AND size IS NOT NULL AND size != ''`,
        skusToLookup
      );
      if (Array.isArray(skuRecs)) {
        skuRecs.forEach((r) => {
          if (r.sku_upper && r.size && !skuToSizeMap.has(r.sku_upper)) {
            skuToSizeMap.set(r.sku_upper, r.size.trim().toUpperCase());
          }
        });
      }
    } catch (_) {}
  }

  itemsMeta.forEach((m) => {
    if (m.item && !m.size && m.sku) {
      const foundSize = skuToSizeMap.get(m.sku.trim().toUpperCase());
      if (foundSize) m.size = foundSize;
    }
  });

  // 4. Batched product_skus lookup by Product ID for items still missing size
  const prodIdsToLookupSize = Array.from(new Set(
    itemsMeta
      .filter((m) => m.item && !m.size && m.productId)
      .map((m) => String(m.productId))
  ));

  const prodIdToSizeMap = new Map<string, string>();
  if (prodIdsToLookupSize.length > 0) {
    try {
      const prodSkuRecs: any[] = await prisma.$queryRawUnsafe(
        `SELECT product_id, size FROM product_skus WHERE product_id = ANY($1) AND size IS NOT NULL AND size != ''`,
        prodIdsToLookupSize
      );
      if (Array.isArray(prodSkuRecs)) {
        prodSkuRecs.forEach((r) => {
          if (r.product_id && r.size && !prodIdToSizeMap.has(String(r.product_id))) {
            prodIdToSizeMap.set(String(r.product_id), r.size.trim().toUpperCase());
          }
        });
      }
    } catch (_) {}
  }

  itemsMeta.forEach((m) => {
    if (m.item && !m.size && m.productId) {
      const foundSize = prodIdToSizeMap.get(String(m.productId));
      if (foundSize) m.size = foundSize;
    }
  });

  // 5. Batched SKU resolution for items missing SKU but having productId
  const prodIdsToLookupSku = Array.from(new Set(
    itemsMeta
      .filter((m) => m.item && !m.sku && m.productId)
      .map((m) => String(m.productId))
  ));

  const prodIdAndSizeToSkuMap = new Map<string, string>();
  const prodIdFallbackSkuMap = new Map<string, string>();
  if (prodIdsToLookupSku.length > 0) {
    try {
      const skuRecs: any[] = await prisma.$queryRawUnsafe(
        `SELECT product_id, UPPER(size) as size_upper, sku FROM product_skus WHERE product_id = ANY($1) AND sku IS NOT NULL AND sku != ''`,
        prodIdsToLookupSku
      );
      if (Array.isArray(skuRecs)) {
        skuRecs.forEach((r) => {
          const pid = String(r.product_id);
          if (r.size_upper) {
            prodIdAndSizeToSkuMap.set(`${pid}:${r.size_upper}`, r.sku);
          }
          if (!prodIdFallbackSkuMap.has(pid)) {
            prodIdFallbackSkuMap.set(pid, r.sku);
          }
        });
      }
    } catch (_) {}
  }

  itemsMeta.forEach((m) => {
    if (m.item && !m.sku && m.productId) {
      const pid = String(m.productId);
      if (m.size) {
        const found = prodIdAndSizeToSkuMap.get(`${pid}:${m.size.trim().toUpperCase()}`);
        if (found) m.sku = found;
      }
      if (!m.sku) {
        const fallback = prodIdFallbackSkuMap.get(pid);
        if (fallback) m.sku = fallback;
      }
    }
  });

  // 6. Build final resolved item array
  return itemsMeta.map((m) => {
    if (!m.item) return m.item;
    const resolvedSize = m.size || null;
    const resolvedVariantTitle = m.variantTitle || (resolvedSize ? `Size: ${resolvedSize}` : null);
    return {
      ...m.item,
      sku: m.sku || null,
      size: resolvedSize,
      variantTitle: resolvedVariantTitle,
    };
  });
}

/**
 * Enriches a single item by delegating to the batched enrichItemsWithSize logic.
 */
export async function enrichSingleItem(item: any, parentOrder?: any) {
  if (!item) return item;
  const [enriched] = await enrichItemsWithSize([item], parentOrder);
  return enriched || item;
}

/**
 * Enriches an exchange line item (both original and replacement products).
 */
export async function enrichExchangeItem(ex: any) {
  if (!ex) return ex;

  const [origEnriched] = await enrichItemsWithSize([{
    title: ex.originalProduct?.title,
    sku: ex.originalSku || ex.originalProduct?.sku,
    productId: ex.originalProductId,
    size: ex.originalSize,
    variantTitle: ex.originalVariantTitle,
    orderId: ex.orderId,
  }], ex.order);

  const [newEnriched] = await enrichItemsWithSize([{
    title: ex.newProduct?.title,
    sku: ex.newSku || ex.newProduct?.sku,
    productId: ex.newProductId,
    size: ex.newSize,
    variantTitle: ex.newVariantTitle,
    orderId: ex.orderId,
  }], ex.order);

  return {
    ...ex,
    originalSku: origEnriched?.sku || null,
    originalSize: origEnriched?.size || null,
    originalVariant: origEnriched?.variantTitle || (origEnriched?.size ? `Size: ${origEnriched.size}` : null),
    originalVariantTitle: origEnriched?.variantTitle || null,
    newSku: newEnriched?.sku || null,
    newSize: newEnriched?.size || null,
    newVariant: newEnriched?.variantTitle || (newEnriched?.size ? `Size: ${newEnriched.size}` : null),
    newVariantTitle: newEnriched?.variantTitle || null,
  };
}
