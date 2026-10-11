import { NextResponse } from 'next/server';
import {
  fetchAllOrders,
  fetchAllCustomers,
  fetchAllProducts,
  fetchLocations,
  fetchInventoryLevels,
} from '@/lib/shopify-admin';
import prisma from '@/lib/db';
import { registerWebhooks } from '@/lib/shopify-webhooks';
import { extractSizeFromVariant } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopify/sync
 * Performs a full sync: pulls all products, orders, customers from Shopify
 * and upserts them into the local SQLite database.
 */
export async function POST() {
  const results = {
    products: 0,
    orders: 0,
    customers: 0,
    inventory: 0,
    errors: [] as string[],
  };

  try {
    // Ensure shop record exists
    const shopDomain = process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || '8tiahf-bk.myshopify.com';
    const envToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    
    let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
    
    if (!shop) {
      console.log(`[Sync Route] Creating new shop record for ${shopDomain}`);
      shop = await prisma.shop.create({
        data: {
          domain: shopDomain,
          accessToken: envToken || 'shpat_placeholder',
        },
      });
    } else if (envToken && (!shop.accessToken || shop.accessToken.includes('placeholder') || shop.accessToken.includes('required'))) {
      // Heal the shop record if it has a placeholder but we have a real token in env
      shop = await prisma.shop.update({
        where: { id: shop.id },
        data: { accessToken: envToken }
      });
      console.log(`[Sync Route] Updated shop ${shopDomain} with real token from environment.`);
    }

    // Register webhooks automatically to ensure real-time sync works
    try {
      console.log('[Sync Route] Running webhook registration check...');
      await registerWebhooks();
    } catch (whErr: any) {
      console.warn('[Sync Route] Webhook registration failed:', whErr.message);
      results.errors.push(`Webhook registration: ${whErr.message}`);
    }

    // ─── Parallel Syncing ──────────────────────────────────────────
    const syncProducts = async () => {
      try {
        const products = await fetchAllProducts(250);
        await Promise.all(products.map(async (p: any) => {
          const firstVariant = p.variants?.[0];
          await prisma.product.upsert({
            where: { shopifyProductId: String(p.id) },
            create: {
              shopId: shop.id,
              shopifyProductId: String(p.id),
              title: p.title,
              handle: p.handle,
              price: parseFloat(firstVariant?.price || '0'),
              sku: firstVariant?.sku || null,
              barcode: firstVariant?.barcode || null,
              inventoryItemId: firstVariant ? String(firstVariant.inventory_item_id) : null,
              featuredImage: p.image?.src || p.images?.[0]?.src || null,
            },
            update: {
              title: p.title,
              handle: p.handle,
              price: parseFloat(firstVariant?.price || '0'),
              sku: firstVariant?.sku || null,
              barcode: firstVariant?.barcode || null,
              inventoryItemId: firstVariant ? String(firstVariant.inventory_item_id) : null,
              featuredImage: p.image?.src || p.images?.[0]?.src || null,
            },
          });
          results.products++;
        }));
      } catch (e: any) {
        results.errors.push(`Products: ${e.message}`);
      }
    };

    const syncCustomers = async () => {
      try {
        const customers = await fetchAllCustomers(250);
        await Promise.all(customers.map(async (c: any) => {
          await prisma.customer.upsert({
            where: { shopifyId: String(c.id) },
            create: {
              shopId: shop.id,
              shopifyId: String(c.id),
              email: c.email,
              name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
              phone: c.phone,
              defaultAddress: c.default_address ? JSON.stringify(c.default_address) : null,
              ordersCount: c.orders_count || 0,
              totalSpent: c.total_spent ? parseFloat(c.total_spent) : 0,
            },
            update: {
              email: c.email,
              name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
              phone: c.phone,
              defaultAddress: c.default_address ? JSON.stringify(c.default_address) : null,
              ordersCount: c.orders_count || 0,
              totalSpent: c.total_spent ? parseFloat(c.total_spent) : 0,
            },
          });
          results.customers++;
        }));
      } catch (e: any) {
        results.errors.push(`Customers: ${e.message}`);
      }
    };

    const syncOrders = async () => {
      try {
        // Fetch products first to have a cache of images
        const productsRaw = await fetchAllProducts(250);
        const productImageMap = new Map<string, string>();
        productsRaw.forEach(p => {
          const img = p.image?.src || p.images?.[0]?.src;
          if (img) productImageMap.set(String(p.id), img);
        });

        const orders = await fetchAllOrders(250);
        for (const o of orders) {
          const customerId = o.customer ? String(o.customer.id) : 'anonymous';

          // Ensure customer exists
          let dbCustomer;
          if (o.customer) {
            dbCustomer = await prisma.customer.upsert({
              where: { shopifyId: customerId },
              create: {
                shopId: shop.id,
                shopifyId: customerId,
                email: o.customer.email,
                name: `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim(),
                phone: o.customer.phone,
                defaultAddress: o.customer.default_address ? JSON.stringify(o.customer.default_address) : null,
                ordersCount: o.customer.orders_count || 0,
                totalSpent: o.customer.total_spent ? parseFloat(o.customer.total_spent) : 0,
              },
              update: {},
            });
          } else {
            dbCustomer = await prisma.customer.upsert({
              where: { shopifyId: 'anonymous' },
              create: { shopId: shop.id, shopifyId: 'anonymous', name: 'Anonymous' },
              update: {},
            });
          }

          // Determine delivery status from fulfillments and tags
          let deliveryStatus = 'pending';
          const lowerTags = (o.tags || '').toLowerCase();
          
          if (o.fulfillment_status === 'fulfilled') {
            deliveryStatus = 'shipped';
          }

          // Check tags for manual delivery markers
          if (lowerTags.includes('delivered') || lowerTags.includes('shipped_successfully')) {
            deliveryStatus = 'delivered';
          }
          
          if (o.fulfillments && Array.isArray(o.fulfillments)) {
            for (const f of o.fulfillments) {
              const fStatus = (f.shipment_status || '').toLowerCase();
              if (fStatus === 'delivered' || fStatus === 'shipped' || fStatus === 'success') {
                deliveryStatus = 'delivered';
                break;
              } else if (fStatus === 'out_for_delivery') {
                deliveryStatus = 'out_for_delivery';
                break;
              }
            }
          }

          const isMobileAppOrder = lowerTags.includes('apporder') || lowerTags.includes('mobileapp');
          const currentStatus = o.status || 'active';
          
          // Orders from Shopify are considered "approved" if they are mobile app orders
          let finalStatus = isMobileAppOrder ? 'approved' : 'active';
          
          if (o.cancelled_at) {
            finalStatus = 'cancelled';
            deliveryStatus = 'cancelled';
            o.fulfillment_status = 'cancelled';
          }

          // Extract the universalOrderNumber from tags if available
          const tagsArray = (o.tags || '').split(',').map((t: string) => t.trim());
          const orderNumberTag = tagsArray.find((t: string) => t.startsWith('zb-order-'));
          const universalOrderNumber = orderNumberTag ? orderNumberTag.replace('zb-order-', '') : null;

          // Find corresponding WebStoreOrder in DB
          let webStoreOrder = null;
          if (universalOrderNumber) {
            webStoreOrder = await prisma.webStoreOrder.findUnique({
              where: { orderNumber: universalOrderNumber }
            });
          }
          if (!webStoreOrder && o.id) {
            webStoreOrder = await prisma.webStoreOrder.findFirst({
              where: {
                OR: [
                  { razorpayOrderId: String(o.id) },
                  { notes: { contains: `Shopify: ${o.id}` } }
                ]
              }
            });
          }

          // Resolve existing local Order record to check if we can prevent duplicates
          let existingLocalOrder = await prisma.order.findUnique({
            where: { shopifyOrderId: String(o.id) },
            select: { id: true, paymentMethod: true, razorpayOrderId: true, razorpayPaymentId: true, orderType: true, internalOrderNumber: true, discountAmount: true, discountCode: true }
          });

          // Prevent Duplicate: If not found by shopifyOrderId, look up by internalOrderNumber
          if (!existingLocalOrder && (universalOrderNumber || webStoreOrder?.orderNumber)) {
            const targetOrderNumber = universalOrderNumber || webStoreOrder?.orderNumber;
            existingLocalOrder = await prisma.order.findFirst({
              where: {
                OR: [
                  { internalOrderNumber: targetOrderNumber },
                  {
                    shopifyOrderId: {
                      in: [`app_pending_${targetOrderNumber}`, `local_${targetOrderNumber}`]
                    }
                  }
                ]
              },
              select: { id: true, paymentMethod: true, razorpayOrderId: true, razorpayPaymentId: true, orderType: true, internalOrderNumber: true, discountAmount: true, discountCode: true }
            });

            // Heal shopifyOrderId on the existing local Order record to ensure the upsert updates it
            if (existingLocalOrder) {
              console.log(`[Sync] Healing shopifyOrderId for local order ID: ${existingLocalOrder.id} -> ${o.id}`);
              await prisma.order.update({
                where: { id: existingLocalOrder.id },
                data: { shopifyOrderId: String(o.id) }
              });
            }
          }

          // Determine the correct canonical payment method and payment status
          let derivedPaymentMethod = 'razorpay';
          let derivedPaymentStatus = o.financial_status || 'pending';

          if (webStoreOrder) {
            // Priority 1: If we have a local WebStoreOrder, adopt its payment details directly
            derivedPaymentMethod = webStoreOrder.paymentMethod;
            derivedPaymentStatus = webStoreOrder.paymentStatus;
          } else {
            // Priority 2: Gateway detection from Shopify
            const gatewayNames = (o.payment_gateway_names || []).map((g: any) => String(g).toLowerCase());
            const rawGateway = String(o.gateway || '').toLowerCase();
            const hasCodGateway = gatewayNames.includes('manual') || 
              gatewayNames.includes('cod') || 
              gatewayNames.includes('cash on delivery (cod)') || 
              rawGateway === 'manual' || 
              rawGateway === 'cod' || 
              rawGateway.includes('cash on delivery');

            const isCodOrder = hasCodGateway || 
              lowerTags.includes('cod') || 
              (o.note || '').toLowerCase().includes('cod');

            derivedPaymentMethod = isCodOrder ? 'COD' : 'razorpay';
            derivedPaymentStatus = isCodOrder ? 'pending' : (o.financial_status || 'pending');
          }

          // Preserve local paymentMethod if it's already set correctly (e.g., from checkout/complete or DB overrides)
          const finalPaymentMethod = existingLocalOrder?.paymentMethod && 
            (existingLocalOrder.paymentMethod === 'COD' || existingLocalOrder.paymentMethod === 'razorpay')
            ? existingLocalOrder.paymentMethod
            : derivedPaymentMethod;

          // Make sure paymentStatus is correct: if it's a prepaid webStoreOrder, sync status as 'paid'
          const finalPaymentStatus = webStoreOrder?.paymentMethod === 'razorpay' ? 'paid' : derivedPaymentStatus;

          const discountAmount = webStoreOrder?.discountAmount 
            ? Number(webStoreOrder.discountAmount) 
            : (existingLocalOrder?.discountAmount || 0);
          const discountCode = webStoreOrder?.discountCode 
            ? webStoreOrder.discountCode 
            : (existingLocalOrder?.discountCode || null);

          let finalTotalPrice = parseFloat(o.total_price || '0');
          const finalSubtotalPrice = o.total_line_items_price 
            ? parseFloat(o.total_line_items_price) 
            : (o.subtotal_price ? parseFloat(o.subtotal_price) : finalTotalPrice);

          // Auto-correct undiscounted totalPrice synced from Shopify
          if (discountAmount > 0 && Math.abs(finalTotalPrice - finalSubtotalPrice) < 0.01) {
            finalTotalPrice = finalSubtotalPrice - discountAmount;
          }

          const order = await prisma.order.upsert({
            where: { shopifyOrderId: String(o.id) },
            create: {
              shopId: shop.id,
              shopifyOrderId: String(o.id),
              customerId: dbCustomer.id,
              status: finalStatus,
              totalPrice: finalTotalPrice,
              subtotalPrice: finalSubtotalPrice,
              totalTax: o.total_tax ? parseFloat(o.total_tax) : null,
              currency: o.currency || 'INR',
              paymentStatus: finalPaymentStatus,
              paymentMethod: finalPaymentMethod,
              fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
              deliveryStatus: deliveryStatus,
              shippingAddress: o.shipping_address ? JSON.stringify(o.shipping_address) : null,
              billingAddress: o.billing_address ? JSON.stringify(o.billing_address) : null,
              note: o.note || null,
              tags: o.tags || null,
              shopifyOrderName: o.name || null,
              createdAt: new Date(o.created_at),
              razorpayOrderId: webStoreOrder?.razorpayOrderId || existingLocalOrder?.razorpayOrderId || null,
              razorpayPaymentId: webStoreOrder?.razorpayPaymentId || existingLocalOrder?.razorpayPaymentId || null,
              internalOrderNumber: webStoreOrder?.orderNumber || existingLocalOrder?.internalOrderNumber || universalOrderNumber || null,
              orderType: existingLocalOrder?.orderType || (webStoreOrder ? 'WEB_STORE' : 'REGULAR'),
              discountAmount: discountAmount,
              discountCode: discountCode,
            },
            update: {
              shopifyOrderName: o.name || null,
              status: finalStatus, // Always update status from sync if it's in Shopify
              totalPrice: finalTotalPrice,
              subtotalPrice: finalSubtotalPrice,
              totalTax: o.total_tax ? parseFloat(o.total_tax) : null,
              currency: o.currency || 'INR',
              paymentStatus: finalPaymentStatus,
              // Only update paymentMethod if we don't already have a correct local value
              paymentMethod: finalPaymentMethod,
              fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
              deliveryStatus: deliveryStatus,
              shippingAddress: o.shipping_address ? JSON.stringify(o.shipping_address) : null,
              billingAddress: o.billing_address ? JSON.stringify(o.billing_address) : null,
              note: o.note || null,
              tags: o.tags || null,
              razorpayOrderId: webStoreOrder?.razorpayOrderId || existingLocalOrder?.razorpayOrderId || null,
              razorpayPaymentId: webStoreOrder?.razorpayPaymentId || existingLocalOrder?.razorpayPaymentId || null,
              internalOrderNumber: webStoreOrder?.orderNumber || existingLocalOrder?.internalOrderNumber || universalOrderNumber || null,
              discountAmount: discountAmount,
              discountCode: discountCode,
            },
          });

          if (finalStatus === 'cancelled') {
            try {
              const { processOrderRefund } = await import('@/lib/services/refundService');
              await processOrderRefund(order.id);
            } catch (refundErr) {
              console.error(`[Sync Route] Refund failed for order ${order.id}:`, refundErr);
            }
          }

          // Delete old line items that do not match Shopify's IDs
          const shopifyItemIds = o.line_items.map((item: any) => String(item.id));
          await prisma.orderItem.deleteMany({
            where: {
              orderId: order.id,
              shopifyLineItemId: { notIn: shopifyItemIds }
            }
          });

          // Line items in parallel for this order
          await Promise.all(o.line_items.map(async (item: any) => {
            const shopifyProductId = item.product_id ? String(item.product_id) : null;
            let dbProductId = null;
            if (shopifyProductId) {
              const prod = await prisma.product.findUnique({ where: { shopifyProductId } });
              dbProductId = prod?.id || null;
            }

            // Resolve image for this item
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
              },
              update: {
                quantity: item.quantity,
                price: parseFloat(item.price || '0'),
                sku: item.sku || null,
                image: itemImage || null,
                variantId: vId,
                variantTitle: vTitle,
                size: itemSize,
              },
            });
          }));
          results.orders++;
        }
      } catch (e: any) {
        results.errors.push(`Orders: ${e.message}`);
      }
    };

    const syncInventory = async () => {
      try {
        const locations = await fetchLocations();
        if (locations.length > 0) {
          const locationIds = locations.map((l) => String(l.id));
          const levels = await fetchInventoryLevels(locationIds);

          await Promise.all(levels.map(async (level: any) => {
            const inventoryItemIdStr = String(level.inventory_item_id);
            // 1. Try legacy product-level lookup
            let product = await prisma.product.findUnique({
              where: { inventoryItemId: inventoryItemIdStr },
            });

            // 2. Try variant-level lookup from product_skus
            if (!product) {
              try {
                const skuRows: any[] = await prisma.$queryRawUnsafe(
                  `SELECT DISTINCT product_id FROM product_skus WHERE inventory_item_id = $1 LIMIT 1`,
                  inventoryItemIdStr
                );
                if (skuRows.length > 0) {
                  product = await prisma.product.findUnique({
                    where: { id: skuRows[0].product_id }
                  });
                }
              } catch (err) {
                console.error(`[Sync] Error searching product_skus for inventory_item_id ${inventoryItemIdStr}:`, err);
              }
            }

            if (product) {
              await prisma.inventory.upsert({
                where: {
                  productId_locationId: {
                    productId: product.id,
                    locationId: String(level.location_id),
                  },
                },
                create: {
                  productId: product.id,
                  locationId: String(level.location_id),
                  stockQuantity: level.available ?? 0,
                  reservedQuantity: 0,
                },
                update: {
                  stockQuantity: level.available ?? 0,
                },
              });
              results.inventory++;
            }
          }));
        }
      } catch (e: any) {
        results.errors.push(`Inventory: ${e.message}`);
      }
    };

    const syncLogistics = async () => {
      // Tracking refresh is handled by Shiprocket webhooks + /api/admin/logistics/sync.
      // Direct Delhivery polling has been removed.
      return;
    };

    // Run all sync tasks
    await Promise.all([
      syncProducts(),
      syncCustomers(),
      syncOrders(),
      syncInventory(),
      syncLogistics(),
    ]);

    return NextResponse.json({
      success: true,
      synced: results,
    });
  } catch (error: any) {
    console.error('Sync Error:', error.stack);
    return NextResponse.json(
      { error: 'Sync failed', details: error.message, partialResults: results },
      { status: 500 }
    );
  }
}
