/**
 * Zica AI support mutations: address, phone, size, tracking.
 *
 * Rules:
 * - Address / phone / size may change only BEFORE an AWB exists.
 * - Tracking is always allowed (read-only).
 * - Updates persist to dashboard (Order + WebStoreOrder + Customer), then
 *   best-effort Shopify and Shiprocket (pre-AWB shipment draft only).
 */

import prisma from '@/lib/db';
import { getPhoneLast10 } from '@/lib/db';
import { toE164 } from '@/lib/shopify-phone';
import { normalizeOrderShippingAddress } from '@/lib/order-shipping-address';
import { resolveOutboundShipment, getOrderTracking } from '@/lib/services/orderTracking';
import { parseShiprocketMeta, updateShiprocketOrderConsignee } from '@/lib/services/logistics';
import { fetchProductById, updateShopifyOrderAddress, shopifyGraphqlFetch } from '@/lib/shopify-admin';
import type { Principal } from '@/lib/ai/principal';
import { AWB_LOCK_MESSAGE, indianMobileOk, pinOk, normalizeSize, isAwbLocked } from './aiSupportMutationRules';

function shopifyNumericId(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 6 ? digits : null;
}

async function findOwnedOrder(orderNumber: string, principal: Principal) {
  const searchTerm = String(orderNumber || '').trim();
  if (!searchTerm) return { error: 'order_number is required' as const };

  if (principal.kind === 'guest' && !principal.email && !principal.phone) {
    return { error: 'Please share the email or phone on the order, or sign in, so I can look it up.' as const };
  }

  const whereConditions: any[] = [
    { internalOrderNumber: searchTerm },
    { internalOrderNumber: { contains: searchTerm, mode: 'insensitive' } },
    { previousOrderNumbers: { contains: searchTerm, mode: 'insensitive' } },
    { shopifyOrderName: searchTerm },
    { shopifyOrderName: { contains: searchTerm, mode: 'insensitive' } },
    { shopifyOrderId: searchTerm },
  ];

  if (/^\d+$/.test(searchTerm)) {
    whereConditions.push(
      { internalOrderNumber: `ZB${searchTerm}` },
      { internalOrderNumber: `ZBPF${searchTerm}` },
      { internalOrderNumber: `ZBPP${searchTerm}` },
      { shopifyOrderName: `#ZB${searchTerm}` }
    );
  }
  if (searchTerm.startsWith('#')) {
    whereConditions.push({ shopifyOrderName: searchTerm.slice(1), internalOrderNumber: searchTerm.slice(1) });
  } else {
    whereConditions.push({ shopifyOrderName: `#${searchTerm}` });
  }

  const baseWhere: any = { OR: whereConditions };
  if (principal.kind === 'customer') {
    baseWhere.customerId = principal.customerId;
  }

  const order = await prisma.order.findFirst({
    where: baseWhere,
    include: {
      items: true,
      customer: { select: { id: true, name: true, email: true, phone: true, shopifyId: true } },
      shipments: { orderBy: { createdAt: 'desc' }, take: 8 },
    },
  });

  if (!order) {
    return { error: `I could not find an order matching "${searchTerm}" on this account. Please double-check the order number.` as const };
  }

  if (principal.kind === 'guest') {
    const last10 = (principal.phone || '').replace(/\D/g, '').slice(-10);
    const email = (principal.email || '').trim().toLowerCase();
    const addr = String(order.shippingAddress || '').toLowerCase();
    const custEmail = String(order.customer?.email || '').toLowerCase();
    const custPhone = String(order.customer?.phone || '').replace(/\D/g, '');
    const phoneOk = last10.length === 10 && (custPhone.endsWith(last10) || addr.includes(last10));
    const emailOk = Boolean(email) && (custEmail === email || addr.includes(email));
    if (!phoneOk && !emailOk) {
      return { error: 'I found that order number but the email/phone does not match. Please share the phone or email used at checkout.' as const };
    }
  }
  return { order };
}

