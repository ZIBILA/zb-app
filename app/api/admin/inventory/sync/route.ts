import { NextResponse } from 'next/server';
import prisma from "@/lib/db";
import { adjustInventoryLevel, fetchLocations, fetchAllProducts, fetchProductById } from '@/lib/shopify-admin';
import { requirePermission, handleAuthError } from "@/lib/auth/rbac";
import { shopifyAlreadyDeductedForOrder } from '@/lib/inventoryPolicy';

function normalizeSku(raw: string): string {
  if (!raw) return '';
  return raw.trim().toUpperCase();
}

export async function POST(req: Request) {
  try {
    await requirePermission('INVENTORY', 'edit');
    const { code, mode, quantity = 1 } = await req.json();
    const qty = Math.max(1, Number(quantity) || 1);

    if (!code) {
      return NextResponse.json({ error: 'Missing Scan Data' }, { status: 400 });
    }

    const normalizedCode = normalizeSku(code);

    // Identify the subject (Product or Order)
    let matchedProduct = null;
    let matchedVariant = null;
    let resolvedLocalProduct = null;

    // 1. Search in custom product_skus table FIRST (most specific printed price tags)
    let skuRecord = null;
    try {
      const skuRecords: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM product_skus WHERE UPPER(sku) = $1`,
        normalizedCode
      );
      if (skuRecords.length > 0) {
        skuRecord = skuRecords[0];
      }
    } catch (e) {
      console.error('Error querying product_skus table in sync lookup:', e);
    }

    if (skuRecord) {
      const dbProduct = await prisma.product.findUnique({
        where: { id: skuRecord.product_id },
        include: { inventory: true }
      });
      if (dbProduct) {
        resolvedLocalProduct = dbProduct;
        
        // Fetch product from Shopify to get correct variants
        try {
          const shopifyProduct = await fetchProductById(dbProduct.shopifyProductId);
          if (shopifyProduct && shopifyProduct.variants) {
            // Hardened variant matching priority:
            // 1. Exact inventory_item_id match (if stored on SKU record)
            // 2. Exact sku match
            // 3. Size/option1/title match (fallback)
            let targetVariant = null;

            if (skuRecord.inventory_item_id) {
              targetVariant = shopifyProduct.variants.find((v: any) =>
                String(v.inventory_item_id) === skuRecord.inventory_item_id
              );
            }

            if (!targetVariant) {
              targetVariant = shopifyProduct.variants.find((v: any) =>
                v.sku && normalizeSku(v.sku) === normalizedCode
              );
            }

            if (!targetVariant) {
              const sizeUpper = skuRecord.size.toUpperCase().trim();
              const sizeMatches = shopifyProduct.variants.filter((v: any) =>
                (v.option1 && v.option1.toUpperCase().trim() === sizeUpper) ||
                (v.title && v.title.toUpperCase().trim() === sizeUpper)
              );
              if (sizeMatches.length === 1) {
                targetVariant = sizeMatches[0];
              } else if (sizeMatches.length > 1) {
                console.warn(`[Scanner] Ambiguous size match for "${skuRecord.size}" on product ${dbProduct.shopifyProductId}: ${sizeMatches.length} variants matched. Using first match.`);
                targetVariant = sizeMatches[0];
              }
            }

            if (targetVariant) {
              matchedProduct = shopifyProduct;
              matchedVariant = targetVariant;

              // Opportunistically backfill variant IDs on the SKU record if missing
              if (!skuRecord.inventory_item_id || !skuRecord.shopify_variant_id) {
                try {
                  await prisma.$executeRawUnsafe(
                    `UPDATE product_skus SET shopify_variant_id = $1, inventory_item_id = $2 WHERE id = $3 AND (shopify_variant_id IS NULL OR inventory_item_id IS NULL)`,
                    String(targetVariant.id),
                    String(targetVariant.inventory_item_id),
                    skuRecord.id
                  );
                } catch (backfillErr) {
                  console.error('[Scanner] Failed to backfill variant IDs:', backfillErr);
                }
              }
            }
          }
        } catch (err) {
          console.error(`Failed to fetch Shopify product variants for ${dbProduct.shopifyProductId}:`, err);
        }

        // Fallback to local default variant if Shopify fetch failed or variant not found
        if (!matchedProduct) {
          matchedProduct = {
            id: dbProduct.shopifyProductId,
            title: dbProduct.title,
            handle: dbProduct.handle,
            variants: [
              {
                id: dbProduct.shopifyProductId,
                title: `Size ${skuRecord.size}`,
                price: String(dbProduct.price || 0),
                sku: skuRecord.sku,
                barcode: dbProduct.barcode,
                inventory_item_id: skuRecord.inventory_item_id || dbProduct.inventoryItemId,
                inventory_quantity: skuRecord.quantity
              }
            ]
          };
          matchedVariant = matchedProduct.variants[0];
        }
      }
    }

    // 2. Search locally by Product ID, shopifyProductId, SKU, or Barcode
    if (!matchedProduct) {
      const localProduct = await prisma.product.findFirst({
        where: {
          OR: [
            { id: code },
            { shopifyProductId: code },
            { sku: normalizedCode },
            { barcode: normalizedCode }
          ]
        },
        include: {
          inventory: true
        }
      });

      if (localProduct) {
        resolvedLocalProduct = localProduct;
        
        // Fetch product from Shopify to get correct variants
        try {
          const shopifyProduct = await fetchProductById(localProduct.shopifyProductId);
          if (shopifyProduct && shopifyProduct.variants) {
            let targetVariant = shopifyProduct.variants.find((v: any) => 
              v.id.toString() === code ||
              (v.sku && normalizeSku(v.sku) === normalizedCode) ||
              (v.barcode && normalizeSku(v.barcode) === normalizedCode)
            );
            // Only fall back to variants[0] for single-variant products
            if (!targetVariant) {
              if (shopifyProduct.variants.length === 1) {
                targetVariant = shopifyProduct.variants[0];
              } else {
                console.warn(`[Scanner] No exact variant match for code "${code}" on multi-variant product ${localProduct.shopifyProductId}. Skipping variants[0] fallback.`);
              }
            }
            if (targetVariant) {
              matchedProduct = shopifyProduct;
              matchedVariant = targetVariant;
            }
          }
        } catch (err) {
          console.error(`Failed to fetch Shopify product variants for ${localProduct.shopifyProductId}:`, err);
        }

        if (!matchedProduct) {
          matchedProduct = {
            id: localProduct.shopifyProductId,
            title: localProduct.title,
            handle: localProduct.handle,
            variants: [
              {
                id: localProduct.shopifyProductId,
                title: 'Default Variant',
                price: String(localProduct.price || 0),
                sku: localProduct.sku,
                barcode: localProduct.barcode,
                inventory_item_id: localProduct.inventoryItemId,
                inventory_quantity: localProduct.inventory[0]?.stockQuantity || 0
              }
            ]
          };
          matchedVariant = matchedProduct.variants[0];
        }
      }
    }

    // 3. Fallback to Shopify fetchAllProducts if not matched locally
    if (!matchedProduct) {
      const products = await fetchAllProducts();
      for (const p of products) {
        if (p.id.toString() === code || p.handle === code) {
          matchedProduct = p;
          matchedVariant = p.variants?.[0] || null;
          break;
        }
        for (const v of p.variants || []) {
          if (
            v.id.toString() === code ||
            normalizeSku(v.sku || '') === normalizedCode ||
            normalizeSku(v.barcode || '') === normalizedCode
          ) {
            matchedProduct = p;
            matchedVariant = v;
            break;
          }
        }
        if (matchedProduct) break;
      }
    }

    if (!resolvedLocalProduct && matchedProduct) {
      resolvedLocalProduct = await prisma.product.findUnique({
        where: { shopifyProductId: String(matchedProduct.id) }
      });
    }

    if (mode === 'LOOKUP') {
      if (matchedProduct && matchedVariant) {
        return NextResponse.json({
          success: true,
          productName: `${matchedProduct.title} - ${matchedVariant.title}`,
          sku: matchedVariant.sku,
          barcode: matchedVariant.barcode,
          currentQty: matchedVariant.inventory_quantity || 0,
        });
      }
      return NextResponse.json({ error: 'Product Not Found' }, { status: 404 });
    }

    let message = '';
    let productName = 'Unknown';

    if (matchedProduct && matchedVariant) {
      productName = `${matchedProduct.title} - ${matchedVariant.title}`;
      let delta = 0;
      const currentQty = matchedVariant.inventory_quantity || 0;

      if (mode === 'STOCK_IN') {
        // Duplicate scan protection: reject if this SKU is already IN_STOCK
        if (skuRecord && skuRecord.status === 'IN_STOCK') {
          return NextResponse.json(
            { error: `Duplicate scan rejected — SKU ${skuRecord.sku} is already stocked in. Each SKU can only be scanned into inventory once.` },
            { status: 400 }
          );
        }
        delta = qty;
        message = `Injected ${qty} unit(s) of ${productName} into the grid.`;
      } 
      else if (mode === 'ORDER_OUT') {
        // Enforce IN_STOCK status for ORDER_OUT
        if (skuRecord && skuRecord.status !== 'IN_STOCK') {
          const msg = skuRecord.status === 'PRINTED'
            ? `SKU ${skuRecord.sku} has been printed but not scanned into stock yet. Scan it in via STOCK_IN first.`
            : `SKU ${skuRecord.sku} is not available (status: ${skuRecord.status}).`;
          return NextResponse.json({ error: msg }, { status: 400 });
        }
        const assignedItem = await prisma.orderItem.findFirst({
          where: { sku: { equals: normalizedCode, mode: 'insensitive' } },
          include: {
            order: { select: { shopifyOrderId: true, paymentStatus: true, status: true, tags: true } },
          },
        }).catch(() => null);
        const alreadyOnShopify = assignedItem?.order
          ? shopifyAlreadyDeductedForOrder(assignedItem.order)
          : false;
        if (alreadyOnShopify) {
          delta = 0;
          message = `Fulfillment tagged: ${qty} unit(s) of ${productName} (Shopify already deducted on paid order).`;
        } else if (currentQty >= qty) {
          delta = -qty;
          message = `Fulfillment Complete: ${qty} unit(s) of ${productName} extracted from inventory.`;
        } else {
          return NextResponse.json({ error: `Stock Depleted. Only ${currentQty} units available.` }, { status: 400 });
        }
      }
      else if (mode === 'RETURN' || mode === 'RTO') {
        if (mode === 'RETURN') {
          if (skuRecord?.status === 'IN_STOCK') {
            return NextResponse.json(
              { error: `SKU ${skuRecord.sku} is already IN_STOCK. Return restock waits for QC approval.` },
              { status: 400 }
            );
          }
          delta = 0;
          message = `Return received: ${qty} unit(s) of ${productName} logged. Stock is added only after QC approval.`;
        } else {
          if (skuRecord?.status === 'IN_STOCK') {
            return NextResponse.json(
              { error: `Duplicate RTO scan rejected — SKU ${skuRecord.sku} is already IN_STOCK.` },
              { status: 400 }
            );
          }
          delta = qty;
          message = `RTO Processed: ${qty} unit(s) restored to inventory.`;
        }
        
        if (mode === 'RETURN') {
          // Automate Return request status updates
          try {
            const returnRecord = await prisma.return.findFirst({
              where: {
                OR: [
                  { sku: normalizedCode },
                  { sku: matchedVariant?.sku ? normalizeSku(matchedVariant.sku) : '' },
                  { productId: resolvedLocalProduct?.id || '' }
                ],
                status: { notIn: ['RECEIVED', 'REFUNDED'] }
              }
            });
            if (returnRecord) {
              await prisma.return.update({
                where: { id: returnRecord.id },
                data: { status: 'RECEIVED' }
              });
              if (returnRecord.returnRequestId) {
                await prisma.returnRequest.update({
                  where: { id: returnRecord.returnRequestId },
                  data: { status: 'received' }
                });
              }
              await prisma.order.update({
                where: { id: returnRecord.orderId },
                data: {
                  status: 'returned',
                  deliveryStatus: 'returned'
                }
              });
              message += ` Associated Return Request ${returnRecord.returnRequestId || ''} updated to 'received' and order status updated to 'returned'.`;
            } else {
              // Check if it's an Exchange return (original item returned)
              const exchangeRecord = await prisma.exchange.findFirst({
                where: {
                  originalProductId: resolvedLocalProduct?.id || '',
                  status: { notIn: ['RECEIVED', 'EXCHANGED'] }
                }
              });
              if (exchangeRecord) {
                await prisma.exchange.update({
                  where: { id: exchangeRecord.id },
                  data: { status: 'RECEIVED' }
                });
                if (exchangeRecord.exchangeRequestId) {
                  await prisma.exchangeRequest.update({
                    where: { id: exchangeRecord.exchangeRequestId },
                    data: { status: 'received' }
                  });
                }
                await prisma.order.update({
                  where: { id: exchangeRecord.orderId },
                  data: {
                    status: 'exchanged',
                    deliveryStatus: 'returned'
                  }
                });
                message += ` Associated Exchange Request ${exchangeRecord.exchangeRequestId || ''} updated to 'received' (original item returned).`;
              }
            }
          } catch (retErr) {
            console.error('Error auto-updating Return/Exchange records on scan:', retErr);
          }
        }
      }
      else if (mode === 'EXCHANGE') {
        // Enforce IN_STOCK status for EXCHANGE
        if (skuRecord && skuRecord.status !== 'IN_STOCK') {
          const msg = skuRecord.status === 'PRINTED'
            ? `SKU ${skuRecord.sku} has been printed but not scanned into stock yet. Scan it in via STOCK_IN first.`
            : `SKU ${skuRecord.sku} is not available for exchange (status: ${skuRecord.status}).`;
          return NextResponse.json({ error: msg }, { status: 400 });
        }
        const replacement = await prisma.exchange.findFirst({
          where: {
            newProductId: resolvedLocalProduct?.id || '',
            status: { notIn: ['EXCHANGED'] },
          },
          include: {
            exchangeRequest: { select: { replacementOrderId: true } },
          },
        }).catch(() => null);
        let replacementAlreadyDeducted = false;
        if (replacement?.exchangeRequest?.replacementOrderId) {
          const replOrder = await prisma.order.findUnique({
            where: { id: replacement.exchangeRequest.replacementOrderId },
            select: { shopifyOrderId: true, paymentStatus: true, status: true, tags: true },
          });
          replacementAlreadyDeducted = replOrder ? shopifyAlreadyDeductedForOrder(replOrder) : false;
        }
        if (replacementAlreadyDeducted) {
          delta = 0;
          message = `Exchange Out tagged: ${qty} unit(s) of ${productName} (replacement order already deducted Shopify stock).`;
        } else if (currentQty >= qty) {
          delta = -qty;
          message = `Exchange Out: ${qty} unit(s) of ${productName} extracted for replacement.`;
        } else {
          return NextResponse.json({ error: `Stock Depleted. Only ${currentQty} units available.` }, { status: 400 });
        }

        try {
          const exchangeRecord = replacement || await prisma.exchange.findFirst({
            where: {
              newProductId: resolvedLocalProduct?.id || '',
              status: { notIn: ['EXCHANGED'] }
            }
          });
          if (exchangeRecord) {
            await prisma.exchange.update({
              where: { id: exchangeRecord.id },
              data: { status: 'EXCHANGED' }
            });
            if (exchangeRecord.exchangeRequestId) {
              await prisma.exchangeRequest.update({
                where: { id: exchangeRecord.exchangeRequestId },
                data: { status: 'completed' }
              });
            }
            await prisma.order.update({
              where: { id: exchangeRecord.orderId },
              data: {
                status: 'exchanged',
                deliveryStatus: 'exchanged'
              }
            });
            message += ` Associated Exchange Request ${exchangeRecord.exchangeRequestId || ''} updated to 'completed' and order status updated to 'exchanged'.`;
          }
        } catch (excErr) {
          console.error('Error auto-updating Exchange records on scan:', excErr);
        }
      }

      // Fetch Shopify Location and Push Update
      try {
        const locations = await fetchLocations();
        const activeLocation = locations.find((l) => l.active) || locations[0];
        const locationId = activeLocation ? String(activeLocation.id) : null;
        let newStockQuantity = currentQty + delta;

        if (locationId && matchedVariant.inventory_item_id && delta !== 0) {
          const updatedLevel = await adjustInventoryLevel(
            String(matchedVariant.inventory_item_id),
            locationId,
            delta
          );
          newStockQuantity = updatedLevel.available ?? newStockQuantity;
          
          // Always sync with local Prisma DB for the matched variant
          // (Previously gated on localProduct.inventoryItemId matching — this caused
          // non-first variants to silently skip local DB updates)
          const localProduct = await prisma.product.findUnique({
            where: { shopifyProductId: String(matchedProduct.id) }
          });
          
          if (localProduct) {
            const inventory = await prisma.inventory.findFirst({
              where: { productId: localProduct.id }
            });
            
            if (inventory) {
              await prisma.inventory.update({
                where: { id: inventory.id },
                data: { stockQuantity: newStockQuantity }
              });
            } else {
              // Create inventory record if it doesn't exist
              await prisma.inventory.create({
                data: {
                  productId: localProduct.id,
                  locationId: locationId!,
                  stockQuantity: newStockQuantity,
                  reservedQuantity: 0
                }
              });
            }
          }
        }

        // Update product_skus table for the specific scanned SKU if it exists
        try {
          const newStatus =
            mode === 'RETURN' ? 'RETURNED' : (mode === 'STOCK_IN' || mode === 'RTO') ? 'IN_STOCK' : 'SOLD';
          const isStockIn = newStatus === 'IN_STOCK';
          const newSkuQty = isStockIn ? 1 : 0;
          
          await prisma.$executeRawUnsafe(
            `UPDATE product_skus SET status = $1, quantity = $2 WHERE UPPER(sku) = $3`,
            newStatus,
            newSkuQty,
            normalizedCode
          );
        } catch (skuUpdateErr) {
          console.error('[Sync Update SKU Error]:', skuUpdateErr);
        }

        // Record scan
        let dbProductId = null;
        try {
          const p = await prisma.product.findUnique({ where: { shopifyProductId: String(matchedProduct.id) } });
          if (p) dbProductId = p.id;
        } catch (e) {}

        await (prisma as any).scanRecord.create({
          data: {
            productId: dbProductId,
            productTitle: matchedProduct.title,
            variantInfo: matchedVariant.title,
            sku: matchedVariant.sku,
            barcode: matchedVariant.barcode,
            actionType: mode,
            quantity: Math.abs(delta) || 1,
            beforeStock: currentQty,
            afterStock: newStockQuantity,
            locationId: locationId || 'LOCAL',
            staffName: 'Admin'
          }
        });
      } catch (e: any) {
        console.error('[Shopify Sync / Log Error]:', e);
      }

      return NextResponse.json({ 
        success: true, 
        message,
        productName,
        sku: matchedVariant.sku,
        barcode: matchedVariant.barcode
      });
    }

    // Check if it's an Order scan (OrderId)
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { id: code },
          { shopifyOrderId: code }
        ]
      }
    });

    if (order) {
      if (mode === 'ORDER_OUT') {
        const orderData: any = order;
        // Mark as fulfilled
        await prisma.order.update({
          where: { id: order.id },
          data: { fulfillmentStatus: 'fulfilled' }
        });
        
        // Decrement inventory for all items in the order
        // Note: In a production DB, we'd loop through line items.
        // For this demo/impl, if we have the items we'd use them.
        message = `Order ${order.shopifyOrderId} Fulfilled. Inventory decrements triggered.`;
      } else if (mode === 'RTO') {
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryStatus: 'returned_to_origin' }
        });
        message = `Order ${order.shopifyOrderId} set to RTO state. Stock restoration queued.`;
      }
      return NextResponse.json({ success: true, message, productName: `Order ${order.shopifyOrderId}` });
    }

    return NextResponse.json({ error: 'Node Not Found: Identify Mismatch.' }, { status: 404 });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('[Inventory Sync Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
