import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { fetchProductById } from '@/lib/shopify-admin';
import { extractItemVariantAndSize } from '@/lib/utils';
import { enrichItemsWithSize, extractSize } from '@/lib/enrichSize';

/**
 * Resolve the variant-specific inventory_item_id for a product_skus record.
 * Priority: 1) from skuRec column, 2) live Shopify lookup by size, 3) Product.inventoryItemId fallback.
 */
async function resolveSkuInventoryItemId(skuRec: any): Promise<{ inventoryItemId: string | null; variantId: string | null }> {
  // 1. Direct from SKU record
  if (skuRec.inventory_item_id) {
    return { inventoryItemId: skuRec.inventory_item_id, variantId: skuRec.shopify_variant_id || null };
  }

  // 2. Live Shopify lookup
  try {
    const dbProduct = await prisma.product.findUnique({ where: { id: skuRec.product_id } });
    if (dbProduct) {
      const shopifyProduct = await fetchProductById(dbProduct.shopifyProductId);
      if (shopifyProduct?.variants) {
        const sizeUpper = (skuRec.size || '').toUpperCase().trim();
        const matched = shopifyProduct.variants.find((v: any) =>
          (v.option1 && v.option1.toUpperCase().trim() === sizeUpper) ||
          (v.title && v.title.toUpperCase().trim() === sizeUpper)
        );
        if (matched) {
          const invItemId = String(matched.inventory_item_id);
          const varId = String(matched.id);
          // Opportunistic backfill
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE product_skus SET shopify_variant_id = $1, inventory_item_id = $2 WHERE id = $3`,
              varId, invItemId, skuRec.id
            );
          } catch (_) {}
          return { inventoryItemId: invItemId, variantId: varId };
        }
      }
      // 3. Fallback to product-level
      if (dbProduct.inventoryItemId) {
        console.warn(`[Order Patch] Using product-level inventoryItemId for SKU ${skuRec.sku} — may adjust wrong variant`);
        return { inventoryItemId: dbProduct.inventoryItemId, variantId: null };
      }
    }
  } catch (e) {
    console.error(`[Order Patch] Error resolving variant for SKU ${skuRec.sku}:`, e);
  }
  return { inventoryItemId: null, variantId: null };
}

// Using shared enrichItemsWithSize and extractSize from @/lib/enrichSize

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    let order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        items: true,
        shipments: {
          orderBy: { createdAt: 'desc' }
        },
        payments: true,
        cartSession: true,
      },
    });

    if (!order) {
      // Check if it's a mobile order
      const mobileOrder = await prisma.mobileOrder.findUnique({
        where: { id },
        include: {
          customer: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });

      if (mobileOrder) {
        // If the mobile order is already synced, try to find the synced Order
        if (mobileOrder.shopifyOrderId) {
          const syncedOrder = await prisma.order.findFirst({
            where: { shopifyOrderId: mobileOrder.shopifyOrderId },
            include: {
              customer: true,
              items: true,
              shipments: {
                orderBy: { createdAt: 'desc' }
              },
              payments: true,
              cartSession: true,
            }
          });
          if (syncedOrder) {
            const enrichedSyncedItems = await enrichItemsWithSize(syncedOrder.items);
            return NextResponse.json({ success: true, order: { ...syncedOrder, items: enrichedSyncedItems } });
          }
        }

        // Format the unsynced MobileOrder to match OrderDetail schema
        const enrichedMobileItems = await enrichItemsWithSize(
          mobileOrder.items.map((item: any) => ({
            id: item.id,
            orderId: item.mobileOrderId,
            productId: item.productId,
            variantId: item.variantId,
            title: item.title,
            quantity: item.quantity,
            price: item.price,
            sku: item.sku,
            image: item.image || item.product?.featuredImage || null,
          }))
        );

        const mappedOrder = {
          id: mobileOrder.id,
          shopId: mobileOrder.customer.shopId,
          shopifyOrderId: mobileOrder.shopifyOrderId,
          customerId: mobileOrder.customerId,
          status: mobileOrder.status,
          totalPrice: mobileOrder.totalPrice,
          subtotalPrice: mobileOrder.subtotalPrice || mobileOrder.totalPrice,
          totalTax: mobileOrder.totalTax || 0,
          currency: mobileOrder.currency,
          paymentStatus: mobileOrder.paymentStatus,
          fulfillmentStatus: mobileOrder.fulfillmentStatus,
          deliveryStatus: mobileOrder.deliveryStatus,
          shippingAddress: mobileOrder.shippingAddress,
          billingAddress: mobileOrder.billingAddress,
          note: mobileOrder.note,
          createdAt: mobileOrder.createdAt,
          updatedAt: mobileOrder.updatedAt,
          orderType: 'MOBILE',
          tags: mobileOrder.tags,
          aiRiskRecommendation: null,
          codConfirmationMethod: null,
          codConfirmationStatus: null,
          codConfirmedAt: null,
          paymentCapturedAt: null,
          paymentMethod: mobileOrder.paymentMethod,
          razorpayOrderId: null,
          razorpayPaymentId: mobileOrder.paymentId,
          rtoRiskFactors: null,
          rtoRiskScore: null,
          discountAmount: mobileOrder.discountAmount,
          discountCode: mobileOrder.discountCode,
          customer: mobileOrder.customer,
          items: enrichedMobileItems,
          payments: [],
          shipments: [],
          delhivery_awb: null,
          tracking_status: null,
          internalOrderNumber: mobileOrder.orderNumber,
          shopifyOrderName: mobileOrder.shopifyOrderId ? `#${mobileOrder.shopifyOrderId}` : null,
          shopifySyncStatus: mobileOrder.shopifyOrderId ? 'synced' : 'pending',
          shopifySyncError: null,
          refundStatus: 'not_applicable',
          refundError: null,
          refundAttempts: 0,
        };
        
        const mobDiscount = mappedOrder.discountAmount || 0;
        const mobSubtotal = mappedOrder.subtotalPrice || mappedOrder.totalPrice;
        if (mobDiscount > 0 && Math.abs(mappedOrder.totalPrice - mobSubtotal) < 0.01) {
          mappedOrder.totalPrice = mobSubtotal - mobDiscount;
        }
        
        return NextResponse.json({ success: true, order: mappedOrder });
      }
    }

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Match corresponding WebStoreOrder
    let webStoreOrder = null;
    if (order.razorpayOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { razorpayOrderId: order.razorpayOrderId }
      });
    }
    if (!webStoreOrder) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { notes: { contains: `Local: ${order.id}` } }
      });
    }
    if (!webStoreOrder && order.shopifyOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { notes: { contains: `Shopify: ${order.shopifyOrderId}` } }
      });
    }

    const enrichedItems = await enrichItemsWithSize(order.items, order);

    // Resolve effective payment method (checking order, webStoreOrder, tags, and note)
    const rawMethod = (webStoreOrder?.paymentMethod || order.paymentMethod || '').toLowerCase();
    const tagsLower = (order.tags || '').toLowerCase();
    const noteLower = (order.note || '').toLowerCase();
    const isCodOrder = rawMethod === 'cod' || tagsLower.includes('cod') || noteLower.includes('cod order') || noteLower.includes('upfront fee paid');
    const finalPaymentMethod = isCodOrder ? 'cod' : (webStoreOrder?.paymentMethod || order.paymentMethod || 'razorpay');

    let resolvedDiscountCode = webStoreOrder?.discountCode || order.discountCode || null;
    let resolvedDiscountAmount = webStoreOrder?.discountAmount ? Number(webStoreOrder.discountAmount) : (order.discountAmount || 0);

    // Strip prepaid discounts if order is COD
    if (isCodOrder && resolvedDiscountCode && resolvedDiscountCode.toUpperCase().includes('PREPAID')) {
      console.warn(`[Admin Order Detail API] Stripping prepaid discount ${resolvedDiscountCode} from COD order ${order.id}`);
      resolvedDiscountCode = null;
      resolvedDiscountAmount = 0;
    }

    let resolvedCodUpfrontPaid = webStoreOrder?.codUpfrontPaid ? Number(webStoreOrder.codUpfrontPaid) : 0;
    if (isCodOrder && resolvedCodUpfrontPaid === 0) {
      const pStat = (webStoreOrder?.paymentStatus || order.paymentStatus || '').toLowerCase();
      if (pStat === 'cod_upfront_paid' || pStat === 'paid') {
        resolvedCodUpfrontPaid = 99;
      }
    }

    // Enrich the order payload with correct webstore fields if available
    const enrichedOrder = {
      ...order,
      items: enrichedItems,
      codUpfrontPaid: resolvedCodUpfrontPaid,
      codUpfrontPaymentId: webStoreOrder?.codUpfrontPaymentId || order.razorpayPaymentId || null,
      discountCode: resolvedDiscountCode,
      discountAmount: resolvedDiscountAmount,
      shippingCharge: webStoreOrder?.shippingCharge ? Number(webStoreOrder.shippingCharge) : 0,
      razorpayOrderId: webStoreOrder?.razorpayOrderId || order.razorpayOrderId || null,
      razorpayPaymentId: webStoreOrder?.razorpayPaymentId || order.razorpayPaymentId || null,
      paymentMethod: finalPaymentMethod,
      paymentStatus: webStoreOrder?.paymentStatus || (isCodOrder && order.paymentStatus === 'paid' ? 'cod_upfront_paid' : order.paymentStatus),
    };

    return NextResponse.json({ success: true, order: enrichedOrder });
  } catch (error: any) {
    console.error('[Admin Order Detail API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();

    let isMobileOrder = false;
    let oldOrder = await prisma.order.findUnique({
      where: { id },
      select: { status: true, deliveryStatus: true, customerId: true, paymentStatus: true, internalOrderNumber: true, previousOrderNumbers: true, tags: true }
    });

    if (!oldOrder) {
      const oldMobileOrder = await prisma.mobileOrder.findUnique({
        where: { id },
        select: { status: true, deliveryStatus: true, customerId: true, paymentStatus: true, orderNumber: true, tags: true }
      });
      if (oldMobileOrder) {
        oldOrder = oldMobileOrder as any;
        isMobileOrder = true;
      }
    }

    if (!oldOrder) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Handle individual OrderItem SKU updates if provided
    if (body.items && Array.isArray(body.items)) {
      for (const item of body.items) {
        if (item.id && 'sku' in item) {
          // Fetch the OrderItem or MobileOrderItem to validate
          const orderItem = isMobileOrder
            ? await prisma.mobileOrderItem.findUnique({ where: { id: item.id } })
            : await prisma.orderItem.findUnique({ where: { id: item.id } });
          
          if (!orderItem) {
            return NextResponse.json({ success: false, error: 'Order item not found' }, { status: 404 });
          }

          const oldSku = orderItem.sku;
          const newSku = item.sku ? item.sku.trim() : '';

          // If changing SKU (restoring previous SKU or swapping)
          if (oldSku && oldSku.trim().toUpperCase() !== newSku.toUpperCase()) {
            const normalizedOldSku = oldSku.trim().toUpperCase();
            try {
              // Find if the old SKU exists in product_skus
              const oldSkuRecords: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM product_skus WHERE UPPER(sku) = $1`,
                normalizedOldSku
              );
              
              if (oldSkuRecords.length > 0) {
                const skuRec = oldSkuRecords[0];
                // Restore old SKU status to IN_STOCK and quantity to 1
                await prisma.$executeRawUnsafe(
                  `UPDATE product_skus SET status = 'IN_STOCK', quantity = 1 WHERE id = $1`,
                  skuRec.id
                );
                
                // Resolve variant-specific inventory_item_id
                const { inventoryItemId: variantInvItemId } = await resolveSkuInventoryItemId(skuRec);
                
                // Increment Shopify & local product inventory by 1
                const dbProduct = await prisma.product.findUnique({
                  where: { id: skuRec.product_id },
                  include: { inventory: true }
                });
                
                if (variantInvItemId) {
                  try {
                    const { adjustInventoryLevel, fetchLocations } = await import('@/lib/shopify-admin');
                    const locations = await fetchLocations();
                    const activeLocation = locations.find((l) => l.active) || locations[0];
                    const locationId = activeLocation ? String(activeLocation.id) : null;
                    
                    if (locationId) {
                      const updatedLevel = await adjustInventoryLevel(variantInvItemId, locationId, 1);
                      
                      // Sync local inventory count
                      const localInv = dbProduct?.inventory?.[0];
                      if (localInv) {
                        await prisma.inventory.update({
                          where: { id: localInv.id },
                          data: { stockQuantity: updatedLevel.available ?? (localInv.stockQuantity + 1) }
                        });
                      }
                    }
                  } catch (shopifyErr) {
                    console.error('[Order Patch Old SKU Restore Shopify Error]:', shopifyErr);
                  }
                }
              }
            } catch (dbRestoreErr) {
              console.error('[Order Patch Old SKU Restore DB Error]:', dbRestoreErr);
            }
          }

          // If assigning a new SKU
          if (newSku) {
            const normalizedSku = newSku.toUpperCase();
            
            // Find if this SKU exists in product_skus
            try {
              const skuRecords: any[] = await prisma.$queryRawUnsafe(
                `SELECT * FROM product_skus WHERE UPPER(sku) = $1`,
                normalizedSku
              );
              
              if (skuRecords.length > 0) {
                const skuRec = skuRecords[0];
                
                // 1. Validate Product Mismatch
                if (orderItem.productId !== skuRec.product_id) {
                  const p = await prisma.product.findUnique({ where: { id: skuRec.product_id } });
                  return NextResponse.json({
                    success: false,
                    error: `Product Mismatch: Scanned SKU belongs to "${p?.title || 'a different product'}", not this order item.`
                  }, { status: 400 });
                }
                
                // 2. Validate Size Mismatch
                const itemSize = extractSize(orderItem);
                if (itemSize && itemSize.toUpperCase() !== skuRec.size.toUpperCase()) {
                  return NextResponse.json({
                    success: false,
                    error: `Size Mismatch: Scanned SKU size is "${skuRec.size}", but this order item requires size "${itemSize}".`
                  }, { status: 400 });
                }

                // 3. Validate Status — only IN_STOCK SKUs can be assigned to orders
                if (skuRec.status !== 'IN_STOCK') {
                  const statusMessages: Record<string, string> = {
                    'SOLD': `SKU Sold: This price tag (${newSku}) has already been shipped/sold.`,
                    'PRINTED': `SKU Not Received: This price tag (${newSku}) has been printed but not yet scanned into inventory. Scan it in via the Scanner first.`,
                    'PENDING_RECEIPT': `SKU Pending: This price tag (${newSku}) is pending receipt. Scan it in via the Scanner first.`,
                  };
                  return NextResponse.json({
                    success: false,
                    error: statusMessages[skuRec.status] || `SKU unavailable (status: ${skuRec.status}). Only IN_STOCK SKUs can be assigned to orders.`
                  }, { status: 400 });
                }

                // Mark SKU as SOLD in inventory
                await prisma.$executeRawUnsafe(
                  `UPDATE product_skus SET status = 'SOLD', quantity = 0 WHERE id = $1`,
                  skuRec.id
                );
                
                // Resolve variant-specific inventory_item_id
                const { inventoryItemId: variantInvItemId } = await resolveSkuInventoryItemId(skuRec);
                
                // Decrement Shopify & local product inventory by 1 for the correct variant
                const dbProduct = await prisma.product.findUnique({
                  where: { id: skuRec.product_id },
                  include: { inventory: true }
                });
                
                if (variantInvItemId) {
                  try {
                    const { adjustInventoryLevel, fetchLocations } = await import('@/lib/shopify-admin');
                    const locations = await fetchLocations();
                    const activeLocation = locations.find((l) => l.active) || locations[0];
                    const locationId = activeLocation ? String(activeLocation.id) : null;
                    
                    if (locationId) {
                      const updatedLevel = await adjustInventoryLevel(variantInvItemId, locationId, -1);
                      
                      // Sync local inventory count
                      const localInv = dbProduct?.inventory?.[0];
                      if (localInv) {
                        await prisma.inventory.update({
                          where: { id: localInv.id },
                          data: { stockQuantity: updatedLevel.available ?? (localInv.stockQuantity - 1) }
                        });
                      }
                    }
                  } catch (shopifyErr) {
                    console.error('[Order Patch Shopify Sync Error]:', shopifyErr);
                  }
                }

                // Record scan activity for ORDER_OUT
                try {
                  await prisma.scanRecord.create({
                    data: {
                      productId: skuRec.product_id,
                      productTitle: dbProduct?.title || 'Order Item SKU Assignment',
                      variantInfo: `Size ${skuRec.size}`,
                      sku: skuRec.sku,
                      actionType: 'ORDER_OUT',
                      quantity: 1,
                      beforeStock: dbProduct ? (dbProduct.inventory[0]?.stockQuantity || 1) : 1,
                      afterStock: dbProduct ? Math.max(0, (dbProduct.inventory[0]?.stockQuantity || 1) - 1) : 0,
                      locationId: 'LOCAL',
                      staffName: 'Admin (Auto)'
                    }
                  });
                } catch (e) {
                  console.error('[Scan Record Create Error]:', e);
                }
              } else {
                return NextResponse.json({
                  success: false,
                  error: `Invalid SKU: The scanned SKU (${newSku}) was not found in the printed tags database.`
                }, { status: 400 });
              }
            } catch (dbErr) {
              console.error('[Order Patch SKU Local DB Query Error]:', dbErr);
              return NextResponse.json({ success: false, error: 'Database verification failed.' }, { status: 500 });
            }
          }

          // Update the OrderItem/MobileOrderItem SKU in database
          if (isMobileOrder) {
            await prisma.mobileOrderItem.update({
              where: { id: item.id },
              data: { sku: item.sku || null }
            });
          } else {
            await prisma.orderItem.update({
              where: { id: item.id },
              data: { sku: item.sku || null }
            });
          }
        }
      }
      delete body.items; // Remove items so they are not updated on Order object directly
    }

    // Auto-cancel sub-statuses if status is set to cancelled
    if (body.status === 'cancelled' && oldOrder.status !== 'cancelled') {
      const deliveryStatusLower = (oldOrder.deliveryStatus || '').toLowerCase();
      const isShippedOrDelivered = ['shipped', 'delivered', 'in transit', 'out for delivery'].includes(deliveryStatusLower);
      
      if (isShippedOrDelivered) {
        return NextResponse.json({ success: false, error: 'Cannot cancel order that is already shipped or delivered' }, { status: 400 });
      }

      body.paymentStatus = ['paid', 'cod_upfront_paid', 'refunded', 'approved', 'success'].includes(oldOrder.paymentStatus) ? oldOrder.paymentStatus : 'cancelled';
      body.fulfillmentStatus = 'cancelled';
      body.deliveryStatus = 'cancelled';
      body.cancelledAt = new Date();
      body.cancelledBy = 'admin';

      // ─── BUG 2 FIX: Renumber cancelled orders to ZBCC ───
      if (!isMobileOrder) {
        try {
          const { assignFailedOrderNumber } = await import('@/lib/orderNumber');
          const cancelledNumber = await assignFailedOrderNumber(prisma, { cause: 'cancelled' });
          const oldNumber = oldOrder.internalOrderNumber;
          const previousNumbers = [oldOrder.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
          body.internalOrderNumber = cancelledNumber;
          body.previousOrderNumbers = previousNumbers || null;
          // Update tags to reflect new ZBCC number
          const oldTags = oldOrder.tags || '';
          body.tags = oldTags.replace(/zb-order-\S+/, `zb-order-${cancelledNumber}`);
          if (body.tags === oldTags && !body.tags.includes(`zb-order-${cancelledNumber}`)) {
            body.tags = `${body.tags}, zb-order-${cancelledNumber}`;
          }
          console.log(`[Admin Order PATCH] Renumbered cancelled order: ${oldNumber} → ${cancelledNumber}`);
          // Sync WebStoreOrder to keep orderNumber in lockstep with the ZBCC number
          if (oldNumber) {
            await prisma.webStoreOrder.updateMany({
              where: { orderNumber: oldNumber },
              data: { orderNumber: cancelledNumber },
            });
          }
        } catch (renumberErr) {
          console.error('[Admin Order PATCH] Failed to assign ZBCC number:', renumberErr);
        }
      }
      
      if (!isMobileOrder) {
        const order = await prisma.order.findUnique({ where: { id } });
        if (order && order.shopifyOrderId && !order.shopifyOrderId.startsWith('#') && !order.shopifyOrderId.startsWith('app_pending_')) {
          try {
            const { cancelOrder } = await import('@/lib/shopify-admin');
            await cancelOrder(order.shopifyOrderId);
          } catch (shopifyErr) {
            console.error('[Admin Order PATCH] Failed to cancel order in Shopify:', shopifyErr);
          }
          // Sync the new ZBCC number to Shopify tags after cancellation
          if (body.internalOrderNumber) {
            try {
              const { updateOrderTags } = await import('@/lib/shopify-admin');
              await updateOrderTags(order.shopifyOrderId, body.tags || '', [
                { name: 'internal_order_number', value: body.internalOrderNumber },
              ]);
              console.log(`[Admin Order PATCH] Synced ZBCC number to Shopify: ${body.internalOrderNumber}`);
            } catch (tagErr) {
              console.error('[Admin Order PATCH] Failed to sync ZBCC tags to Shopify:', tagErr);
            }
          }
        }
      } else {
        const mobOrder = await prisma.mobileOrder.findUnique({ where: { id } });
        if (mobOrder && mobOrder.shopifyOrderId && !mobOrder.shopifyOrderId.startsWith('local_') && !mobOrder.shopifyOrderId.startsWith('app_')) {
          try {
            const { cancelOrder } = await import('@/lib/shopify-admin');
            await cancelOrder(mobOrder.shopifyOrderId);
          } catch (shopifyErr) {
            console.error('[Admin Mobile Order PATCH] Failed to cancel order in Shopify:', shopifyErr);
          }
        }
      }
    }

    let updated;
    if (isMobileOrder) {
      updated = await prisma.mobileOrder.update({
        where: { id },
        data: body,
      });
    } else {
      updated = await prisma.order.update({
        where: { id },
        data: body,
      });

      // Synchronize changes to WebStoreOrder if one exists
      try {
        let webStoreOrder = null;
        if (updated.razorpayOrderId) {
          webStoreOrder = await prisma.webStoreOrder.findFirst({
            where: { razorpayOrderId: updated.razorpayOrderId }
          });
        }
        if (!webStoreOrder) {
          webStoreOrder = await prisma.webStoreOrder.findFirst({
            where: { notes: { contains: `Local: ${updated.id}` } }
          });
        }
        if (!webStoreOrder && updated.shopifyOrderId) {
          webStoreOrder = await prisma.webStoreOrder.findFirst({
            where: { notes: { contains: `Shopify: ${updated.shopifyOrderId}` } }
          });
        }
        if (!webStoreOrder && (updated.internalOrderNumber || updated.shopifyOrderName)) {
          webStoreOrder = await prisma.webStoreOrder.findFirst({
            where: { orderNumber: updated.internalOrderNumber || updated.shopifyOrderName }
          });
        }

        if (webStoreOrder) {
          const webStoreUpdate: any = {};
          if (body.paymentStatus) {
            webStoreUpdate.paymentStatus = body.paymentStatus;
          }
          if (body.fulfillmentStatus) {
            webStoreUpdate.fulfillmentStatus = body.fulfillmentStatus;
          }
          if (body.note) {
            webStoreUpdate.notes = body.note;
          }

          if (Object.keys(webStoreUpdate).length > 0) {
            await prisma.webStoreOrder.update({
              where: { id: webStoreOrder.id },
              data: webStoreUpdate
            });
            console.log(`[Admin Order PATCH] Synced WebStoreOrder ${webStoreOrder.id} with updates:`, webStoreUpdate);
          }
        }
      } catch (wsSyncErr: any) {
        console.error('[Admin Order PATCH] Failed to sync WebStoreOrder:', wsSyncErr.message);
      }
    }

    // Trigger auto refund if order status was set to cancelled
    if (body.status === 'cancelled' && !isMobileOrder) {
      try {
        const { processOrderRefund } = await import('@/lib/services/refundService');
        await processOrderRefund(id);
      } catch (refundErr) {
        console.error('[Admin Order PATCH] Refund processing failed:', refundErr);
      }

      // Restore all custom SKUs assigned to this order's items back to IN_STOCK
      try {
        const { restoreOrderSkus } = await import('@/lib/services/skuService');
        const restoredCount = await restoreOrderSkus(id, 'CANCEL_RESTORE', 'Admin (Cancel)');
        if (restoredCount > 0) {
          console.log(`[Admin Order PATCH] Restored ${restoredCount} SKU(s) for cancelled order ${id}`);
        }
      } catch (skuErr) {
        console.error('[Admin Order PATCH] SKU restoration on cancel failed:', skuErr);
      }

      // Revert affiliate referral
      try {
        const { reverseReferral } = await import('@/lib/affiliate/earnings');
        await reverseReferral(id, 'cancelled_by_admin');
      } catch (affErr: any) {
        console.warn('[Admin Order PATCH] Affiliate reversal warning:', affErr.message);
      }
    }

    // Send push notification if status changed
    if (oldOrder && updated.customerId) {
      const statusChanged = body.status && body.status !== oldOrder.status;
      const deliveryChanged = body.deliveryStatus && body.deliveryStatus !== oldOrder.deliveryStatus;

      if (statusChanged || deliveryChanged) {
        try {
          const { NotificationService } = await import('@/lib/services/notification.service');
          let message = 'Your order status has been updated';
          if (deliveryChanged && updated.deliveryStatus === 'delivered') message = 'Your order has been delivered!';
          else if (deliveryChanged && updated.deliveryStatus === 'out_for_delivery') message = 'Your order is out for delivery!';
          else if (statusChanged && updated.status === 'approved') message = 'Your order has been approved and is being processed';

          await NotificationService.sendToUser(
            updated.customerId,
            'Zica Bella Order Update',
            message,
            { orderId: updated.id, status: updated.status, deliveryStatus: updated.deliveryStatus }
          );
          console.log(`[Admin Order PATCH] Push notification sent to user ${updated.customerId}`);
        } catch (pushErr) {
          console.error('[Admin Order PATCH] Push notification failed:', pushErr);
        }

        // Module 3: Automatic Order Email Webhook Trigger (Non-blocking / Fire-and-forget)
        try {
          const localApiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.zicabella.com'}/api/orders/status-update`;
          const apiSecret = process.env.INTERNAL_API_SECRET || 'ZB_INTERNAL_SECRET_987654321';
          
          prisma.order.findUnique({
            where: { id: updated.id },
            include: {
              customer: true,
              items: true,
              shipments: { orderBy: { createdAt: 'desc' } }
            }
          }).then((fullOrder: any) => {
            if (fullOrder && fullOrder.customer && fullOrder.customer.email) {
              const latestShipment = fullOrder.shipments?.[0];
              const resolvedStatus = statusChanged ? fullOrder.status : fullOrder.deliveryStatus;
              
              const payload = {
                orderId: fullOrder.id,
                newStatus: resolvedStatus,
                customerEmail: fullOrder.customer.email,
                customerName: fullOrder.customer.name || 'Valued Customer',
                paymentMethod: fullOrder.paymentMethod || undefined,
                items: fullOrder.items.map((i: any) => ({
                  name: i.title,
                  size: i.sku?.split('-')?.pop() || 'M',
                  quantity: i.quantity,
                  price: i.price,
                  image: i.image || null,
                })),
                total: fullOrder.totalPrice,
                currency: fullOrder.currency || 'INR',
                trackingNumber: latestShipment?.trackingNumber || undefined,
                courier: latestShipment?.courier || undefined,
              };

              fetch(localApiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-secret': apiSecret,
                },
                body: JSON.stringify(payload),
              })
              .then(res => res.json())
              .then(resData => console.log('[Admin Order Status Trigger] Email status webhook success:', resData))
              .catch((err: any) => console.error('[Admin Order Status Trigger] Email status webhook fetch error:', err));
            }
          }).catch((err: any) => console.error('[Admin Order Status Trigger] Error loading full order for email:', err));
        } catch (emailErr) {
          console.error('[Admin Order Status Trigger] Background email trigger failed:', emailErr);
        }
      }
    }

    return NextResponse.json({ success: true, order: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
