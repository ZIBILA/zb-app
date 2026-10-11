/**
 * WhatsApp Template Sender Functions with Opt-In Compliance Enforcement
 * Location: lib/whatsapp/templates.js
 *
 * Each sender function constructs the exact `components` array matching
 * the Meta-approved template structure (header, body, buttons) and
 * delegates to `sendAndLog` which handles consent checks and DB logging.
 *
 * Template reference (Meta WABA-approved as of 2026-07):
 *  ┌──────────────────────────────┬────────┬─────────────────────────┬──────────────────────────┐
 *  │ Template                     │ Header │ Body vars               │ Button                   │
 *  ├──────────────────────────────┼────────┼─────────────────────────┼──────────────────────────┤
 *  │ zica_cart_recovery_v1        │ IMAGE  │ {{1}} name              │ URL (static, no var)     │
 *  │ zica_order_confirmed_v1      │ IMAGE  │ {{1}} name, {{2}} order │ URL (static, no var)     │
 *  │ zica_order_delivered_v1      │ IMAGE  │ {{1}} name, {{2}} order │ URL (static, no var)     │
 *  │ zica_order_shipped           │ —      │ {{1}},{{2}},{{3}}       │ —                        │
 *  │ zb_cart_final                │ —      │ {{1}} name              │ URL with {{1}}           │
 *  │ zb_cart_followup             │ —      │ {{1}} name, {{2}} code  │ URL with {{1}}           │
 *  │ zb_order_tracking            │ —      │ {{1}} name, {{2}} order │ URL with {{1}}           │
 *  │ zica_cod_confirmation_v1     │ —      │ {{1}} name, {{2}} order │ QUICK_REPLY × 2          │
 *  └──────────────────────────────┴────────┴─────────────────────────┴──────────────────────────┘
 */

import { sendTemplate, formatPhone, uploadMediaFromUrl, listTemplates } from './client';
import { logMessage, getWhatsAppSetting } from './logger';
import prisma from '@/lib/db';

// ---------------------------------------------------------------------------
// Default product image used when no product-specific image is available
// ---------------------------------------------------------------------------
const FALLBACK_IMAGE_URL =
  'https://cdn.shopify.com/s/files/1/0955/5394/5881/files/zica-bella-logo_834c1ed2-2f09-4f73-bb9f-152a03f59ad2.png?v=1773354221';

// ---------------------------------------------------------------------------
// Consent / opt-in check
// ---------------------------------------------------------------------------

/**
 * Checks if a phone number is opted in for WhatsApp marketing messages.
 * Used for strict marketing consent (sale alerts, new collections, etc.).
 */
export async function isOptedIn(phone) {
  const formatted = formatPhone(phone);
  if (!formatted) return false;

  // 1. Check whatsapp_opt_ins table first
  try {
    const record = await prisma.whatsAppOptIn.findFirst({
      where: {
        OR: [
          { phone: formatted },
          { phone: { endsWith: formatted.slice(-10) } }
        ]
      }
    });
    if (record) {
      return record.status === 'opted_in';
    }
  } catch (err) {
    console.warn('[WhatsApp Consent Check] failed to query whatsapp_opt_ins:', err.message);
  }

  // 2. Fallback check to Customer / CommunityMember
  try {
    const customer = await prisma.customer.findFirst({
      where: {
        phone: {
          endsWith: formatted.slice(-10)
        }
      },
      include: {
        communityMember: true
      }
    });

    if (customer) {
      return !customer.whatsappOptedOut;
    }

    const member = await prisma.communityMember.findFirst({
      where: {
        phone: {
          endsWith: formatted.slice(-10)
        }
      }
    });

    return member ? member.whatsappOptIn !== false : true;
  } catch (err) {
    console.warn('[WhatsApp Consent Check] Fallback check failed:', err.message);
    return true; // Default to true to avoid blocking standard communications
  }
}

/**
 * Lenient consent check for cart recovery messages.
 * Only blocks users who have EXPLICITLY opted out (sent "STOP" via webhook
 * or actively unchecked opt-in). Users who never opted in or out are ALLOWED
 * through — providing a phone number during checkout constitutes implicit
 * consent for relevant transactional/cart recovery messages.
 *
 * This is distinct from isOptedIn() which requires an explicit opt-in record.
 */
export async function isExplicitlyOptedOut(phone) {
  const formatted = formatPhone(phone);
  if (!formatted) return true; // No valid phone → block

  // 1. Check whatsapp_opt_ins table — only block if record exists AND is opted_out
  //    with a webhook source (i.e. user actively sent "STOP")
  try {
    const record = await prisma.whatsAppOptIn.findFirst({
      where: {
        OR: [
          { phone: formatted },
          { phone: { endsWith: formatted.slice(-10) } }
        ]
      }
    });
    if (record) {
      // Only treat as opted out if user actively opted out via webhook (sent STOP)
      // Login-time opt-out records (source: 'webstore_login') should not block cart recovery
      if (record.status === 'opted_out' && record.source === 'webhook_optout') {
        return true; // Explicitly opted out via STOP keyword
      }
      // If they have an opted_in record, definitely not opted out
      if (record.status === 'opted_in') {
        return false;
      }
      // For login-time opt-out records, don't block cart recovery
      // (user didn't check marketing box but didn't actively say STOP)
      return false;
    }
  } catch (err) {
    console.warn('[WhatsApp Consent Check] failed to query whatsapp_opt_ins:', err.message);
  }

  // 2. Fallback: check Customer.whatsappOptedOut
  //    But only consider it a block if the customer has ACTIVELY opted out
  //    (not just default false → true flipping from login flow)
  try {
    const customer = await prisma.customer.findFirst({
      where: {
        phone: {
          endsWith: formatted.slice(-10)
        }
      }
    });

    if (customer && customer.whatsappOptedOut) {
      // Cross-check: was this set by an explicit STOP webhook?
      // Check if there's a webhook_optout record that confirms active opt-out
      try {
        const optOutRecord = await prisma.whatsAppOptIn.findUnique({
          where: { phone: formatted }
        });
        if (optOutRecord && optOutRecord.source === 'webhook_optout') {
          return true; // Confirmed explicit opt-out
        }
      } catch {
        // Non-critical — fall through
      }
      // whatsappOptedOut is true but no webhook_optout record → was set from login
      // Don't block cart recovery for this case
      return false;
    }
  } catch (err) {
    console.warn('[WhatsApp Consent Check] Fallback check failed:', err.message);
  }

  // 3. No record found at all → user never opted in or out → allow cart recovery
  return false;
}

// ---------------------------------------------------------------------------
// Marketing template list — used by sendAndLog for consent gating
// ---------------------------------------------------------------------------

// Cart recovery templates use LENIENT consent (only block explicit STOP opt-outs)
const CART_RECOVERY_TEMPLATES = [
  'abandoned_cart_a1',
  'abandoned_cart_a2',
  'abandoned_cart_a3',
  'zica_cart_recovery_v1',
  'zb_cart_final',
  'zb_cart_followup',
];