async function assertPreAwb(order: { id: string; delhivery_awb?: string | null }) {
  const resolved = await resolveOutboundShipment(order.id, order.delhivery_awb);
  if (isAwbLocked(resolved.awb, resolved.awbPending)) {
    return { locked: true as const, awb: resolved.awb, message: AWB_LOCK_MESSAGE };
  }
  return { locked: false as const, awb: null as string | null, message: null as string | null };
}

async function syncShopifyAddress(order: {
  shopifyOrderId?: string | null;
  customer?: { shopifyId?: string | null } | null;
}, addr: ReturnType<typeof normalizeOrderShippingAddress>) {
  const sid = shopifyNumericId(order.shopifyOrderId);
  if (!sid) return { synced: false, reason: 'no_shopify_order' as const };
  const nameParts = addr.name.trim().split(/\s+/).filter(Boolean);
  try {
    await updateShopifyOrderAddress(sid, {
      first_name: nameParts[0] || 'Customer',
      last_name: nameParts.slice(1).join(' ') || '.',
      address1: addr.address1,
      address2: addr.address2 || undefined,
      city: addr.city,
      province: addr.province,
      zip: addr.zip,
      country: addr.country || 'India',
      phone: addr.phone || undefined,
    });
    return { synced: true as const };
  } catch (err: any) {
    console.warn('[AI Support] Shopify address sync failed:', err?.message || err);
    return { synced: false as const, reason: String(err?.message || err) };
  }
}

async function syncShiprocketAddress(order: {
  id: string;
  shipments?: Array<{ awb?: string | null; trackingNumber?: string | null; rawDelhiveryResponse?: string | null; status?: string | null }>;
}, addr: ReturnType<typeof normalizeOrderShippingAddress>) {
  const draft = (order.shipments || []).find((s) => {
    const meta = parseShiprocketMeta(s.rawDelhiveryResponse);
    return Boolean(meta?.order_id) && !s.awb;
  });
  const meta = draft ? parseShiprocketMeta(draft.rawDelhiveryResponse) : null;
  if (!meta?.order_id) return { synced: false as const, reason: 'no_shiprocket_draft' as const };

  return updateShiprocketOrderConsignee({
    shiprocketOrderId: meta.order_id,
    name: addr.name,
    address1: addr.address1,
    address2: addr.address2,
    city: addr.city,
    state: addr.province,
    zip: addr.zip,
    country: addr.country,
    phone: addr.phone,
    email: addr.email,
  });
}

async function persistLocalAddress(order: any, addr: ReturnType<typeof normalizeOrderShippingAddress>) {
  const payload = {
    name: addr.name,
    phone: addr.phone,
    email: addr.email,
    address1: addr.address1,
    address2: addr.address2,
    city: addr.city,
    province: addr.province,
    state: addr.state,
    zip: addr.zip,
    pincode: addr.pincode,
    country: addr.country,
    street: addr.street,
  };

  await prisma.order.update({
    where: { id: order.id },
    data: {
      shippingAddress: JSON.stringify(payload),
      billingAddress: JSON.stringify(payload),
    },
  });

  if (order.customerId) {
    await prisma.customer.update({
      where: { id: order.customerId },
      data: {
        ...(addr.phone ? { phone: addr.phone, phoneLast10: getPhoneLast10(addr.phone) } : {}),
        defaultAddress: [addr.address1, addr.city, addr.province, addr.zip].filter(Boolean).join(', '),
      },
    }).catch(() => {});
  }

  const wsWhere: any[] = [];
  if (order.internalOrderNumber) wsWhere.push({ orderNumber: order.internalOrderNumber });
  if (order.razorpayOrderId) wsWhere.push({ razorpayOrderId: order.razorpayOrderId });
  if (wsWhere.length) {
    await prisma.webStoreOrder.updateMany({
      where: { OR: wsWhere },
      data: {
        ...(addr.phone ? { customerPhone: addr.phone, phoneLast10: getPhoneLast10(addr.phone) } : {}),
        ...(addr.name ? { customerName: addr.name } : {}),
        shippingAddress: payload as any,
      },
    }).catch(() => {});
  }
}

