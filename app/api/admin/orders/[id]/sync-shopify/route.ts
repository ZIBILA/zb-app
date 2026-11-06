import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { syncOrderToShopify, pullAndSyncShopifyOrder } from '@/lib/services/shopifyOrderSyncService';
import { extractSizeFromVariant } from '@/lib/utils';
import { loadProductTypeCarry } from '@/lib/services/orderItemProductType';

/**
 * POST /api/admin/orders/[id]/sync-shopify
 * Syncs a local mobile order to Shopify by creating a new Shopify order.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const orderId = params.id;

    // Fetch the local order with full details
    let order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!order) {
      // Check if it's a mobile order
      const mobileOrder = await prisma.mobileOrder.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          items: true,
        }
      });

      if (mobileOrder) {
        // If already synced (numeric Shopify order id), skip.
        if (mobileOrder.shopifyOrderId && /^\d+$/.test(String(mobileOrder.shopifyOrderId))) {
          return NextResponse.json({
            success: true,
            shopifyOrderId: mobileOrder.shopifyOrderId,
            message: 'Order already synced to Shopify'
          });
        }

        // Update DB authority first to approved
        await prisma.mobileOrder.update({
          where: { id: mobileOrder.id },
          data: { status: 'approved' },
        });

        // Ensure corresponding standard local Order exists
        let localOrder = await prisma.order.findFirst({
          where: {
            OR: [
              { internalOrderNumber: mobileOrder.orderNumber },
              ...(mobileOrder.shopifyOrderId ? [{ shopifyOrderId: mobileOrder.shopifyOrderId }] : []),
            ],
          },
        });

        if (!localOrder) {
          const orderLineItems = mobileOrder.items.map((item: any, index: number) => ({
            shopifyLineItemId: `synced_${mobileOrder.id}_${index}_${Date.now()}`,
            title: item.title,
            quantity: item.quantity,
            price: item.price,
            sku: item.sku,
            productId: item.productId
          }));

          localOrder = await prisma.order.create({
            data: {
              shopId: mobileOrder.customer.shopId,
              customerId: mobileOrder.customerId,
              status: 'approved',
              totalPrice: mobileOrder.totalPrice,
              subtotalPrice: mobileOrder.subtotalPrice || mobileOrder.totalPrice,
              totalTax: mobileOrder.totalTax || 0,
              currency: mobileOrder.currency || 'INR',
              paymentStatus: mobileOrder.paymentStatus || 'pending',
              fulfillmentStatus: mobileOrder.fulfillmentStatus || 'unfulfilled',
              deliveryStatus: mobileOrder.deliveryStatus || 'pending',
              shippingAddress: mobileOrder.shippingAddress,
              billingAddress: mobileOrder.billingAddress,
              note: mobileOrder.note || null,
              tags: `AppOrder, MobileApp, zb-order-${mobileOrder.orderNumber}`,
              internalOrderNumber: mobileOrder.orderNumber,
              orderType: 'APP',
              shopifySyncStatus: 'pending',
              items: {
                create: orderLineItems
              }
            }
          });
        }

        // Delegate to single Shopify sync choke point
        const syncRes = await syncOrderToShopify(localOrder.id, { preserveAppTags: true });
        if (!syncRes.success) {
          return NextResponse.json({ success: false, error: syncRes.error || 'Sync to Shopify failed' }, { status: 500 });
        }

        const shopifyOrderId = syncRes.shopifyOrderId!;
        const shopifyOrderName = syncRes.shopifyOrderName;

        // Update mobile order
        await prisma.mobileOrder.update({
          where: { id: mobileOrder.id },
          data: {
            shopifyOrderId,
            status: 'synced',
            syncedAt: new Date(),
            tags: `${mobileOrder.tags || ''}, synced`.replace(/\s+/g, ' ').trim(),
          },
        });

        // Push notification
        try {
          const orderNumber = mobileOrder.orderNumber || 'your order';
          const { NotificationService } = await import('@/lib/services/notification.service');
          await NotificationService.sendToUser(
            mobileOrder.customerId,
            'Zica Bella Order Update',
            `Your order ${orderNumber} has been approved and synced!`,
            { orderId: mobileOrder.id, status: 'approved' }
          );
        } catch (pushErr) {
          console.error('[Admin Detail Sync] approve push failed:', pushErr);
        }

        return NextResponse.json({
          success: true,
          shopifyOrderId,
          shopifyOrderName,
        });
      }
    }

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // If already synced to Shopify, pull updates from Shopify to refresh the local record
    if (order.shopifyOrderId && !order.shopifyOrderId.startsWith('local_') && !order.shopifyOrderId.startsWith('app_') && !order.shopifyOrderId.startsWith('app_pending_')) {
      try {
        const { fetchOrder } = await import('@/lib/shopify-admin');
        const o = await fetchOrder(order.shopifyOrderId);
        if (!o) {
          return NextResponse.json({ success: false, error: 'Shopify order not found for pulling updates' }, { status: 404 });
        }

        // Use unified pull & sync service to sync fulfillments, tracking, shipments, and WebStoreOrder
        const syncResult = await pullAndSyncShopifyOrder(o, {
          localOrderId: order.id,
          fallbackOrderNumber: order.internalOrderNumber || undefined,
        });

        if (!syncResult.success) {
          throw new Error(syncResult.error || 'Failed to sync Shopify order tracking');
        }

        const updatedOrder = syncResult.order || (await prisma.order.findUnique({
          where: { id: order.id },
          include: { shipments: true },
        }));

        const finalStatus = updatedOrder.status;

        // Trigger refund logic if status became cancelled
        if (finalStatus === 'cancelled' && order.status !== 'cancelled') {
          // ─── BUG 2 FIX: Renumber cancelled orders to ZBCC ───
          try {
            const { assignFailedOrderNumber } = await import('@/lib/orderNumber');
            const cancelledNumber = await assignFailedOrderNumber(prisma, { cause: 'cancelled' });
            const oldNumber = order.internalOrderNumber;
            const previousNumbers = [order.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
            await prisma.order.update({
              where: { id: order.id },
              data: {
                internalOrderNumber: cancelledNumber,
                previousOrderNumbers: previousNumbers || null,
                tags: (updatedOrder.tags || '').replace(/zb-order-\S+/, `zb-order-${cancelledNumber}`),
              }
            });
            console.log(`[Sync Detail POST] Renumbered cancelled order: ${oldNumber} → ${cancelledNumber}`);

            // Sync ZBCC number back to Shopify tags
            if (order.shopifyOrderId) {
              try {
                const { updateOrderTags } = await import('@/lib/shopify-admin');
                const newTags = (updatedOrder.tags || '').replace(/zb-order-\S+/, `zb-order-${cancelledNumber}`);
                await updateOrderTags(order.shopifyOrderId, newTags, [
                  { name: 'internal_order_number', value: cancelledNumber },
                ]);
              } catch (tagErr) {
                console.error('[Sync Detail POST] Failed to sync ZBCC tags to Shopify:', tagErr);
              }
            }
          } catch (renumberErr) {
            console.error('[Sync Detail POST] Failed to assign ZBCC number:', renumberErr);
          }

          try {
            const { processOrderRefund } = await import('@/lib/services/refundService');
            await processOrderRefund(order.id);
          } catch (refundErr) {
            console.error(`[Sync Detail POST] Refund failed:`, refundErr);
          }
        }

        // Delete old line items and upsert current ones
        const shopifyItemIds = o.line_items.map((item: any) => String(item.id));
        // Shopify's line items carry no product type: keep the one already stored (read BEFORE the delete).
        const productTypeCarry = await loadProductTypeCarry(prisma, order.id);
        await prisma.orderItem.deleteMany({
          where: {
            orderId: order.id,
            shopifyLineItemId: { notIn: shopifyItemIds }
          }
        });

        // Cache products mapping for images
        const { fetchAllProducts } = await import('@/lib/shopify-admin');
        const productsRaw = await fetchAllProducts(50); // limit to 50 for quick single order sync
        const productImageMap = new Map<string, string>();
        productsRaw.forEach(p => {
          const img = p.image?.src || p.images?.[0]?.src;
          if (img) productImageMap.set(String(p.id), img);
        });

        await Promise.all(o.line_items.map(async (item: any) => {
          const shopifyProductId = item.product_id ? String(item.product_id) : null;
          let dbProductId = null;
          if (shopifyProductId) {
            const prod = await prisma.product.findUnique({ where: { shopifyProductId } });
            dbProductId = prod?.id || null;
          }
          const itemImage = shopifyProductId ? productImageMap.get(shopifyProductId) : null;

          const vTitle = item.variant_title && item.variant_title !== "Default Title" ? item.variant_title : null;
          const vId = item.variant_id ? String(item.variant_id) : null;
          const itemSize = extractSizeFromVariant(item.variant_title, item.sku, item.title);

          await prisma.orderItem.upsert({
            where: { shopifyLineItemId: String(item.id) },
            create: {
              orderId: order.id,
              shopifyLineItemId: String(item.id),
              productId: dbProductId,
              title: item.title,
              quantity: item.quantity,
              price: parseFloat(item.price || '0'),
              sku: item.sku || null,
              image: itemImage || null,
              variantId: vId,
              variantTitle: vTitle,
              size: itemSize,
              productType: productTypeCarry({ variantId: vId, productId: dbProductId }),
            },
            update: {
              quantity: item.quantity,
              price: parseFloat(item.price || '0'),
              sku: item.sku || null,
              image: itemImage || null,
              variantId: vId,
              variantTitle: vTitle,
              size: itemSize,
            }
          });
        }));

        return NextResponse.json({
          success: true,
          shopifyOrderId: order.shopifyOrderId,
          message: 'Local order successfully updated from Shopify',
          order: updatedOrder
        });

      } catch (err: any) {
        console.error('[Sync Detail POST] Error pulling updates from Shopify:', err);
        return NextResponse.json({ success: false, error: `Pull sync failed: ${err.message}` }, { status: 500 });
      }
    }

    // Delegate Shopify order creation to the single choke point
    const syncRes = await syncOrderToShopify(orderId, { preserveAppTags: true });
    if (!syncRes.success) {
      return NextResponse.json(
        { success: false, error: syncRes.error || 'Sync failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      shopifyOrderId: syncRes.shopifyOrderId,
      shopifyOrderName: syncRes.shopifyOrderName,
    });

  } catch (error: any) {
    console.error('[Sync] Shopify sync error:', error);
    
    // Save error in DB
    try {
      await prisma.order.update({
        where: { id: params.id },
        data: {
          shopifySyncStatus: 'failed',
          shopifySyncError: error.message || 'Unknown sync error'
        }
      });
    } catch (dbErr) {
      console.error('[Sync] Failed to update sync error in DB:', dbErr);
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Sync failed' },
      { status: 500 }
    );
  }
}