const CART_RECOVERY_EVENT_TYPES = ['abandoned_cart', 'cart_followup', 'cart_final'];

// Templates that are purely promotional (broadcast, catalog drops, sale alerts).
// Require explicit OPT_IN consent (consented = true) before sending.
const STRICT_MARKETING_TEMPLATES = [
  'zb_abandoned_cart',
  'zb_new_collection',
  'zb_sale_alert',
  'zb_restock_alert',
  'zb_welcome'
];

const STRICT_MARKETING_EVENT_TYPES = ['marketing', 'promo', 'broadcast'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the URL suffix (everything after the origin domain) for Meta dynamic
 * button parameters.
 */
function extractUrlSuffix(fullUrl) {
  if (!fullUrl) return 'cart';
  try {
    const parsed = new URL(fullUrl);
    return (parsed.pathname + parsed.search).replace(/^\//, '') || 'cart';
  } catch {
    return fullUrl.replace(/^https?:\/\/[^\/]+\//, '') || 'cart';
  }
}

// ---------------------------------------------------------------------------
// Core send + log helper
// ---------------------------------------------------------------------------

/**
 * Helper to standardise template responses, verify consent, and perform logging.
 */
async function sendAndLog({ phone, templateName, type, components, rawParams, orderId, cartId, recoveryStage }) {
  const formatted = formatPhone(phone);
  const resolvedOrderId = orderId || rawParams?.orderId || rawParams?.order_id || null;

  // Determine consent model:
  // - Cart recovery: lenient (only block explicit STOP opt-outs)
  // - Pure marketing: strict (require explicit opt-in)
  const isCartRecovery =
    CART_RECOVERY_TEMPLATES.includes(templateName) ||
    CART_RECOVERY_EVENT_TYPES.includes(type);

  const isStrictMarketing =
    STRICT_MARKETING_TEMPLATES.includes(templateName) ||
    STRICT_MARKETING_EVENT_TYPES.includes(type);

  if (isCartRecovery) {
    // ── CONVERTED CART PROTECTION ──
    // Do NOT send recovery messages to users whose cart is converted or who have already placed a valid order.
    let isConverted = false;
    if (cartId) {
      try {
        const cart = await prisma.cart.findUnique({
          where: { id: cartId },
          include: {
            convertedOrder: {
              select: {
                id: true,
                status: true,
                paymentStatus: true,
                paymentMethod: true
              }
            }
          }
        });
        if (cart && (cart.status === "converted" || (cart.convertedOrder && isOrderValidConverted(cart.convertedOrder)))) {
          isConverted = true;
        }
      } catch (err) {
        console.warn(`[WhatsApp Consent Check] Error checking cart conversion for ${cartId}:`, err.message);
      }
    }

    if (!isConverted && formatted) {
      try {
        const normDigits = formatted.replace(/\D/g, "").slice(-10);
        // Also resolve the cart's email and customerId for comprehensive matching
        let cartEmail = null;
        let cartCustomerId = null;
        if (cartId) {
          try {
            const cartRecord = await prisma.cart.findUnique({
              where: { id: cartId },
              select: { email: true, customerId: true, customer: { select: { email: true } } }
            });
            cartEmail = cartRecord?.email || cartRecord?.customer?.email || null;
            cartCustomerId = cartRecord?.customerId || null;
          } catch {
            // Non-critical
          }
        }

        if (normDigits.length >= 10) {
          const matchedOrder = await prisma.order.findFirst({
            where: {
              createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
              NOT: [
                { status: { in: ["failed", "FAILED", "payment_failed", "payment_pending", "cancelled", "CANCELLED", "draft", "voided"] } },
                { paymentStatus: { in: ["failed", "FAILED", "payment_failed", "payment_pending", "cancelled", "CANCELLED", "voided"] } }
              ],
              OR: [
                { paymentStatus: { in: ["paid", "cod_upfront_paid", "partially_paid", "refunded", "partially_refunded", "PAID", "SUCCESS", "success", "captured"] } },
                {
                  AND: [
                    { paymentMethod: { in: ["COD", "cod", "Cash on Delivery", "cash_on_delivery"] } },
                    { status: { in: ["approved", "open", "fulfilled", "delivered", "shipped", "completed", "processing", "processed", "CONFIRMED", "confirmed", "placed"] } }
                  ]
                }
              ],
              AND: [
                {
                  OR: [
                    ...(cartCustomerId ? [{ customerId: cartCustomerId }] : []),
                    { customer: { phone: { contains: normDigits } } },
                    { shippingAddress: { contains: normDigits } },
                    ...(cartEmail ? [{ customer: { email: { equals: cartEmail, mode: "insensitive" } } }] : []),
                    ...(cartEmail ? [{ shippingAddress: { contains: cartEmail } }] : [])
                  ]
                }
              ]
            }
          });
          if (matchedOrder) {
            isConverted = true;
            if (cartId) {
              const { linkCartToOrderSafe } = await import("@/lib/cartConversion");
              await linkCartToOrderSafe(cartId, matchedOrder.id).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.warn(`[WhatsApp Consent Check] Error checking order conversion by phone for ${formatted}:`, err.message);
      }
    }

    if (isConverted) {
      const errorMsg = 'Cart is already converted to a completed order; recovery message blocked.';
      console.info(`[WhatsApp Template Sender] Suppressed cart recovery ${templateName} to ${formatted} (Cart ${cartId || 'N/A'} is converted)`);
      return { success: true, skipped: true, reason: 'cart_already_converted', error: errorMsg };
    }

    // Lenient check: only block users who explicitly sent STOP
    const explicitlyOut = await isExplicitlyOptedOut(formatted);
    if (explicitlyOut) {
      const errorMsg = 'Recipient has explicitly opted out of WhatsApp messages (sent STOP)';
      console.warn(`[WhatsApp Template Sender] Explicit opt-out blocked cart recovery ${templateName} to ${formatted}`);
      await logMessage({
        to_number: formatted,
        template_name: templateName,
        message_body: `Template: ${templateName} (Blocked: Explicit Opt-Out)`,
        status: 'failed',
        message_id: null,
        error_details: { error: errorMsg },
        orderId: resolvedOrderId,
        cartId,
        recoveryStage
      });
      return { success: false, error: errorMsg };
    }
  } else if (isStrictMarketing) {
    // Strict check: require explicit opt-in for promotional campaigns
    const consented = await isOptedIn(formatted);
    if (!consented) {
      const errorMsg = 'Recipient has not opted in to receive marketing messages';
      console.warn(`[WhatsApp Template Sender] Consent blocked for template ${templateName} to ${formatted}`);
      await logMessage({
        to_number: formatted,
        template_name: templateName,
        message_body: `Template: ${templateName} (Blocked: Consent)`,
        status: 'failed',
        message_id: null,
        error_details: { error: errorMsg },
        orderId: resolvedOrderId,
        cartId,
        recoveryStage
      });
      return { success: false, error: errorMsg };
    }
  }

  let messageId = null;
  let status = 'sent';
  let errorMsg = null;
  let errorDetails = null;
  let result = null;

  try {
    if (!components) {
      throw new Error(`Failed to build dynamic components for template "${templateName}". Check Meta template definition or settings.`);
    }

    result = await sendTemplate({
      to: formatted,
      templateName,
      languageCode: 'en',
      components
    });

    messageId = result.messages?.[0]?.id || null;
    return { success: true, messageId, result };
  } catch (error) {
    status = 'failed';
    errorMsg = error.message;
    // Capture structured error info from Meta API for dashboard visibility
    errorDetails = {
      error: error.message,
      code: error.code || null,
      subcode: error.subcode || null,
      fbtrace_id: error.fbtrace_id || null
    };
    console.error(`[WhatsApp Template Sender] Failed to send ${templateName} to ${formatted}:`, errorMsg);
    return { success: false, error: errorMsg };
  } finally {
    // Log the event in the database logs table (whatsapp_messages / whatsapp_message_logs)
    let bodyText = `Template: ${templateName}`;
    if (components && components.length > 0) {
      bodyText += ` | Parameters: ${JSON.stringify(components)}`;
    }

    await logMessage({
      to_number: formatted,
      template_name: templateName,
      message_body: bodyText,
      status,
      message_id: messageId,
      error_details: errorDetails,
      orderId: resolvedOrderId,
      cartId,
      recoveryStage
    });
  }
}

// ---------------------------------------------------------------------------
// Helper: resolve a valid public image URL for WhatsApp header
// ---------------------------------------------------------------------------

/**
 * Given an optional image URL, returns a publicly-reachable URL suitable for
 * the WhatsApp IMAGE header component. Falls back to a known-good Shopify CDN
 * asset if the provided URL is empty or looks like a local/relative path.
 */
function resolveImageUrl(url) {
  if (!url) return FALLBACK_IMAGE_URL;
  // Reject non-http URLs and local dev URLs
  if (!url.startsWith('http://') && !url.startsWith('https://')) return FALLBACK_IMAGE_URL;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return FALLBACK_IMAGE_URL;
  // Reject the old broken logo.png reference
  if (url.includes('app.zicabella.com/logo.png')) return FALLBACK_IMAGE_URL;
  return url;
}

// ---------------------------------------------------------------------------
// Helper: build dynamic components array for any Meta-approved template
// ---------------------------------------------------------------------------
async function buildDynamicComponents(templateName, defaultTemplate, eventType, data, isRetryAfterSync = false) {
  if (!templateName) {
    return null;
  }

  let template = null;
  try {
    template = await prisma.whatsAppTemplate.findUnique({
      where: { name: templateName }
    });
  } catch (e) {
    console.warn(`[WhatsApp Template Builder] DB lookup failed for template ${templateName}:`, e.message);
  }

  const STALE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const isStale = template && template.updatedAt && (Date.now() - new Date(template.updatedAt).getTime() > STALE_TTL_MS);

  const syncFromMeta = async () => {
    console.warn(`[WhatsApp Template Builder] Syncing template "${templateName}" from Meta API...`);
    try {
      const metaTemplates = await listTemplates();
      const metaMatch = metaTemplates?.find(t => t.name === templateName);
      if (metaMatch) {
        const synced = await prisma.whatsAppTemplate.upsert({
          where: { name: templateName },
          update: {
            category: metaMatch.category,
            language: metaMatch.language,
            status: metaMatch.status,
            components: metaMatch.components || [],
            updatedAt: new Date()
          },
          create: {
            name: templateName,
            category: metaMatch.category,
            language: metaMatch.language,
            status: metaMatch.status,
            components: metaMatch.components || []
          }
        });
        console.log(`[WhatsApp Template Builder] Synced template "${templateName}" from Meta (status: ${metaMatch.status}, lang: ${metaMatch.language})`);
        return synced;
      } else {
        console.error(`[WhatsApp Template Builder] Template "${templateName}" does NOT exist on Meta. Check the template name in Settings > Automations.`);
        return null;
      }
    } catch (syncErr) {
      console.error(`[WhatsApp Template Builder] Meta API sync failed for template "${templateName}":`, syncErr.message);
      return null;
    }
  };

  // If missing or stale (>10 min old), attempt Meta API sync
  if (!template || !template.components || isStale) {
    const synced = await syncFromMeta();
    if (synced) {
      template = synced;
    }
  }

  if (!template || !template.components) {
    return null;
  }

  // Verify template is approved
  if (template.status && template.status !== 'APPROVED') {
    console.warn(`[WhatsApp Template Builder] Template "${templateName}" has status "${template.status}" — only APPROVED templates can be sent.`);
  }

  const components = [];
  const metaComponents = Array.isArray(template.components) ? template.components : [];

  const headerComp = metaComponents.find(c => c && c.type === 'HEADER');
  const bodyComp = metaComponents.find(c => c && c.type === 'BODY');
  const buttonComp = metaComponents.find(c => c && c.type === 'BUTTONS');

  // 1. HEADER
  if (headerComp) {
    if (headerComp.format === 'IMAGE') {
      const imageUrl = resolveImageUrl(data.productImageUrl || data.imageUrl);
      let headerImageParam = null;
      if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) && !imageUrl.includes('localhost') && !imageUrl.includes('127.0.0.1')) {
        try {
          const mediaId = await uploadMediaFromUrl(imageUrl);
          if (mediaId) {
            headerImageParam = {
              type: 'image',
              image: { id: mediaId }
            };
          }
        } catch (err) {
          console.warn('[WhatsApp Template Builder] Media upload failed, falling back to link:', err.message);
        }
      }
      if (!headerImageParam) {
        headerImageParam = {
          type: 'image',
          image: { link: imageUrl }
        };
      }
      components.push({
        type: 'header',
        parameters: [headerImageParam]
      });
    } else if (headerComp.format === 'VIDEO') {
      let videoUrl = data.productVideoUrl || data.videoUrl;
      // Fetch native video or metafield video dynamically from Shopify if not provided
      if (!videoUrl && data.productId) {
        try {
          const { fetchProductVideoUrl } = await import('@/lib/shopify-admin');
          if (fetchProductVideoUrl) {
            videoUrl = await fetchProductVideoUrl(data.productId);
          }
        } catch (err) {
          console.warn('[WhatsApp Template Builder] Failed to load fetchProductVideoUrl helper:', err.message);
        }
      }

      let headerVideoParam = null;
      if (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) && !videoUrl.includes('localhost') && !videoUrl.includes('127.0.0.1')) {
        try {
          const mediaId = await uploadMediaFromUrl(videoUrl);
          if (mediaId) {
            headerVideoParam = {
              type: 'video',
              video: { id: mediaId }
            };
          }
        } catch (err) {
          console.warn('[WhatsApp Template Builder] Video upload failed, falling back to link:', err.message);
        }
      }
      if (!headerVideoParam && videoUrl) {
        headerVideoParam = {
          type: 'video',
          video: { link: videoUrl }
        };
      }
      if (headerVideoParam) {
        components.push({
          type: 'header',
          parameters: [headerVideoParam]
        });
      }
    } else if (headerComp.format === 'TEXT') {
      const text = headerComp.text || '';
      const hasVar = /\{\{1\}\}/.test(text);
      if (hasVar) {
        components.push({
          type: 'header',
          parameters: [
            { type: 'text', text: String(data.orderId || data.customerName || 'there') }
          ]
        });
      }
    }
  }

  // 2. BODY
  let expectedBodyVarsCount = 0;
  if (bodyComp) {
    const text = bodyComp.text || '';
    // Extract variables matching numeric {{1}} or named {{order_id}}, {{customer_name}}, etc.
    const varMatches = Array.from(text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g));
    expectedBodyVarsCount = varMatches.length;

    if (expectedBodyVarsCount > 0) {
      const params = [];
      const orderNum = data.orderId || data.internalOrderNumber || data.shopifyOrderName || data.name || 'Order';
      const custName = data.customerName || data.name || 'Customer';
      const totalAmt = data.totalAmount ? `₹${data.totalAmount}` : data.total ? `₹${data.total}` : data.cartTotal ? `₹${data.cartTotal}` : 'Zica Bella';
      const itemsCount = data.itemCount || data.itemsCount ? String(data.itemCount || data.itemsCount) : '1';
      const statusStr = data.status || 'Confirmed';
      const dateStr = data.deliveryDate || data.deliveredDate || data.pickupDate || data.saleEndDate || 'Scheduled';
      const trackNum = data.trackingNumber || data.awbNumber || 'Assigned';
      const linkUrl = data.checkoutUrl || data.orderStatusUrl || data.trackingUrl || data.shopUrl || 'Zica Bella';

      let defaultSeq = [];
      switch (eventType) {
        case 'order_confirmed':
        case 'order_delivered':
        case 'cod_confirmation':
          defaultSeq = [custName, orderNum, totalAmt, itemsCount, dateStr];
          break;
        case 'order_shipped':
        case 'order_tracking':
          defaultSeq = [custName, orderNum, trackNum, linkUrl, dateStr];
          break;
        case 'order_status':
          defaultSeq = [custName, orderNum, statusStr, data.extraInfo || linkUrl];
          break;
        case 'out_for_delivery':
          defaultSeq = [orderNum, custName, trackNum, dateStr];
          break;
        case 'return_confirmed':
          defaultSeq = [custName, orderNum, data.refundAmount || totalAmt];
          break;
        case 'return_pickup_scheduled':
        case 'exchange_pickup_scheduled':
          defaultSeq = [custName, orderNum, dateStr, trackNum];
          break;
        case 'exchange_confirmed':
          defaultSeq = [custName, orderNum, data.newItemName || 'Replacement Item'];
          break;
        case 'exchange_shipped':
          defaultSeq = [custName, orderNum, trackNum, linkUrl];
          break;
        case 'abandoned_cart':
          defaultSeq = [custName, data.productName || linkUrl, linkUrl, totalAmt];
          break;
        case 'cart_followup':
        case 'cart_final':
          defaultSeq = [custName, data.discountCode || 'ZICA10', linkUrl];
          break;
        case 'new_collection':
          defaultSeq = [custName, data.collectionName || 'New Collection', data.tagline || 'Shop Now'];
          break;
        case 'sale_alert':
          defaultSeq = [custName, String(data.discountPercent || '10'), dateStr];
          break;
        case 'restock_alert':
          defaultSeq = [custName, data.productName || 'Favorite Item', data.size || 'All Sizes'];
          break;
        case 'welcome':
        case 'account_created':
          defaultSeq = [custName];
          break;
        default:
          defaultSeq = [custName, orderNum, totalAmt, linkUrl];
      }

      for (let i = 0; i < expectedBodyVarsCount; i++) {
        const rawVarName = varMatches[i] ? varMatches[i][1] : String(i + 1);
        const lowerVar = rawVarName.toLowerCase();
        const varNum = parseInt(rawVarName, 10);

        // Priority 1: Check explicit data parameter passed (e.g. data["order_id"], data["1"], data["orderId"])
        let val = data[rawVarName] ?? data[lowerVar] ?? (isNaN(varNum) ? undefined : data[varNum]) ?? data[i + 1] ?? data[String(i + 1)] ?? data[`var${rawVarName}`] ?? data[`param${rawVarName}`];

        // Priority 2: Smart fallback mapping based on variable name semantics
        if (val === undefined || val === null || String(val).trim() === '' || String(val) === 'undefined' || String(val) === 'null') {
          if (lowerVar.includes('order') || lowerVar.includes('id') || lowerVar.includes('number')) {
            val = orderNum;
          } else if (lowerVar.includes('name') || lowerVar.includes('customer') || lowerVar.includes('user')) {
            val = custName;
          } else if (lowerVar.includes('total') || lowerVar.includes('amount') || lowerVar.includes('price')) {
            val = totalAmt;
          } else if (lowerVar.includes('item') || lowerVar.includes('count') || lowerVar.includes('qty')) {
            val = itemsCount;
          } else if (lowerVar.includes('date') || lowerVar.includes('time')) {
            val = dateStr;
          } else if (lowerVar.includes('track') || lowerVar.includes('awb')) {
            val = trackNum;
          } else if (lowerVar.includes('url') || lowerVar.includes('link')) {
            val = linkUrl;
          } else {
            val = defaultSeq[i] !== undefined ? defaultSeq[i] : (i === 0 ? custName : (i === 1 ? orderNum : totalAmt));
          }
        }

        const isNumeric = /^\d+$/.test(rawVarName);
        const paramObj = {
          type: 'text',
          text: String(val).trim()
        };
        if (!isNumeric) {
          paramObj.parameter_name = rawVarName;
        }

        params.push(paramObj);
      }

      components.push({
        type: 'body',
        parameters: params
      });
    }
  }

  // 3. BUTTONS
  if (buttonComp && buttonComp.buttons) {
    buttonComp.buttons.forEach((btn, index) => {
      const isDynamicUrl = btn.type === 'URL' && (
        (btn.url && btn.url.includes('{{1}}')) ||
        btn.url_type === 'DYNAMIC' ||
        (btn.example && Array.isArray(btn.example) && btn.example.length > 0)
      );

      if (isDynamicUrl) {
        let suffix = 'cart';
        if (btn.url && btn.url.includes('/products/')) {
          suffix = data.productHandle || 'all';
        } else if (eventType === 'abandoned_cart' || eventType === 'cart_followup' || eventType === 'cart_final') {
          suffix = extractUrlSuffix(data.checkoutUrl);
        } else if (eventType === 'order_shipped' || eventType === 'order_tracking') {
          suffix = extractUrlSuffix(data.trackingUrl || `orders/${data.orderId || 'cart'}`);
        } else if (eventType === 'order_confirmed' || eventType === 'order_status') {
          suffix = extractUrlSuffix(data.orderStatusUrl || `orders/${data.orderId || 'cart'}`);
        } else {
          suffix = extractUrlSuffix(data.checkoutUrl || data.orderStatusUrl || data.trackingUrl || `orders/${data.orderId || 'cart'}`);
        }

        components.push({
          type: 'button',
          sub_type: 'url',
          index: index,
          parameters: [{ type: 'text', text: suffix || 'cart' }]
        });
      }
    });
  }

  // Post-build assertion: verify number of body parameters emitted matches expected variables in template BODY
  const builtBodyComp = components.find(c => c.type === 'body');
  const numEmittedParams = builtBodyComp ? (builtBodyComp.parameters ? builtBodyComp.parameters.length : 0) : 0;

  if (numEmittedParams !== expectedBodyVarsCount) {
    console.error(`[WhatsApp Template Builder] Parameter count mismatch for template "${templateName}": expected ${expectedBodyVarsCount}, got ${numEmittedParams}`);
    if (!isRetryAfterSync) {
      console.warn(`[WhatsApp Template Builder] Forcing Meta API re-sync to resolve parameter count mismatch for "${templateName}"...`);
      const synced = await syncFromMeta();
      if (synced) {
        return buildDynamicComponents(templateName, defaultTemplate, eventType, data, true);
      }
    }
    return null;
  }

  return components;
}

// ===========================================================================
// TEMPLATE SENDER FUNCTIONS
// ===========================================================================

/**
 * 2A — sendOrderConfirmation
 * Template: zica_order_confirmed_v1 (UTILITY)
 * @param {Object} options
 * @param {string} options.phone
 * @param {string} [options.customerName]
 * @param {string} [options.orderId]
 * @param {string} [options.productImageUrl]
 * @param {string} [options.orderStatusUrl]
 * @param {number|string} [options.totalAmount]
 * @param {number|string} [options.itemCount]
 * @param {string} [options.deliveryDate]
 */
export async function sendOrderConfirmation({ phone, customerName, orderId, productImageUrl, orderStatusUrl, totalAmount, itemCount, deliveryDate }) {
  const settingKey = 'template_order_confirmed';
  const defaultTemplate = 'zica_order_confirmed_v1';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'order_confirmed', {
    customerName,
    orderId,
    productImageUrl,
    orderStatusUrl,
    totalAmount,
    itemCount,
    deliveryDate
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'order_confirmed',
      components: dynamicComponents,
      orderId,
      rawParams: { customerName, orderId, productImageUrl, orderStatusUrl, totalAmount, itemCount, deliveryDate }
    });
  }

  // Fallback
  const components = [];
  const imageUrl = resolveImageUrl(productImageUrl);
  components.push({
    type: 'header',
    parameters: [
      {
        type: 'image',
        image: { link: imageUrl }
      }
    ]
  });

  components.push({
    type: 'body',
    parameters: [
      { type: 'text', text: customerName || 'there' },
      { type: 'text', text: String(orderId) }
    ]
  });

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'order_confirmed',
    components,
    orderId,
    rawParams: { customerName, orderId, productImageUrl }
  });
}