export async function updateOrderAddressForAI(
  input: {
    order_number: string;
    name?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    landmark?: string;
  },
  principal: Principal
): Promise<string> {
  const found = await findOwnedOrder(input.order_number, principal);
  if ('error' in found) return JSON.stringify({ error: found.error });
  const { order } = found;

  const lock = await assertPreAwb(order);
  if (lock.locked) {
    return JSON.stringify({ error: lock.message, awb: lock.awb, change_allowed: false });
  }

  const current = normalizeOrderShippingAddress(order.shippingAddress, {
    name: order.customer?.name,
    phone: order.customer?.phone,
    email: order.customer?.email,
  });

  const next = normalizeOrderShippingAddress(
    {
      name: input.name || current.name,
      phone: input.phone || current.phone,
      email: current.email,
      address1: input.address1 || current.address1,
      address2: input.address2 || current.address2,
      city: input.city || current.city,
      state: input.state || current.province,
      pincode: input.pincode || current.zip,
      landmark: input.landmark,
    },
    { name: current.name, phone: current.phone, email: current.email }
  );

  const missing: string[] = [];
  if (!next.name) missing.push('full name');
  if (!next.address1 || next.address1.length < 8) missing.push('complete street address');
  if (!next.city) missing.push('city');
  if (!next.province) missing.push('state');
  if (!pinOk(next.zip)) missing.push('6-digit pincode');
  if (!indianMobileOk(next.phone)) missing.push('10-digit Indian mobile number');

  if (missing.length) {
    return JSON.stringify({
      error: `I still need a complete address before I can update the order. Missing: ${missing.join(', ')}.`,
      needs: missing,
      change_allowed: true,
    });
  }

  const e164 = toE164(next.phone, 'IN');
  if (e164) next.phone = e164;

  await persistLocalAddress(order, next);
  const shopify = await syncShopifyAddress(order, next);
  const shiprocket = await syncShiprocketAddress(order, next);

  return JSON.stringify({
    success: true,
    change_allowed: true,
    order_number: order.internalOrderNumber || order.shopifyOrderName,
    updated: {
      name: next.name,
      phone: next.phone,
      address: [next.address1, next.address2, next.city, next.province, next.zip, next.country].filter(Boolean).join(', '),
    },
    shopify_synced: Boolean(shopify.synced),
    shiprocket_synced: Boolean((shiprocket as any).success),
    message: 'Address and phone updated on the order. This will be used when the shipment AWB is generated.',
  });
}

export async function updateOrderPhoneForAI(
  input: { order_number: string; phone: string },
  principal: Principal
): Promise<string> {
  if (!indianMobileOk(input.phone || '')) {
    return JSON.stringify({
      error: 'Please share a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
      change_allowed: true,
    });
  }
  return updateOrderAddressForAI({ order_number: input.order_number, phone: input.phone }, principal);
}

