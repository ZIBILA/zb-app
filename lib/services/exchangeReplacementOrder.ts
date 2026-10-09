import prisma from "@/lib/db";
import { createOrder, shopifyFetch } from "@/lib/shopify-admin";
import { allocateLinkedId, replacementIdForExchange } from "@/lib/linkedIds";

/**
 * Resolves the Shopify variant_id for a given exchange item.
 * CRITICAL: This function MUST return a variant_id to use existing catalog products.
 * Without variant_id, Shopify creates a "custom line item" (new product) which is wrong.
 *
 * Resolution strategy (in order):
 *  1. product_skus table: product_id + size → shopify_variant_id
 *  2. product_skus table: product_id only (no size filter) → first shopify_variant_id
 *  3. product_skus table: match by SKU → shopify_variant_id
 *  4. Shopify Admin API: fetch product variants, match by size/title
 *  5. Shopify Admin API: use first available variant (guaranteed existing product)
 */
async function resolveShopifyVariantId(
  newProduct: any,
  newSize: string | null | undefined,
  newVariantTitle: string | null | undefined
): Promise<{ variantId: number | null; resolvedSize: string | null; resolvedSku: string | null; variantPrice: string | null }> {
  const shopifyProductId = newProduct?.shopifyProductId;
  const normalizedSize = (newSize || '').trim().toUpperCase();

  // ── Tier 1: product_skus table with product_id + size → exact variant match ──
  if (normalizedSize && newProduct?.id) {
    try {
      const skuRecs: any[] = await prisma.$queryRawUnsafe(
        `SELECT shopify_variant_id, sku, size FROM product_skus WHERE product_id = $1 AND UPPER(size) = $2 AND shopify_variant_id IS NOT NULL LIMIT 1`,
        newProduct.id,
        normalizedSize
      );
      if (skuRecs?.[0]?.shopify_variant_id) {
        console.log(`[Variant Resolve] ✅ Tier 1: Found variant ${skuRecs[0].shopify_variant_id} for product ${newProduct.id} size ${normalizedSize} via product_skus`);
        return {
          variantId: parseInt(skuRecs[0].shopify_variant_id, 10),
          resolvedSize: skuRecs[0].size || normalizedSize,
          resolvedSku: skuRecs[0].sku || newProduct.sku,
          variantPrice: null,
        };
      }
    } catch (_) {}
  }

  // ── Tier 2: product_skus table with product_id only (no size filter) ──
  if (newProduct?.id) {
    try {
      const skuRecs: any[] = await prisma.$queryRawUnsafe(
        `SELECT shopify_variant_id, sku, size FROM product_skus WHERE product_id = $1 AND shopify_variant_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        newProduct.id
      );
      if (skuRecs?.[0]?.shopify_variant_id) {
        console.log(`[Variant Resolve] ✅ Tier 2: Found variant ${skuRecs[0].shopify_variant_id} for product ${newProduct.id} (no size filter) via product_skus`);
        return {
          variantId: parseInt(skuRecs[0].shopify_variant_id, 10),
          resolvedSize: skuRecs[0].size || normalizedSize || null,
          resolvedSku: skuRecs[0].sku || newProduct.sku,
          variantPrice: null,
        };
      }
    } catch (_) {}
  }

  // ── Tier 3: product_skus table by SKU ──
  if (newProduct?.sku) {
    try {
      const skuRecs: any[] = await prisma.$queryRawUnsafe(
        `SELECT shopify_variant_id, sku, size FROM product_skus WHERE UPPER(sku) = $1 AND shopify_variant_id IS NOT NULL LIMIT 1`,
        newProduct.sku.trim().toUpperCase()
      );
      if (skuRecs?.[0]?.shopify_variant_id) {
        console.log(`[Variant Resolve] ✅ Tier 3: Found variant ${skuRecs[0].shopify_variant_id} by SKU ${newProduct.sku} via product_skus`);
        return {
          variantId: parseInt(skuRecs[0].shopify_variant_id, 10),
          resolvedSize: skuRecs[0].size || normalizedSize || null,
          resolvedSku: skuRecs[0].sku || newProduct.sku,
          variantPrice: null,
        };
      }
    } catch (_) {}
  }

  // ── Tier 4: Shopify Admin API — fetch product variants, match by size ──
  if (shopifyProductId) {
    try {
      const productData = await shopifyFetch<{ product: any }>(`products/${shopifyProductId}.json`);
      const variants = productData?.product?.variants || [];

      if (variants.length > 0) {
        let matched = null;

        // Try exact match on size against variant title, option1, option2
        if (normalizedSize) {
          matched = variants.find((v: any) =>
            (v.title || '').trim().toUpperCase() === normalizedSize ||
            (v.option1 || '').trim().toUpperCase() === normalizedSize ||
            (v.option2 || '').trim().toUpperCase() === normalizedSize
          );
        }

        // Try matching by newVariantTitle (e.g., "Size: M" → "M")
        if (!matched && newVariantTitle) {
          const normalizedVariant = newVariantTitle.replace(/^Size:\s*/i, '').trim().toUpperCase();
          matched = variants.find((v: any) =>
            (v.title || '').trim().toUpperCase() === normalizedVariant ||
            (v.option1 || '').trim().toUpperCase() === normalizedVariant
          );
        }

        if (matched) {
          console.log(`[Variant Resolve] ✅ Tier 4: Found variant ${matched.id} for Shopify product ${shopifyProductId} size ${normalizedSize} via Shopify API`);
          return {
            variantId: matched.id,
            resolvedSize: matched.option1 || matched.title || normalizedSize,
            resolvedSku: matched.sku || newProduct.sku,
            variantPrice: matched.price || null,
          };
        }

        // ── Tier 5: Use first variant from Shopify — ensures we NEVER create a custom item ──
        // This is safe: the product already exists in the catalog, we just couldn't match the exact size.
        // Better to use the first available variant of the correct product than to create a brand new custom item.
        const firstVariant = variants[0];
        console.log(`[Variant Resolve] ⚠️ Tier 5: Using first variant ${firstVariant.id} of Shopify product ${shopifyProductId} (exact size "${normalizedSize}" not matched, using "${firstVariant.option1 || firstVariant.title}")`);
        return {
          variantId: firstVariant.id,
          resolvedSize: firstVariant.option1 || firstVariant.title || normalizedSize,
          resolvedSku: firstVariant.sku || newProduct.sku,
          variantPrice: firstVariant.price || null,
        };
      }
    } catch (err: any) {
      console.error(`[Variant Resolve] Shopify product fetch failed for ${shopifyProductId}:`, err.message);
    }
  }

  // If we reach here, we have NO variant_id at all — this should be very rare
  // (product doesn't exist in product_skus AND Shopify API failed/returned empty)
  console.error(`[Variant Resolve] ❌ CRITICAL: Could not resolve ANY variant_id for product ${newProduct?.id} (Shopify: ${shopifyProductId}) size: ${normalizedSize}. Order will be created without variant_id as last resort.`);
  return { variantId: null, resolvedSize: normalizedSize || null, resolvedSku: newProduct?.sku || null, variantPrice: null };
}

export type CreateReplacementResult =
  | {
      success: true;
      shopifyOrderId: string | null;
      shopifyOrderName?: string | null;
      replacementDisplayId: string;
      exchangeDisplayId: string;
      localOrderId: string;
      forwardAwb: string | null;
      storeCreditIssued: number;
      message?: string;
      exchangeRequest: any;
    }
  | { success: false; error: string; status?: number };

/**
 * Creates the G_E_ replacement Shopify+local order after exchange QC pass.
 * Shared by the create-order API and auto-create-on-receive.
 */
export async function createExchangeReplacementOrder(id: string): Promise<CreateReplacementResult> {
  try {
    const exchangeRequest = await prisma.exchangeRequest.findUnique({
      where: { id },
      include: {
        exchanges: {
          include: { newProduct: true, originalProduct: true }
        },
        order: {
          include: { customer: true, shop: true, items: true }
        }
      }
    });

    if (!exchangeRequest) {
      return { success: false, error: "Exchange request not found", status: 404 };
    }

    // Idempotency check: if order already created, return existing
    if (exchangeRequest.status === "new_order_created" && exchangeRequest.newShopifyOrderId) {
      const existingOrder = await prisma.order.findUnique({
        where: { shopifyOrderId: exchangeRequest.newShopifyOrderId }
      });
      return {
        success: true,
        message: "Order already created for this exchange",
        shopifyOrderId: exchangeRequest.newShopifyOrderId,
        shopifyOrderName: null,
        replacementDisplayId: exchangeRequest.replacementDisplayId || `G_${exchangeRequest.displayId || 'E'}`,
        exchangeDisplayId: exchangeRequest.displayId || '',
        localOrderId: existingOrder?.id || '',
        forwardAwb: null,
        storeCreditIssued: 0,
        exchangeRequest,
      };
    }

    if (!["qc_passed", "received"].includes(exchangeRequest.status)) {
      return {
        success: false,
        error: `The exchange parcel must be received (and pass QC) before the replacement order is created. Current status: ${exchangeRequest.status}`,
        status: 400,
      };
    }

    // Atomic claim: prevent concurrent order creation attempts
    const claim = await prisma.exchangeRequest.updateMany({
      where: {
        id,
        newShopifyOrderId: null,
        status: { in: ["qc_passed", "received"] }
      },
      data: {
        status: "creating_order"
      }
    });

    if (claim.count === 0) {
      const current = await prisma.exchangeRequest.findUnique({ where: { id } });
      if (current?.status === "new_order_created" && current.newShopifyOrderId) {
        const existingOrder = await prisma.order.findUnique({
          where: { shopifyOrderId: current.newShopifyOrderId }
        });
        return {
          success: true,
          message: "Order already created for this exchange",
          shopifyOrderId: current.newShopifyOrderId,
          shopifyOrderName: null,
          replacementDisplayId: current.replacementDisplayId || `G_${current.displayId || 'E'}`,
          exchangeDisplayId: current.displayId || '',
          localOrderId: existingOrder?.id || '',
          forwardAwb: null,
          storeCreditIssued: 0,
          exchangeRequest: current,
        };
      }
      return {
        success: false,
        error: `Exchange order creation is already in progress or exchange is not ready (status: ${current?.status || "unknown"}).`,
        status: 409,
      };
    }

    // Linked ids: E_<order> for the exchange (backfilled for legacy rows) and
    // G_E_<order> for the replacement order/shipment created from it.
    let exchangeDisplayId = exchangeRequest.displayId;
    if (!exchangeDisplayId) {
      exchangeDisplayId = await allocateLinkedId(prisma as any, 'exchange', exchangeRequest.order);
      await prisma.exchangeRequest.update({ where: { id }, data: { displayId: exchangeDisplayId } });
    }
    const replacementDisplayId = exchangeRequest.replacementDisplayId || replacementIdForExchange(exchangeDisplayId);

    const priceDiff = exchangeRequest.priceDifference || 0;
    const isCod = exchangeRequest.settlementPreference === "COD_ON_DELIVERY" && priceDiff > 0;
    const isNegativeDiff = priceDiff < 0;
    const negativeDiffAmount = Math.abs(priceDiff);

    // Determine the financial status for Shopify:
    // - priceDiff <= 0: No payment needed → "paid" (prevents "Payment Processing" in Shopify)
    // - priceDiff > 0 with prepaid: Customer already paid → "paid"
    // - priceDiff > 0 with COD: Payment on delivery → "pending"
    let shopifyFinancialStatus = "paid";
    let paymentStatus = "free";

    if (priceDiff > 0) {
      if (isCod) {
        shopifyFinancialStatus = "pending";
        paymentStatus = "cod_pending";
      } else {
        shopifyFinancialStatus = "paid";
        paymentStatus = "paid";
      }
    }

    // The order total: for same-price/cheaper exchanges, Shopify total should be 0
    // For more expensive exchanges, it should be the price difference
    const orderTotalAmount = priceDiff > 0 ? priceDiff : 0;

    // Build the Shopify order payload
    const customer = exchangeRequest.order.customer;
    let shippingAddress: any = null;
    try {
      shippingAddress = exchangeRequest.order.shippingAddress 
        ? JSON.parse(exchangeRequest.order.shippingAddress)
        : null;
    } catch (_) {}

    // Resolve variant IDs and build line items with correct variants and prices
    const lineItems: any[] = [];
    const resolvedVariants: { variantId: number | null; resolvedSize: string | null; resolvedSku: string | null }[] = [];

    for (const ex of exchangeRequest.exchanges as any[]) {
      const newProduct = ex.newProduct;
      const exchangeSize = ex.newSize || ex.newVariantTitle?.replace(/^Size:\s*/i, '').trim() || null;

      // Resolve the correct Shopify variant_id for this exchange item
      const variantResult = await resolveShopifyVariantId(newProduct, exchangeSize, ex.newVariantTitle);
      resolvedVariants.push(variantResult);

      // Use the actual product price for the line item
      const actualProductPrice = variantResult.variantPrice
        ? parseFloat(variantResult.variantPrice)
        : (newProduct?.price || 0);

      const lineItem: any = {
        quantity: 1,
        requires_shipping: true,
      };

      if (variantResult.variantId) {
        // Use variant_id — Shopify will auto-resolve title, sku, price from the variant
        lineItem.variant_id = variantResult.variantId;
        // Override price: for zero-cost exchanges, set price to 0
        lineItem.price = priceDiff <= 0 ? "0.00" : actualProductPrice.toFixed(2);
      } else {
        // Fallback: include product_id if available so Shopify attaches line item to existing catalog product
        if (newProduct?.shopifyProductId) {
          lineItem.product_id = parseInt(newProduct.shopifyProductId, 10);
        }
        lineItem.title = newProduct?.title || "Exchange Replacement";
        lineItem.sku = variantResult.resolvedSku || newProduct?.sku || "";
        lineItem.price = priceDiff <= 0 ? "0.00" : actualProductPrice.toFixed(2);
        console.warn(`[Exchange Create Order] No variant_id resolved for product "${newProduct?.title}", falling back to product_id/title/sku`);
      }

      lineItems.push(lineItem);
    }

    // Calculate the total discount if this is a same-price or cheaper exchange
    // When priceDiff <= 0, we discount the full product price so the order total is 0
    let totalDiscount = "0.00";
    if (priceDiff <= 0) {
      // All items priced at 0, no discount needed
      totalDiscount = "0.00";
    } else if (priceDiff > 0) {
      // Customer pays the difference — items are at actual price,
      // apply discount to reduce total to just the price difference
      const totalItemPrices = lineItems.reduce((sum: number, li: any) => sum + parseFloat(li.price || '0'), 0);
      const discountAmount = totalItemPrices - priceDiff;
      if (discountAmount > 0) {
        totalDiscount = discountAmount.toFixed(2);
      }
    }

    const shopifyOrderPayload: any = {
      line_items: lineItems,
      financial_status: shopifyFinancialStatus,
      fulfillment_status: null,
      inventory_behaviour: "decrement_ignoring_policy",
      note: `Exchange replacement ${replacementDisplayId} (${exchangeDisplayId}) for original order #${exchangeRequest.order.internalOrderNumber || exchangeRequest.order.shopifyOrderId || exchangeRequest.orderId}. Settlement: ${exchangeRequest.settlementPreference}. Size: ${resolvedVariants.map(v => v.resolvedSize || 'N/A').join(', ')}`,
      tags: `exchange,exchange-order,${replacementDisplayId},original-order-${exchangeRequest.order.shopifyOrderId || exchangeRequest.orderId}${isCod ? ',COD' : ''}`,
      total_discounts: totalDiscount,
      send_receipt: true,
      send_fulfillment_receipt: true,
      source_identifier: `exchange-${exchangeRequest.id}`,
    };

    if (customer?.shopifyId) {
      shopifyOrderPayload.customer = { id: parseInt(customer.shopifyId, 10) };
    } else if (customer?.email) {
      shopifyOrderPayload.email = customer.email;
    }

    if (shippingAddress && typeof shippingAddress === 'object') {
      shopifyOrderPayload.shipping_address = shippingAddress;
    }

    if (process.env.LOGISTICS_DEBUG === '1') {
      console.log(`[Exchange Create Order] line_items=${shopifyOrderPayload.line_items?.length || 0}`);
    }

    let shopifyOrder: any = null;
    let shopifyOrderId: string | null = null;

    try {
      shopifyOrder = await createOrder(shopifyOrderPayload, {
        idempotencyKey: `exchange-${exchangeRequest.id}`
      });
      shopifyOrderId = shopifyOrder?.id?.toString() || shopifyOrder?.name || null;
      console.log(`✅ Shopify exchange order created: ${shopifyOrderId} (Name: ${shopifyOrder?.name})`);
    } catch (shopifyError: any) {
      console.error("⚠️ Shopify order creation failed:", shopifyError.message);
      // Rollback claimed status
      await prisma.exchangeRequest.update({
        where: { id },
        data: { status: exchangeRequest.status }
      });
      return {
        success: false,
        error: `Shopify order creation failed: ${shopifyError.message}. Please verify product availability before retrying.`,
        status: 502,
      };
    }

    if (!shopifyOrderId) {
      await prisma.exchangeRequest.update({
        where: { id },
        data: { status: exchangeRequest.status }
      });
      return { success: false, error: "Shopify order creation returned no order ID.", status: 500 };
    }

    // Execute local order creation, exchange status update, and store credit issuance transactionally
    const result = await prisma.$transaction(async (tx: any) => {
      const newItems = (shopifyOrder.line_items || []).map((li: any, idx: number) => {
        const matchingEx = exchangeRequest.exchanges[idx] || exchangeRequest.exchanges.find((ex: any) => ex.newProduct?.sku === li.sku);
        return {
          shopifyLineItemId: li.id?.toString() || `EXC-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          productId: matchingEx?.newProductId || null,
          title: li.title || "Exchange Replacement",
          quantity: li.quantity || 1,
          price: parseFloat(li.price || '0'),
          sku: li.sku || "",
          variantTitle: li.variant_title || resolvedVariants[idx]?.resolvedSize || null,
          size: resolvedVariants[idx]?.resolvedSize || null,
        };
      });

      // 1. Local Order creation
      const localOrder = await tx.order.create({
        data: {
          shopId: exchangeRequest.order.shopId,
          shopifyOrderId: shopifyOrderId,
          internalOrderNumber: replacementDisplayId,
          customerId: exchangeRequest.customerId,
          status: "confirmed",
          orderType: "EXCHANGE",
          tags: `exchange,${replacementDisplayId}${isCod ? ',COD' : ''}`,
          totalPrice: orderTotalAmount,
          paymentStatus: paymentStatus,
          fulfillmentStatus: "unfulfilled",
          shippingAddress: exchangeRequest.order.shippingAddress,
          billingAddress: exchangeRequest.order.billingAddress,
          note: `Exchange replacement ${replacementDisplayId} (${exchangeDisplayId}) for original order #${exchangeRequest.order.internalOrderNumber || exchangeRequest.order.shopifyOrderId}`,
          items: {
            create: newItems
          }
        }
      });

      // 2. Issue Store Credit for negative difference if applicable
      let storeCreditRecord = null;
      if (isNegativeDiff && negativeDiffAmount > 0) {
        storeCreditRecord = await tx.storeCredit.create({
          data: {
            customerId: exchangeRequest.customerId,
            amount: negativeDiffAmount,
            type: "exchange_adjustment",
            description: `Store credit issued for exchange adjustment on order #${exchangeRequest.order.shopifyOrderId || exchangeRequest.orderId}`,
            orderId: localOrder.id,
            remainingAmount: negativeDiffAmount,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1-year expiry
          }
        });

        await tx.customer.update({
          where: { id: exchangeRequest.customerId },
          data: {
            storeCredits: {
              increment: negativeDiffAmount
            }
          }
        });
      }

      // 3. Update ExchangeRequest status
      const updatedRequest = await tx.exchangeRequest.update({
        where: { id },
        data: {
          status: "new_order_created",
          newShopifyOrderId: shopifyOrderId,
          replacementDisplayId,
          replacementOrderId: localOrder.id,
        }
      });

      // 4. Update individual exchange items
      await tx.exchange.updateMany({
        where: { exchangeRequestId: id },
        data: {
          status: "NEW_ORDER_CREATED",
          newOrderId: localOrder.id,
        }
      });

      return {
        updatedRequest,
        localOrderId: localOrder.id,
        storeCreditIssued: negativeDiffAmount
      };
    });

    // 5. Create Forward Delhivery Shipment for the replacement order
    // Replacement dispatch is booked from the order page via Shiprocket (ops chooses courier + parcel).
    let forwardAwb: string | null = null;

    // 6. Send WhatsApp notification with REAL forward AWB and tracking URL
    try {
      const { sendExchangeShipped } = await import('@/lib/whatsapp/templates');
      let phone = customer?.phone;
      if (!phone && exchangeRequest.order.shippingAddress) {
        try {
          const parsed = typeof exchangeRequest.order.shippingAddress === 'string'
            ? JSON.parse(exchangeRequest.order.shippingAddress)
            : exchangeRequest.order.shippingAddress;
          phone = parsed?.phone;
        } catch (_) {}
      }
      // Only announce the dispatch once a real AWB exists.
      if (phone && forwardAwb) {
        const orderIdDisplay = replacementDisplayId;
        const customerName = customer?.name || 'Valued Customer';
        await sendExchangeShipped({
          phone,
          customerName,
          orderId: orderIdDisplay,
          trackingNumber: forwardAwb || shopifyOrderId || 'N/A',
          trackingUrl: forwardAwb ? `https://shiprocket.co/tracking/${forwardAwb}` : `https://app.zicabella.com/orders/${shopifyOrderId}`,
        });
      }
    } catch (waErr: any) {
      console.error('[Exchange Create Order] WhatsApp notification error:', waErr.message);
    }

    return {
      success: true,
      shopifyOrderId,
      shopifyOrderName: shopifyOrder?.name || null,
      replacementDisplayId,
      exchangeDisplayId,
      localOrderId: result.localOrderId,
      forwardAwb,
      storeCreditIssued: result.storeCreditIssued,
      exchangeRequest: result.updatedRequest,
    };
  } catch (error: any) {
    console.error("Create Exchange Replacement Order Error:", error);
    return { success: false, error: error.message || 'Failed to create replacement order', status: 500 };
  }
}