/**
 * 2B — sendOrderStatus (Generic updates)
 * Template: zb_order_status (UTILITY)
 */
export async function sendOrderStatus({ phone, customerName, orderId, status, extraInfo, orderStatusUrl }) {
  const settingKey = 'template_order_status';
  const defaultTemplate = 'zb_order_status';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'order_status', {
    customerName,
    orderId,
    status,
    extraInfo,
    orderStatusUrl
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'order_status',
      components: dynamicComponents,
      rawParams: { customerName, orderId, status, extraInfo, orderStatusUrl }
    });
  }

  // Fallback
  const suffix = extractUrlSuffix(orderStatusUrl || `orders/${orderId}`);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: status || 'Updated' },
        { type: 'text', text: extraInfo || 'Check status online' }
      ]
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: suffix }]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'order_status',
    components,
    rawParams: { customerName, orderId, status, extraInfo, orderStatusUrl }
  });
}

/**
 * 2C — sendShippingUpdate
 * Template: zb_order_tracking (UTILITY)
 */
export async function sendShippingUpdate({ phone, customerName, orderId, trackingNumber, trackingUrl }) {
  const settingKey = 'template_order_shipped';
  const defaultTemplate = 'zb_order_tracking';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'order_shipped', {
    customerName,
    orderId,
    trackingNumber,
    trackingUrl
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'order_shipped',
      components: dynamicComponents,
      rawParams: { customerName, orderId, trackingNumber, trackingUrl }
    });
  }

  // Fallback
  const suffix = extractUrlSuffix(trackingUrl || `tracking/${trackingNumber}`);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: trackingNumber || 'TBA' }
      ]
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: suffix }]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'order_shipped',
    components,
    rawParams: { customerName, orderId, trackingNumber, trackingUrl }
  });
}