async function resolveVariantForSize(item: any, newSize: string) {
  const size = normalizeSize(newSize);
  if (!item.productId) return { error: 'This line has no linked product, so size cannot be changed automatically.' };

  const dbProduct = await prisma.product.findFirst({
    where: { OR: [{ id: item.productId }, { shopifyProductId: String(item.productId) }] },
  });
  const shopifyProductId = dbProduct?.shopifyProductId || item.productId;
  if (!shopifyProductId) return { error: 'Product is not linked to Shopify.' };

  const cleanSpId = String(shopifyProductId).replace(/^gid:\/\/shopify\/Product\//, '');
  const sp = await fetchProductById(cleanSpId);
  if (!sp?.variants?.length) return { error: 'I could not load available sizes for this product.' };

  const matching = sp.variants.find((v: any) => {
    const title = String(v.title || '').toUpperCase().trim();
    const opt = String(v.option1 || '').toUpperCase().trim();
    const sku = String(v.sku || '').toUpperCase().trim();
    return title === size || opt === size || sku.endsWith(`-${size}`) || sku === size;
  });

  if (!matching) {
    const available = sp.variants
      .map((v: any) => String(v.option1 || v.title || '').trim())
      .filter(Boolean);
    return {
      error: `Size ${size} is not available for ${item.title}. Available sizes: ${available.join(', ') || 'none listed'}.`,
      available_sizes: available,
    };
  }

  const inventory = Number(matching.inventory_quantity ?? 0);
  if (Number.isFinite(inventory) && inventory <= 0) {
    return { error: `Size ${size} is currently out of stock for ${item.title}.` };
  }

  return {
    variantId: String(matching.id),
    variantGid: `gid://shopify/ProductVariant/${String(matching.id).replace(/\D/g, '')}`,
    sku: matching.sku || item.sku,
    size,
    title: matching.title || size,
  };
}

async function shopifyReplaceLineVariant(order: any, item: any, variantGid: string, quantity: number) {
  const sid = shopifyNumericId(order.shopifyOrderId);
  if (!sid) return { synced: false as const, reason: 'no_shopify_order' };

  const shopifyOrderGid = `gid://shopify/Order/${sid}`;
  const beginRes: any = await shopifyGraphqlFetch(
    `mutation orderEditBegin($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder {
          id
          lineItems(first: 50) { edges { node { id variant { id } } } }
        }
        userErrors { field message }
      }
    }`,
    { id: shopifyOrderGid }
  );
  const beginErrors = beginRes?.orderEditBegin?.userErrors || [];
  if (beginErrors.length) throw new Error(beginErrors.map((e: any) => e.message).join(', '));
  const calculated = beginRes?.orderEditBegin?.calculatedOrder;
  if (!calculated?.id) throw new Error('Failed to begin Shopify order edit');

  const oldId = String(item.shopifyLineItemId || '');
  const edges = calculated.lineItems?.edges || [];
  const match = edges.find((e: any) => e.node.id === oldId || e.node.id.includes(oldId) || e.node.variant?.id?.includes(String(item.variantId || '')));
  const calcLineItemId = match?.node?.id || (edges.length === 1 ? edges[0].node.id : null);

  if (calcLineItemId) {
    await shopifyGraphqlFetch(
      `mutation orderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
          userErrors { field message }
        }
      }`,
      { id: calculated.id, lineItemId: calcLineItemId, quantity: 0 }
    );
  }

  const addRes: any = await shopifyGraphqlFetch(
    `mutation orderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
      orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
        calculatedLineItem { id }
        userErrors { field message }
      }
    }`,
    { id: calculated.id, variantId: variantGid, quantity }
  );
  const addErrors = addRes?.orderEditAddVariant?.userErrors || [];
  if (addErrors.length) throw new Error(addErrors.map((e: any) => e.message).join(', '));

  const commitRes: any = await shopifyGraphqlFetch(
    `mutation orderEditCommit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
      orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
        order { id }
        userErrors { field message }
      }
    }`,
    { id: calculated.id, notifyCustomer: false, staffNote: 'Size change by Zica AI (pre-AWB)' }
  );
  const commitErrors = commitRes?.orderEditCommit?.userErrors || [];
  if (commitErrors.length) throw new Error(commitErrors.map((e: any) => e.message).join(', '));
  return { synced: true as const };
}

export async function updateOrderSizeForAI(
  input: { order_number: string; new_size: string; product_title?: string; item_id?: string },
  principal: Principal
): Promise<string> {
  const found = await findOwnedOrder(input.order_number, principal);
  if ('error' in found) return JSON.stringify({ error: found.error });
  const { order } = found;

  const lock = await assertPreAwb(order);
  if (lock.locked) {
    return JSON.stringify({ error: lock.message, awb: lock.awb, change_allowed: false });
  }

  const newSize = normalizeSize(input.new_size);
  if (!newSize) {
    return JSON.stringify({ error: 'Please tell me the new size (for example S, M, L, XL, 30, 32).', change_allowed: true });
  }

  let item = order.items[0];
  if (input.item_id) {
    item = order.items.find((i: any) => i.id === input.item_id) || item;
  } else if (input.product_title && order.items.length > 1) {
    const q = input.product_title.toLowerCase();
    item = order.items.find((i: any) => String(i.title || '').toLowerCase().includes(q)) || item;
  }

  if (!item) return JSON.stringify({ error: 'This order has no items to change.' });

  if (order.items.length > 1 && !input.product_title && !input.item_id) {
    return JSON.stringify({
      error: 'This order has more than one item. Please tell me which product to change.',
      items: order.items.map((i: any) => ({ title: i.title, current_size: i.size || i.variantTitle })),
      change_allowed: true,
    });
  }

  const resolved = await resolveVariantForSize(item, newSize);
  if ('error' in resolved) {
    return JSON.stringify({ ...resolved, change_allowed: true });
  }

  await prisma.orderItem.update({
    where: { id: item.id },
    data: {
      size: resolved.size,
      variantTitle: `Size: ${resolved.size}`,
      variantId: resolved.variantId,
      sku: resolved.sku || item.sku,
    },
  });

  let shopifySynced = false;
  try {
    const shopify = await shopifyReplaceLineVariant(order, item, resolved.variantGid, item.quantity || 1);
    shopifySynced = Boolean(shopify.synced);
  } catch (err: any) {
    console.warn('[AI Support] Shopify size edit failed:', err?.message || err);
  }

  return JSON.stringify({
    success: true,
    change_allowed: true,
    order_number: order.internalOrderNumber || order.shopifyOrderName,
    product: item.title,
    previous_size: item.size || item.variantTitle,
    new_size: resolved.size,
    shopify_synced: shopifySynced,
    message: `Size updated to ${resolved.size} for ${item.title}. This will be packed when AWB is generated.`,
  });
}

export async function getOrderTrackingForAI(
  input: { order_number: string },
  principal: Principal
): Promise<string> {
  const found = await findOwnedOrder(input.order_number, principal);
  if ('error' in found) return JSON.stringify({ error: found.error });
  const { order } = found;

  const tracking = await getOrderTracking({
    id: order.id,
    delhivery_awb: order.delhivery_awb,
    tracking_status: order.tracking_status,
    createdAt: order.createdAt,
  });

  if (!tracking.awb && !tracking.awbPending) {
    return JSON.stringify({
      success: true,
      order_number: order.internalOrderNumber || order.shopifyOrderName,
      status: order.deliveryStatus || order.status,
      awb: null,
      message: 'Your order is confirmed and is being prepared. A tracking number (AWB) has not been generated yet. I will share tracking as soon as the shipment is booked.',
    });
  }

  if (tracking.awbPending) {
    return JSON.stringify({
      success: true,
      order_number: order.internalOrderNumber || order.shopifyOrderName,
      status: tracking.currentStatus,
      awb: null,
      message: 'Shipment is booked with the courier. AWB is being assigned. Tracking will be available shortly.',
    });
  }

  return JSON.stringify({
    success: true,
    order_number: order.internalOrderNumber || order.shopifyOrderName,
    awb: tracking.awb,
    courier: tracking.courier,
    status: tracking.currentStatus,
    location: tracking.location,
    estimated_delivery: tracking.estimatedDelivery,
    tracking_url: tracking.trackingUrl,
    timeline: (tracking.timeline || []).slice(0, 6),
    message: tracking.awb
      ? `Your order is ${tracking.currentStatus || 'in transit'}. AWB ${tracking.awb}${tracking.courier ? ` via ${tracking.courier}` : ''}.${tracking.trackingUrl ? ` Track here: ${tracking.trackingUrl}` : ''}`
      : 'Tracking is not available yet.',
  });
}