/**
 * 2D — sendOutForDelivery
 * Template: zb_out_for_delivery (UTILITY)
 */
export async function sendOutForDelivery({ phone, orderId, customerName }) {
  const settingKey = 'template_out_for_delivery';
  const defaultTemplate = 'zb_out_for_delivery';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'out_for_delivery', {
    orderId,
    customerName
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'out_for_delivery',
      components: dynamicComponents,
      rawParams: { orderId, customerName }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: String(orderId) },
        { type: 'text', text: customerName || 'there' }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'out_for_delivery',
    components,
    rawParams: { orderId, customerName }
  });
}

/**
 * 2E — sendDelivered
 * Template: zica_order_delivered_v1 (MARKETING)
 * @param {Object} options
 * @param {string} options.phone
 * @param {string} [options.customerName]
 * @param {string} [options.orderId]
 * @param {string} [options.productImageUrl]
 * @param {string} [options.deliveredDate]
 * @param {number|string} [options.totalAmount]
 * @param {number|string} [options.itemCount]
 */
export async function sendDelivered({ phone, customerName, orderId, productImageUrl, deliveredDate, totalAmount, itemCount }) {
  const settingKey = 'template_order_delivered';
  const defaultTemplate = 'zica_order_delivered_v1';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'order_delivered', {
    customerName,
    orderId,
    productImageUrl,
    deliveredDate,
    totalAmount,
    itemCount
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'order_delivered',
      components: dynamicComponents,
      orderId,
      rawParams: { customerName, orderId, productImageUrl, deliveredDate, totalAmount, itemCount }
    });
  }

  // Fallback
  const components = [];
  const imageUrl = resolveImageUrl(productImageUrl);
  components.push({
    type: 'header',
    parameters: [
      {
        type: 'image',
        image: { link: imageUrl }
      }
    ]
  });

  components.push({
    type: 'body',
    parameters: [
      { type: 'text', text: customerName || 'there' },
      { type: 'text', text: String(orderId) }
    ]
  });

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'order_delivered',
    components,
    orderId,
    rawParams: { customerName, orderId, productImageUrl, deliveredDate, totalAmount, itemCount }
  });
}

/**
 * 2F — sendReturnConfirmed
 * Template: zb_return_confirmed (UTILITY)
 */
export async function sendReturnConfirmed({ phone, customerName, orderId, refundAmount }) {
  const settingKey = 'template_return_confirmed';
  const defaultTemplate = 'zb_return_confirmed';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'return_confirmed', {
    customerName,
    orderId,
    refundAmount
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'return_confirmed',
      components: dynamicComponents,
      rawParams: { customerName, orderId, refundAmount }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: String(refundAmount) }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'return_confirmed',
    components,
    rawParams: { customerName, orderId, refundAmount }
  });
}

/**
 * 2G — sendAbandonedCart
 * Template: zica_cart_recovery_v1 (MARKETING)
 */
export async function sendAbandonedCart({ phone, customerName, checkoutUrl, productImageUrl, productName, cartTotal, itemCount, productHandle, cartId }) {
  const settingKey = 'template_abandoned_cart';
  const defaultTemplate = 'abandoned_cart_a1';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  let resolvedImageUrl = productImageUrl;
  let resolvedName = productName;
  let resolvedTotal = cartTotal;
  let resolvedCount = itemCount;
  let resolvedHandle = productHandle;

  if ((!resolvedImageUrl || resolvedImageUrl === '' || !resolvedHandle) && checkoutUrl) {
    try {
      let cartIdResolved = cartId;
      if (!cartIdResolved) {
        if (checkoutUrl.includes('recover=')) {
          const match = checkoutUrl.match(/[?&]recover=([^&]+)/);
          if (match) cartIdResolved = match[1];
        } else {
          const urlObj = new URL(checkoutUrl);
          cartIdResolved = urlObj.searchParams.get('recover');
        }
      }

      if (cartIdResolved) {
        const cart = await prisma.cart.findUnique({
          where: { id: cartIdResolved },
          include: { items: true }
        });
        if (cart && cart.items && cart.items.length > 0) {
          if (!resolvedImageUrl || resolvedImageUrl === '') {
            resolvedImageUrl = cart.items[0].image || '';
          }
          if (!resolvedName || resolvedName === '') {
            resolvedName = cart.items[0].title || '';
          }
          if (!resolvedTotal || resolvedTotal === '0.00') {
            resolvedTotal = String(cart.subtotal || '0.00');
          }
          if (!resolvedCount) {
            resolvedCount = cart.items.length;
          }
          if (!resolvedHandle) {
            resolvedHandle = cart.items[0].handle || '';
            
            // Fallback: if handle is not in cart item, check database Product table
            if (!resolvedHandle && cart.items[0].productId) {
              const dbProduct = await prisma.product.findUnique({
                where: { shopifyProductId: String(cart.items[0].productId) }
              });
              if (dbProduct && dbProduct.handle) {
                resolvedHandle = dbProduct.handle;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[WhatsApp sendAbandonedCart] Failed to resolve product info from database:', err.message);
    }
  }

  // Final fallbacks for resolvedHandle if still empty
  if (!resolvedHandle && resolvedName) {
    resolvedHandle = resolvedName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
  if (!resolvedHandle) {
    resolvedHandle = 'all';
  }

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'abandoned_cart', {
    customerName,
    checkoutUrl,
    productImageUrl: resolvedImageUrl,
    productName: resolvedName,
    cartTotal: resolvedTotal,
    itemCount: resolvedCount,
    productHandle: resolvedHandle
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'abandoned_cart',
      components: dynamicComponents,
      rawParams: { customerName, checkoutUrl, productImageUrl: resolvedImageUrl, productName: resolvedName, cartTotal: resolvedTotal, itemCount: resolvedCount, productHandle: resolvedHandle },
      cartId,
      recoveryStage: 1
    });
  }

  if (templateName !== defaultTemplate) {
    const errorMsg = `Configured template "${templateName}" could not be resolved from Meta — check it exists, is APPROVED, and the name is spelled correctly in Automations settings`;
    console.error(`[WhatsApp Template Sender] ${errorMsg}`);
    await logMessage({
      to_number: formatPhone(phone),
      template_name: templateName,
      message_body: `Template: ${templateName} (Failed: unresolvable custom template)`,
      status: 'failed',
      message_id: null,
      error_details: { error: errorMsg },
      cartId,
      recoveryStage: 1
    });
    return { success: false, error: errorMsg };
  }

  // Fallback
  const components = [];
  
  // Try to upload the product image to WhatsApp Media API
  let headerImageParam = null;
  if (resolvedImageUrl && (resolvedImageUrl.startsWith('http://') || resolvedImageUrl.startsWith('https://')) && !resolvedImageUrl.includes('localhost') && !resolvedImageUrl.includes('127.0.0.1')) {
    try {
      const mediaId = await uploadMediaFromUrl(resolvedImageUrl);
      if (mediaId) {
        headerImageParam = {
          type: 'image',
          image: { id: mediaId }
        };
      }
    } catch (err) {
      console.warn('[WhatsApp Template Sender] Failed to upload product image to WhatsApp Media API. Falling back to link:', err.message);
    }
  }

  if (!headerImageParam) {
    const imageUrl = resolveImageUrl(resolvedImageUrl);
    headerImageParam = {
      type: 'image',
      image: { link: imageUrl }
    };
  }

  components.push({
    type: 'header',
    parameters: [headerImageParam]
  });

  // Body: only {{1}} customerName — this is what the approved template expects
  components.push({
    type: 'body',
    parameters: [
      { type: 'text', text: customerName || 'there' }
    ]
  });

  // Button URL is dynamic (https://app.zicabella.com/products/{{1}}) — pass the handle/slug
  components.push({
    type: 'button',
    sub_type: 'url',
    index: 0,
    parameters: [
      { type: 'text', text: resolvedHandle }
    ]
  });

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'abandoned_cart',
    components,
    rawParams: { customerName, checkoutUrl, productImageUrl: resolvedImageUrl, productName: resolvedName, cartTotal: resolvedTotal, itemCount: resolvedCount, productHandle: resolvedHandle },
    cartId,
    recoveryStage: 1
  });
}

/**
 * 2H — sendNewCollection
 * Template: zb_new_collection (MARKETING)
 */
export async function sendNewCollection({ phone, customerName, collectionName, tagline, imageUrl, shopUrl }) {
  const settingKey = 'template_new_collection';
  const defaultTemplate = 'zb_new_collection';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'new_collection', {
    customerName,
    collectionName,
    tagline,
    imageUrl,
    productImageUrl: imageUrl,
    shopUrl
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'new_collection',
      components: dynamicComponents,
      rawParams: { customerName, collectionName, tagline, imageUrl, shopUrl }
    });
  }

  // Fallback
  let suffix = shopUrl || '';
  if (suffix.includes('/')) {
    suffix = suffix.split('/').pop() || '';
  }

  const components = [
    {
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { link: imageUrl }
        }
      ]
    },
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: collectionName },
        { type: 'text', text: tagline }
      ]
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [
        { type: 'text', text: suffix }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'new_collection',
    components,
    rawParams: { customerName, collectionName, tagline, imageUrl, shopUrl }
  });
}

/**
 * 2I — sendSaleAlert
 * Template: zb_sale_alert (MARKETING)
 */
export async function sendSaleAlert({ phone, customerName, discountPercent, saleEndDate }) {
  const settingKey = 'template_sale_alert';
  const defaultTemplate = 'zb_sale_alert';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'sale_alert', {
    customerName,
    discountPercent,
    saleEndDate
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'sale_alert',
      components: dynamicComponents,
      rawParams: { customerName, discountPercent, saleEndDate }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(discountPercent) },
        { type: 'text', text: saleEndDate }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'sale_alert',
    components,
    rawParams: { customerName, discountPercent, saleEndDate }
  });
}

/**
 * 2J — sendRestockAlert
 * Template: zb_restock_alert (MARKETING)
 */
export async function sendRestockAlert({ phone, customerName, productName, size }) {
  const settingKey = 'template_restock_alert';
  const defaultTemplate = 'zb_restock_alert';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'restock_alert', {
    customerName,
    productName,
    size
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'restock_alert',
      components: dynamicComponents,
      rawParams: { customerName, productName, size }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: productName },
        { type: 'text', text: size }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'restock_alert',
    components,
    rawParams: { customerName, productName, size }
  });
}

/**
 * 2K — sendWelcome
 * Template: zb_welcome (MARKETING)
 */
export async function sendWelcome({ phone, customerName }) {
  const settingKey = 'template_welcome';
  const defaultTemplate = 'zb_welcome';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'welcome', {
    customerName
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'welcome',
      components: dynamicComponents,
      rawParams: { customerName }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'welcome',
    components,
    rawParams: { customerName }
  });
}

/**
 * 2K2 — sendAccountCreated
 * Account Created — sent once, the first time a customer successfully
 * logs in after their account exists (covers both new signups and
 * existing customers who haven't received it yet).
 * Template: UTILITY category — no marketing consent gate.
 */
export async function sendAccountCreated({ phone, customerName }) {
  const settingKey = 'template_account_created';
  const defaultTemplate = 'account_created';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'account_created', {
    customerName
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'account_created',
      components: dynamicComponents,
      rawParams: { customerName }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'account_created',
    components,
    rawParams: { customerName }
  });
}

/**
 * 2L — sendCODConfirmation
 * Template: zica_cod_confirmation_v1 (UTILITY)
 */
export async function sendCODConfirmation({ phone, customerName, orderId }) {
  const settingKey = 'template_cod_confirmation';
  const defaultTemplate = 'zica_cod_confirmation_v1';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'cod_confirmation', {
    customerName,
    orderId
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'cod_confirmation',
      components: dynamicComponents,
      orderId,
      rawParams: { customerName, orderId }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) }
      ]
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [
        { type: 'payload', payload: `COD_CONFIRM_${orderId}` }
      ]
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '1',
      parameters: [
        { type: 'payload', payload: `COD_CANCEL_${orderId}` }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'cod_confirmation',
    components,
    orderId,
    rawParams: { customerName, orderId }
  });
}

/**
 * 2M — sendCartRecoveryFollowUp
 * Template: zb_cart_followup (MARKETING)
 */
export async function sendCartRecoveryFollowUp({ 
  phone, 
  customerName, 
  discountCode, 
  checkoutUrl,
  productId,
  productImageUrl,
  productName,
  productHandle,
  cartTotal,
  itemCount,
  cartId
}) {
  const settingKey = 'template_cart_followup';
  const defaultTemplate = 'abandoned_cart_a2';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'cart_followup', {
    customerName,
    discountCode,
    checkoutUrl,
    productId,
    productImageUrl,
    productName,
    productHandle,
    cartTotal,
    itemCount
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'cart_followup',
      components: dynamicComponents,
      rawParams: { customerName, discountCode, checkoutUrl, productId, productImageUrl, productName, productHandle, cartTotal, itemCount },
      cartId,
      recoveryStage: 2
    });
  }

  if (templateName !== defaultTemplate) {
    const errorMsg = `Configured template "${templateName}" could not be resolved from Meta — check it exists, is APPROVED, and the name is spelled correctly in Automations settings`;
    console.error(`[WhatsApp Template Sender] ${errorMsg}`);
    await logMessage({
      to_number: formatPhone(phone),
      template_name: templateName,
      message_body: `Template: ${templateName} (Failed: unresolvable custom template)`,
      status: 'failed',
      message_id: null,
      error_details: { error: errorMsg },
      cartId,
      recoveryStage: 2
    });
    return { success: false, error: errorMsg };
  }

  // Fallback
  const suffix = extractUrlSuffix(checkoutUrl);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: discountCode || 'ZICA10' }
      ]
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: suffix }]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'cart_followup',
    components,
    rawParams: { customerName, discountCode, checkoutUrl },
    cartId,
    recoveryStage: 2
  });
}

/**
 * 2N — sendCartRecoveryFinalReminder
 * Template: zb_cart_final (MARKETING)
 */
export async function sendCartRecoveryFinalReminder({ 
  phone, 
  customerName, 
  checkoutUrl,
  productId,
  productImageUrl,
  productName,
  productHandle,
  cartTotal,
  itemCount,
  cartId
}) {
  const settingKey = 'template_cart_final';
  const defaultTemplate = 'abandoned_cart_a3';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'cart_final', {
    customerName,
    checkoutUrl,
    productId,
    productImageUrl,
    productName,
    productHandle,
    cartTotal,
    itemCount
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'cart_final',
      components: dynamicComponents,
      rawParams: { customerName, checkoutUrl, productId, productImageUrl, productName, productHandle, cartTotal, itemCount },
      cartId,
      recoveryStage: 3
    });
  }

  if (templateName !== defaultTemplate) {
    const errorMsg = `Configured template "${templateName}" could not be resolved from Meta — check it exists, is APPROVED, and the name is spelled correctly in Automations settings`;
    console.error(`[WhatsApp Template Sender] ${errorMsg}`);
    await logMessage({
      to_number: formatPhone(phone),
      template_name: templateName,
      message_body: `Template: ${templateName} (Failed: unresolvable custom template)`,
      status: 'failed',
      message_id: null,
      error_details: { error: errorMsg },
      cartId,
      recoveryStage: 3
    });
    return { success: false, error: errorMsg };
  }

  // Fallback
  const suffix = extractUrlSuffix(checkoutUrl);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' }
      ]
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: suffix }]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'cart_final',
    components,
    rawParams: { customerName, checkoutUrl },
    cartId,
    recoveryStage: 3
  });
}

/**
 * 2O — sendOrderTrackingUpdate
 * Template: zb_order_tracking (UTILITY)
 */
export async function sendOrderTrackingUpdate({ phone, customerName, orderId, trackingUrl }) {
  const settingKey = 'template_order_tracking';
  const defaultTemplate = 'zb_order_tracking';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'order_tracking', {
    customerName,
    orderId,
    trackingUrl
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'order_tracking',
      components: dynamicComponents,
      rawParams: { customerName, orderId, trackingUrl }
    });
  }

  // Fallback
  const suffix = String(orderId);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) }
      ]
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: suffix }]
    }
  ];

  return sendAndLog({
    phone,
    templateName: 'zb_order_tracking',
    type: 'order_tracking',
    components,
    rawParams: { customerName, orderId, trackingUrl }
  });
}

/**
 * sendCustomCartRecovery — Generic sender used by manual recovery triggers
 */
export async function sendCustomCartRecovery({ phone, customerName, checkoutUrl, templateName, productImageUrl, productName, cartTotal, itemCount, productHandle, cartId, recoveryStage }) {
  let eventType = 'abandoned_cart';
  if (templateName.includes('followup') || templateName.includes('step2') || templateName === 'zb_cart_followup' || templateName === 'abandoned_cart_a2') {
    eventType = 'cart_followup';
  } else if (templateName.includes('final') || templateName.includes('step3') || templateName === 'zb_cart_final' || templateName === 'abandoned_cart_a3') {
    eventType = 'cart_final';
  }

  const dynamicComponents = await buildDynamicComponents(templateName, 'abandoned_cart_a1', eventType, {
    customerName,
    checkoutUrl,
    productImageUrl,
    productName,
    cartTotal,
    itemCount,
    productHandle,
    discountCode: 'ZICA10'
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: eventType,
      components: dynamicComponents,
      rawParams: { customerName, checkoutUrl, productImageUrl, productName, cartTotal, itemCount, productHandle },
      cartId,
      recoveryStage: recoveryStage || (eventType === 'cart_followup' ? 2 : eventType === 'cart_final' ? 3 : 1)
    });
  }

  // Fallback
  if (eventType === 'cart_followup') {
    return sendCartRecoveryFollowUp({ phone, customerName, discountCode: 'ZICA10', checkoutUrl, cartId });
  } else if (eventType === 'cart_final') {
    return sendCartRecoveryFinalReminder({ phone, customerName, checkoutUrl, cartId });
  } else {
    return sendAbandonedCart({ phone, customerName, checkoutUrl, productImageUrl, productName, cartTotal, itemCount, productHandle, cartId });
  }
}

// ---------------------------------------------------------------------------
// Return & Exchange Life-cycle Sender Functions
// ---------------------------------------------------------------------------

/**
 * sendReturnPickupScheduled
 * Template: zb_return_pickup_scheduled (UTILITY)
 * Triggered when return status moves to pickup_pending
 */
export async function sendReturnPickupScheduled({ phone, customerName, orderId, pickupDate, awbNumber }) {
  const settingKey = 'template_return_pickup';
  const defaultTemplate = 'zb_return_pickup_scheduled';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'return_pickup_scheduled', {
    customerName,
    orderId,
    pickupDate: pickupDate || 'Scheduled',
    awbNumber: awbNumber || 'Assigned'
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'return_pickup_scheduled',
      components: dynamicComponents,
      rawParams: { customerName, orderId, pickupDate, awbNumber }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: String(pickupDate || 'Scheduled') },
        { type: 'text', text: String(awbNumber || 'Assigned') }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'return_pickup_scheduled',
    components,
    rawParams: { customerName, orderId, pickupDate, awbNumber }
  });
}

/**
 * sendExchangeConfirmed
 * Template: zb_exchange_confirmed (UTILITY)
 * Triggered when an exchange request is approved
 */
export async function sendExchangeConfirmed({ phone, customerName, orderId, newItemName }) {
  const settingKey = 'template_exchange_confirmed';
  const defaultTemplate = 'zb_exchange_confirmed';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'exchange_confirmed', {
    customerName,
    orderId,
    newItemName: newItemName || 'Replacement Item'
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'exchange_confirmed',
      components: dynamicComponents,
      rawParams: { customerName, orderId, newItemName }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: String(newItemName || 'Replacement Item') }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'exchange_confirmed',
    components,
    rawParams: { customerName, orderId, newItemName }
  });
}

/**
 * sendExchangePickupScheduled
 * Template: zb_exchange_pickup_scheduled (UTILITY)
 * Triggered when reverse pickup is scheduled for an approved exchange
 */
export async function sendExchangePickupScheduled({ phone, customerName, orderId, pickupDate, awbNumber }) {
  const settingKey = 'template_exchange_pickup';
  const defaultTemplate = 'zb_exchange_pickup_scheduled';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'exchange_pickup_scheduled', {
    customerName,
    orderId,
    pickupDate: pickupDate || 'Scheduled',
    awbNumber: awbNumber || 'Assigned'
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'exchange_pickup_scheduled',
      components: dynamicComponents,
      rawParams: { customerName, orderId, pickupDate, awbNumber }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: String(pickupDate || 'Scheduled') },
        { type: 'text', text: String(awbNumber || 'Assigned') }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'exchange_pickup_scheduled',
    components,
    rawParams: { customerName, orderId, pickupDate, awbNumber }
  });
}

/**
 * sendExchangeShipped
 * Template: zb_exchange_shipped (UTILITY)
 * Triggered when replacement item ships after QC
 */
export async function sendExchangeShipped({ phone, customerName, orderId, trackingNumber, trackingUrl }) {
  const settingKey = 'template_exchange_shipped';
  const defaultTemplate = 'zb_exchange_shipped';
  const templateName = await getWhatsAppSetting(settingKey, defaultTemplate);

  const dynamicComponents = await buildDynamicComponents(templateName, defaultTemplate, 'exchange_shipped', {
    customerName,
    orderId,
    trackingNumber: trackingNumber || 'N/A',
    trackingUrl
  });

  if (dynamicComponents !== null) {
    return sendAndLog({
      phone,
      templateName,
      type: 'exchange_shipped',
      components: dynamicComponents,
      rawParams: { customerName, orderId, trackingNumber, trackingUrl }
    });
  }

  // Fallback
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: customerName || 'there' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: String(trackingNumber || 'N/A') }
      ]
    }
  ];

  return sendAndLog({
    phone,
    templateName: defaultTemplate,
    type: 'exchange_shipped',
    components,
    rawParams: { customerName, orderId, trackingNumber }
  });
}

