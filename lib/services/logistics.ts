/**
 * Logistics Service — Server-side only
 * 
 * Unified interface for logistics partner APIs (Shiprocket, Delhivery, Blue Dart, FedEx, Custom).
 * API keys are NEVER exposed to the client or mobile app.
 * 
 * Data flow: Logistics API → Backend → DB → GET /api/orders/{id} → App
 */

import prisma from '@/lib/db';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────

export interface TrackingEvent {
  status: string;
  location: string;
  timestamp: string;
  description: string;
}

export interface TrackingStatus {
  status: string;
  location: string | null;
  estimatedDelivery: string | null;
  trackingUrl: string | null;
  events: TrackingEvent[];
}

export interface ShipmentResult {
  trackingNumber: string;
  trackingUrl?: string;
  courier: string;
  shipmentId?: string;
  /** Shiprocket order_id (needed for cancel) */
  shiprocketOrderId?: string | null;
  /** Real AWB/waybill only — not Shiprocket order_id */
  awb?: string | null;
  status?: string;
  deliveryStatus?: string;
  labelUrl?: string | null;
}

export type ShiprocketShipmentMeta = {
  provider: 'shiprocket';
  shipment_id: string | number | null;
  order_id: string | number | null;
  pickup_scheduled_at?: string | null;
  invoice_url?: string | null;
};

export interface LogisticsConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  webhookSecret: string;
}

// ─── Provider Presets ───────────────────────────────────────────────

export const PROVIDER_PRESETS: Record<string, { baseUrl: string; endpoints: Record<string, string> }> = {
  shiprocket: {
    baseUrl: 'https://apiv2.shiprocket.in/v1/external',
    endpoints: {
      createShipment: '/orders/create/adhoc',
      assignAwb: '/courier/assign/awb',
      generatePickup: '/courier/generate/pickup',
      generateLabel: '/courier/generate/label',
      generateInvoice: '/orders/print/invoice',
      trackAwb: '/courier/track/awb',
      trackShipment: '/courier/track/shipment',
      createReturn: '/orders/create/return',
      cancelShipment: '/orders/cancel',
      ping: '/orders',
    },
  },
  delhivery: {
    baseUrl: 'https://track.delhivery.com',
    endpoints: {
      createShipment: '/api/cmu/create.json',
      trackShipment: '/api/v1/packages/json',
      createReturn: '/api/cmu/create.json',
      cancelShipment: '/api/p/edit',
      ping: '/waybill/api/fetch/json/',
    },
  },
  bluedart: {
    baseUrl: 'https://api.bluedart.com',
    endpoints: {
      createShipment: '/servlet/RoutingServlet',
      trackShipment: '/servlet/TrackingServlet',
      createReturn: '/servlet/RoutingServlet',
      cancelShipment: '/servlet/CancelServlet',
      ping: '/servlet/PingServlet',
    },
  },
  fedex: {
    baseUrl: 'https://apis.fedex.com',
    endpoints: {
      createShipment: '/ship/v1/shipments',
      trackShipment: '/track/v1/trackingnumbers',
      createReturn: '/ship/v1/shipments',
      cancelShipment: '/ship/v1/shipments/cancel',
      ping: '/oauth/token',
    },
  },
  custom: {
    baseUrl: '',
    endpoints: {
      createShipment: '/shipments',
      trackShipment: '/track',
      createReturn: '/returns',
      cancelShipment: '/cancel',
      ping: '/ping',
    },
  },
};

// ─── Config Resolution ──────────────────────────────────────────────

async function refreshShiprocketToken(email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const text = await res.text();
    console.error(`[Shiprocket Auth] Login failed: ${String(text).slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    return data.token || null;
  } catch (err) {
    console.error('[Shiprocket Auth] Error:', err);
    return null;
  }
}

async function getLogisticsConfig(): Promise<LogisticsConfig> {
  try {
    const shop = await prisma.shop.findFirst({
      select: {
        id: true,
        shiprocketToken: true,
        shiprocketEmail: true,
        shiprocketPassword: true,
        delhiveryApiKey: true,
        webhookSecret: true,
      },
    });

    if (!shop) return { provider: 'mock', baseUrl: '', apiKey: '', webhookSecret: '' };

    // Determine active provider — Shiprocket takes priority if email/pass or token exists
    if (shop.shiprocketEmail && shop.shiprocketPassword) {
      // Logic to check if token is valid (could ping an API or just refresh if missing)
      let token = shop.shiprocketToken;
      if (!token) {
        token = await refreshShiprocketToken(shop.shiprocketEmail, shop.shiprocketPassword);
        if (token) {
          await prisma.shop.update({
            where: { id: shop.id },
            data: { shiprocketToken: token },
          });
        }
      }

      if (token) {
        return {
          provider: 'shiprocket',
          baseUrl: PROVIDER_PRESETS.shiprocket.baseUrl,
          apiKey: token,
          webhookSecret: shop.webhookSecret || '',
        };
      }
    }

    if (shop.shiprocketToken) {
      return {
        provider: 'shiprocket',
        baseUrl: PROVIDER_PRESETS.shiprocket.baseUrl,
        apiKey: shop.shiprocketToken,
        webhookSecret: shop.webhookSecret || '',
      };
    }

    const delhiveryKey = process.env.DELHIVERY_API_KEY || shop.delhiveryApiKey;
    if (delhiveryKey) {
      return {
        provider: 'delhivery',
        baseUrl: process.env.DELHIVERY_BASE_URL || PROVIDER_PRESETS.delhivery.baseUrl,
        apiKey: delhiveryKey,
        webhookSecret: process.env.DELHIVERY_WEBHOOK_SECRET || shop.webhookSecret || '',
      };
    }

    // Fallback to mock provider
    return {
      provider: 'mock',
      baseUrl: '',
      apiKey: '',
      webhookSecret: shop.webhookSecret || '',
    };
  } catch (err) {
    console.error('[Logistics] Config resolution failed:', err);
    return { provider: 'mock', baseUrl: '', apiKey: '', webhookSecret: '' };
  }
}

// ─── Provider API Call Helper ───────────────────────────────────────

async function logisticsApiFetch(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  retry = true
): Promise<any> {
  const config = await getLogisticsConfig();

  if (config.provider === 'mock') {
    throw new Error(
      `Logistics API skipped: no provider configured (endpoint ${method} ${endpoint})`
    );
  }

  const preset = PROVIDER_PRESETS[config.provider];
  const url = `${config.baseUrl || preset?.baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Provider-specific auth headers
  if (config.provider === 'shiprocket') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else if (config.provider === 'delhivery') {
    headers['Authorization'] = `Token ${config.apiKey}`;
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (res.status === 401 && retry && config.provider === 'shiprocket') {
    console.log('[Logistics] Shiprocket token expired, refreshing...');
    const shop = await prisma.shop.findFirst({ select: { id: true, shiprocketEmail: true, shiprocketPassword: true } });
    if (shop?.shiprocketEmail && shop?.shiprocketPassword) {
      const newToken = await refreshShiprocketToken(shop.shiprocketEmail, shop.shiprocketPassword);
      if (newToken) {
        await prisma.shop.update({ where: { id: shop.id }, data: { shiprocketToken: newToken } });
        // Retry with new token
        return logisticsApiFetch(endpoint, method, body, false);
      }
    }
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Logistics API] ${method} ${endpoint} → ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`Logistics API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── Core Service Methods ───────────────────────────────────────────

/**
 * Resolve local Order.id and write Shipment + Order + WebStoreOrder delivery status.
 */
async function persistShipmentAndDeliveryStatus(
  orderRef: string,
  result: ShipmentResult,
  extraOrderData?: Record<string, unknown>
): Promise<string | null> {
  const { resolveLocalOrderId } = await import('@/lib/services/orderLifecycleService');
  const localId = await resolveLocalOrderId(orderRef);
  if (!localId) {
    console.warn(`[Logistics] No local Order for ref=${orderRef}; skipping shipment DB write`);
    return null;
  }

  const shipmentStatus = result.status || (result.awb ? 'confirmed' : 'new');
  const deliveryStatus =
    result.deliveryStatus || (result.awb ? 'confirmed' : 'processing');
  const awbValue = result.awb && String(result.awb).trim() ? String(result.awb) : null;

  const shiprocketMeta: ShiprocketShipmentMeta | null =
    result.shipmentId || result.shiprocketOrderId
      ? {
          provider: 'shiprocket',
          shipment_id: result.shipmentId || null,
          order_id: result.shiprocketOrderId || null,
        }
      : null;

  await prisma.shipment.create({
    data: {
      orderId: localId,
      trackingNumber: result.trackingNumber,
      awb: awbValue || undefined,
      trackingUrl: result.trackingUrl || null,
      labelUrl: result.labelUrl || null,
      courier: result.courier,
      status: shipmentStatus,
      rawDelhiveryResponse: shiprocketMeta ? JSON.stringify(shiprocketMeta) : undefined,
      events: JSON.stringify([
        {
          status: shipmentStatus,
          location: 'Warehouse',
          timestamp: new Date().toISOString(),
          description: awbValue
            ? `Shipment booked with AWB ${awbValue}`
            : `Carrier order created (id ${result.trackingNumber}) — AWB not assigned yet`,
        },
      ]),
    },
  });

  await prisma.order.update({
    where: { id: localId },
    data: {
      deliveryStatus,
      ...(extraOrderData || {}),
    },
  });

  const order = await prisma.order.findUnique({
    where: { id: localId },
    select: { internalOrderNumber: true, razorpayOrderId: true, shopifyOrderId: true },
  });
  const wsWhere: Array<Record<string, string>> = [];
  if (order?.internalOrderNumber) wsWhere.push({ orderNumber: order.internalOrderNumber });
  if (order?.razorpayOrderId) wsWhere.push({ razorpayOrderId: order.razorpayOrderId });
  if (order?.shopifyOrderId) wsWhere.push({ shopifyOrderId: order.shopifyOrderId });
  if (wsWhere.length) {
    await prisma.webStoreOrder.updateMany({
      where: { OR: wsWhere },
      data: { deliveryStatus },
    }).catch(() => {});
  }

  return localId;
}

/**
 * Create a forward shipment for an order.
 * Returns tracking_number, tracking_url, and courier name.
 */
export async function shipOrder(
  orderId: string,
  items: { title: string; sku?: string; quantity: number; price: number }[],
  address: {
    name: string;
    address1: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone?: string;
    email?: string;
  }
): Promise<ShipmentResult> {
  // Skip re-create if a real active shipment already exists
  const existing = await prisma.shipment.findFirst({
    where: { 
      orderId,
      status: { not: 'cancelled' },
    },
    orderBy: { createdAt: 'desc' },
  });
  const existingTn = existing?.trackingNumber || '';
  const isFakeExisting =
    !existingTn ||
    existingTn.startsWith('MOCK') ||
    String(existing?.courier || '').toLowerCase().includes('mock');
  if (existing && !isFakeExisting) {
    console.log(`[Logistics] Shipment already exists for ${orderId} (${existingTn}) — skipping create`);
    return {
      trackingNumber: existingTn,
      trackingUrl: existing.trackingUrl || undefined,
      courier: existing.courier || 'Shiprocket',
      shipmentId: existing.awb || undefined,
    };
  }
  if (existing && isFakeExisting) {
    console.warn(`[Logistics] Removing fake/MOCK shipment ${existingTn} for ${orderId}`);
    await prisma.shipment.deleteMany({
      where: {
        orderId,
        trackingNumber: { startsWith: 'MOCK' },
      },
    });
  }

  const config = await getLogisticsConfig();
  const preset = PROVIDER_PRESETS[config.provider];

  // Try real API
  if (config.provider !== 'mock' && preset) {
    try {
      let data: any;

      if (config.provider === 'shiprocket') {
        const dbOrder = await prisma.order.findFirst({
          where: {
            OR: [
              { id: orderId },
              { shopifyOrderId: orderId }
            ]
          },
          include: { items: true, customer: { select: { email: true } } },
        });

        const isCodOrder = isShiprocketCodOrder({
          paymentMethod: dbOrder?.paymentMethod,
          paymentStatus: dbOrder?.paymentStatus,
          tags: dbOrder?.tags,
          note: dbOrder?.note,
        });

        const {
          resolveStoredCodUpfrontPaid,
          buildShiprocketPaymentFields,
          getConfiguredCodUpfrontAmount,
          DEFAULT_COD_UPFRONT_AMOUNT,
        } = await import('@/lib/cod-upfront');
        let codUpfront = 0;
        if (isCodOrder) {
          const wsOrder = dbOrder?.razorpayOrderId
            ? await prisma.webStoreOrder.findFirst({ where: { razorpayOrderId: dbOrder.razorpayOrderId } })
            : null;
          const fallbackFee = await getConfiguredCodUpfrontAmount();
          codUpfront = resolveStoredCodUpfrontPaid({
            storedPaid: Number((dbOrder as any)?.codUpfrontPaid) || Number(wsOrder?.codUpfrontPaid) || 0,
            paymentStatus: dbOrder?.paymentStatus,
            paymentMethod: dbOrder?.paymentMethod,
            tags: dbOrder?.tags,
            note: dbOrder?.note,
            configuredFallback: fallbackFee || DEFAULT_COD_UPFRONT_AMOUNT,
          });
        }

        const shipItems =
          dbOrder?.items && dbOrder.items.length > 0
            ? dbOrder.items.map((i: any) => ({
                id: i.id,
                title: i.title,
                sku: i.sku || undefined,
                quantity: i.quantity,
                price: Number(i.price),
                variantId: i.variantId || undefined,
                variantTitle: i.variantTitle || undefined,
              }))
            : items.map((i, index) => ({
                id: `fallback-${index + 1}`,
                title: i.title,
                sku: i.sku || undefined,
                quantity: i.quantity,
                price: Number(i.price),
              }));

        const itemsSubtotal = shipItems.reduce(
          (s: number, i: any) => s + Number(i.price) * Number(i.quantity),
          0
        );
        const calculatedTotalPrice = Number(dbOrder?.totalPrice || itemsSubtotal);
        const paymentFields = buildShiprocketPaymentFields({
          orderTotal: calculatedTotalPrice,
          itemsSubtotal,
          upfrontPaid: codUpfront,
          isCod: isCodOrder,
        });

        const shiprocketOrderId =
          dbOrder?.internalOrderNumber ||
          dbOrder?.id ||
          orderId;

        const nameParts = String(address.name || 'Customer')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const billingFirstName = nameParts[0] || 'Customer';
        const billingLastName = nameParts.slice(1).join(' ') || '.';

        const phoneDigits = String(address.phone || '').replace(/\D/g, '');
        const billingPhone =
          phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
        const billingPincode = Number(String(address.zip || '').replace(/\D/g, '')) || 0;
        const defaultHsn = Number(process.env.SHIPROCKET_DEFAULT_HSN || 61091000);

        const billingState = String(address.province || '').trim();
        const billingCity = String(address.city || '').trim();
        const billingAddress1 = String(address.address1 || '').trim();
        const invalidState =
          !billingState ||
          /^unknown$/i.test(billingState) ||
          billingState === '000000';
        if (!billingAddress1 || !billingCity || invalidState || !billingPincode) {
          throw new Error(
            `Cannot book Shiprocket: incomplete shipping address ` +
              `(state="${billingState || '(empty)'}", city="${billingCity || '(empty)'}", ` +
              `pincode=${billingPincode || 0}). Fix the order address before booking.`
          );
        }

        const orderItems = buildShiprocketOrderItems(shipItems, defaultHsn);
        const pickup = await resolveShiprocketPickupLocation();

        const payload = {
          order_id: shiprocketOrderId,
          order_date: new Date().toISOString().split('T')[0],
          pickup_location: pickup.name,
          billing_customer_name: billingFirstName,
          billing_last_name: billingLastName,
          billing_address: billingAddress1,
          billing_city: billingCity,
          billing_pincode: billingPincode,
          billing_state: billingState,
          billing_country: address.country || 'India',
          billing_email:
            address.email || (dbOrder as any)?.customer?.email || undefined,
          billing_phone: billingPhone ? Number(billingPhone) : undefined,
          shipping_is_billing: true,
          order_items: orderItems,
          payment_method: paymentFields.payment_method,
          ...(paymentFields.total_discount != null
            ? { total_discount: paymentFields.total_discount }
            : {}),
          sub_total: paymentFields.sub_total,
          length: 20,
          breadth: 15,
          height: 10,
          weight: 0.5,
        };

        data = await logisticsApiFetch(preset.endpoints.createShipment, 'POST', payload);

        const srOrderId = data?.order_id ?? data?.payload?.order_id;
        const srShipmentId = data?.shipment_id ?? data?.payload?.shipment_id;
        const statusCode = data?.status_code ?? data?.payload?.status_code;
        let awbCode = String(data?.awb_code ?? data?.payload?.awb_code ?? '').trim();
        let courierName = data?.courier_name || data?.payload?.courier_name || '';

        if (process.env.LOGISTICS_DEBUG === '1') {
          console.log(
            `[Shiprocket] Create ${shiprocketOrderId}: order=${srOrderId} shipment=${srShipmentId} ` +
              `status=${statusCode} awb=${awbCode || 'none'} method=${paymentFields.payment_method}`
          );
        }

        if (!srOrderId && !srShipmentId) {
          throw new Error(
            `Shiprocket create returned no order_id/shipment_id: ${JSON.stringify(data).slice(0, 300)}`
          );
        }

        // Assign AWB (create alone leaves NEW with null awb_code). No auto-pickup.
        if (!awbCode && srShipmentId && preset.endpoints.assignAwb) {
          const assignData = await logisticsApiFetch(preset.endpoints.assignAwb, 'POST', {
            shipment_id: srShipmentId,
          });
          const assignPayload = assignData?.response?.data || assignData?.data || assignData;
          const assignedAwb = String(assignPayload?.awb_code || '').trim();
          const assignOk =
            assignData?.awb_assign_status === 1 || Boolean(assignedAwb);

          if (!assignOk || !assignedAwb) {
            console.error(
              `[Shiprocket] AWB assign failed for ${shiprocketOrderId} shipment=${srShipmentId} ` +
                `status=${assignData?.awb_assign_status}`
            );
            throw new Error(
              `Shiprocket AWB assign failed for shipment ${srShipmentId}`
            );
          }

          awbCode = assignedAwb;
          courierName = assignPayload?.courier_name || courierName || 'Shiprocket';
        }

        if (!awbCode) {
          throw new Error(
            `Shiprocket order ${srOrderId} created but no AWB was assigned (shipment ${srShipmentId})`
          );
        }

        const result: ShipmentResult = {
          trackingNumber: awbCode,
          trackingUrl: `https://shiprocket.co/tracking/${awbCode}`,
          courier: courierName || 'Shiprocket',
          shipmentId: srShipmentId != null ? String(srShipmentId) : undefined,
          shiprocketOrderId: srOrderId != null ? String(srOrderId) : undefined,
          awb: awbCode,
          status: 'confirmed',
          deliveryStatus: 'confirmed',
        };

        console.log(
          `[Shiprocket] Persisting ${shiprocketOrderId}: sr_order=${srOrderId} ` +
            `awb=${result.awb} courier=${result.courier}`
        );

        await persistShipmentAndDeliveryStatus(orderId, result);

        return result;
      }

      if (config.provider === 'delhivery') {
        const formData = new URLSearchParams();
        formData.append('format', 'json');

        const dbOrder = await prisma.order.findFirst({
          where: {
            OR: [
              { id: orderId },
              { shopifyOrderId: orderId }
            ]
          }
        });

        const isCodOrder = isShiprocketCodOrder({
          paymentMethod: dbOrder?.paymentMethod,
          paymentStatus: dbOrder?.paymentStatus,
          tags: dbOrder?.tags,
          note: dbOrder?.note,
        });

        let codUpfront = 0;
        if (isCodOrder) {
          const wsOrder = dbOrder?.razorpayOrderId
            ? await prisma.webStoreOrder.findFirst({ where: { razorpayOrderId: dbOrder.razorpayOrderId } })
            : null;
          const { resolveStoredCodUpfrontPaid, getConfiguredCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } = await import('@/lib/cod-upfront');
          const fallbackFee = await getConfiguredCodUpfrontAmount();
          codUpfront = resolveStoredCodUpfrontPaid({
            storedPaid: Number((dbOrder as any)?.codUpfrontPaid) || Number(wsOrder?.codUpfrontPaid) || 0,
            paymentStatus: dbOrder?.paymentStatus,
            paymentMethod: dbOrder?.paymentMethod,
            tags: dbOrder?.tags,
            note: dbOrder?.note,
            configuredFallback: fallbackFee || DEFAULT_COD_UPFRONT_AMOUNT,
          });
        }

        const calculatedTotalPrice = Number(dbOrder?.totalPrice || items.reduce((s: number, i: any) => s + (Number(i.price) * Number(i.quantity)), 0));
        const { getCodBalanceDue } = await import('@/lib/cod-upfront');
        const codBalanceDue = isCodOrder ? getCodBalanceDue(calculatedTotalPrice, codUpfront) : 0;
        const paymentMode = (isCodOrder && codBalanceDue > 0) ? 'COD' : 'Prepaid';

        const payload = {
          shipments: [
            {
              name: address.name,
              add: address.address1,
              pin: address.zip,
              city: address.city,
              state: address.province,
              country: address.country || 'India',
              phone: address.phone || '',
              order: orderId.replace('#', ''),
              payment_mode: paymentMode,
              return_pin: process.env.WAREHOUSE_PIN || '201301',
              return_city: process.env.WAREHOUSE_CITY || 'Noida',
              return_phone: process.env.WAREHOUSE_PHONE || '9220385011',
              return_name: 'Zica Bella Returns',
              return_add: process.env.WAREHOUSE_ADDRESS || 'C-43 sector-88 Noida 201301',
              products_desc: items.map(i => i.title).join(', '),
              cod_amount: paymentMode === 'COD' ? String(Math.round(codBalanceDue)) : '',
              order_date: new Date().toISOString(),
              total_amount: String(Math.round(calculatedTotalPrice)),
              seller_add: process.env.WAREHOUSE_ADDRESS || 'C-43 sector-88 Noida 201301',
              seller_name: 'Zica Bella',
              seller_inv: orderId.replace('#', ''),
              quantity: String(items.reduce((s, i) => s + i.quantity, 0)),
              weight: '500',
              seller_gst_tin: process.env.GST_NUMBER || '',
              shipment_length: 30,
              shipment_width: 20,
              shipment_height: 5,
              shipping_mode: 'Surface',
              address_type: 'home'
            }
          ],
          pickup_location: {
            name: process.env.DELHIVERY_PICKUP_LOCATION || 'Zica Bella Manufacturing Unit'
          }
        };

        formData.append('data', JSON.stringify(payload));

        const res = await fetch(`${config.baseUrl || PROVIDER_PRESETS.delhivery.baseUrl}${preset.endpoints.createShipment}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${config.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString()
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Delhivery Ship Error: ${errText}`);
        }

        const data = await res.json();
        if (data.packages && data.packages.length > 0) {
          const pkg = data.packages[0];
          if (pkg.waybill) {
            const trackingNumber = String(pkg.waybill);
            const result: ShipmentResult = {
              trackingNumber,
              trackingUrl: `https://www.delhivery.com/track/package/${trackingNumber}`,
              courier: 'Delhivery',
            };

            // Save shipment + delivery status on local Order / WebStoreOrder
            await persistShipmentAndDeliveryStatus(dbOrder?.id || orderId, result, {
              delhivery_awb: result.trackingNumber,
              status: 'Shipped',
            });

            return result;
          } else {
            throw new Error(pkg.remarks ? pkg.remarks.join(', ') : 'Fulfillment registration failed');
          }
        }

        throw new Error(data.errors ? data.errors.join(', ') : 'Unknown Delhivery response');
      }

      // Generic handler for other providers
      data = await logisticsApiFetch(preset.endpoints.createShipment, 'POST', {
        order_id: orderId,
        items,
        address,
      });

      const result: ShipmentResult = {
        trackingNumber: data?.tracking_number || data?.waybill || `TRK${Date.now()}`,
        trackingUrl: data?.tracking_url || '',
        courier: config.provider,
      };

      await persistShipmentAndDeliveryStatus(orderId, result);

      return result;
    } catch (err: any) {
      console.error(`[Logistics] ${config.provider} shipOrder failed for ${orderId}:`, err.message);
      throw err;
    }
  }

  console.error(
    `[Logistics] shipOrder aborted for ${orderId}: no logistics provider configured`
  );
  throw new Error(
    'Logistics booking failed: no Shiprocket/Delhivery provider configured'
  );
}

/**
 * Normalize Shiprocket tracking payload into our status vocabulary.
 */
export function mapShiprocketTrackingStatus(raw: unknown): string {
  const s = String(raw || '').toLowerCase().trim();
  if (!s || s === 'unknown' || s === 'null') return 'unknown';

  if (
    s.includes('cancel') ||
    s === '8' || // Shiprocket status id for Canceled (common)
    s.includes('cancelled')
  ) {
    return 'cancelled';
  }
  if (s.includes('rto') || s.includes('return to origin')) return 'rto';
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('out for delivery') || s.includes('ofd')) return 'out_for_delivery';
  if (s.includes('in transit') || s.includes('shipped') || s.includes('in-transit')) return 'in_transit';
  if (s.includes('pick') || s.includes('manifest')) return 'pickup_scheduled';
  if (s.includes('confirm') || s.includes('awb') || s.includes('label')) return 'confirmed';
  if (s.includes('pend') || s.includes('new') || s.includes('process')) return 'processing';

  // Numeric Shiprocket shipment_status ids we commonly see
  if (s === '7') return 'delivered';
  if (s === '6') return 'shipped';
  if (s === '17' || s === '18') return 'out_for_delivery';
  if (s === '42' || s === '15') return 'pickup_scheduled';

  return s.replace(/\s+/g, '_');
}

function applyDeliveryStatusFromShipment(
  shipStatus: string
): string | null {
  const s = shipStatus.toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'delivered') return 'delivered';
  if (s === 'out_for_delivery') return 'out_for_delivery';
  if (s === 'in_transit' || s === 'shipped') return 'shipped';
  if (s === 'pickup_scheduled' || s === 'picked_up') return 'pickup_scheduled';
  if (s === 'rto') return 'returned_to_origin';
  if (s === 'confirmed') return 'confirmed';
  return null;
}

/**
 * Get tracking status for a shipment by tracking number / AWB.
 */
export async function getTrackingStatus(trackingNumber: string): Promise<TrackingStatus> {
  const config = await getLogisticsConfig();
  const preset = PROVIDER_PRESETS[config.provider];

  // Try real API
  if (config.provider !== 'mock' && preset) {
    try {
      let data: any;

      if (config.provider === 'shiprocket') {
        // Prefer AWB track (dashboard stores AWB as trackingNumber after assign)
        try {
          data = await logisticsApiFetch(
            `${preset.endpoints.trackAwb}/${encodeURIComponent(trackingNumber)}`,
            'GET'
          );
        } catch {
          data = await logisticsApiFetch(
            `${preset.endpoints.trackShipment}/${encodeURIComponent(trackingNumber)}`,
            'GET'
          );
        }
        const tracking = data?.tracking_data || data;
        const trackStatus =
          tracking?.shipment_track?.[0]?.current_status ||
          tracking?.shipment_status ||
          tracking?.current_status?.status ||
          tracking?.track_status ||
          tracking?.shipment_status_id;
        const mapped = mapShiprocketTrackingStatus(trackStatus);
        return {
          status: mapped,
          location:
            tracking?.shipment_track?.[0]?.location ||
            tracking?.current_status?.location ||
            null,
          estimatedDelivery: tracking?.etd || null,
          trackingUrl: `https://shiprocket.co/tracking/${trackingNumber}`,
          events: (tracking?.shipment_track || []).map((e: any) => ({
            status: e.activity || e.current_status || '',
            location: e.location || '',
            timestamp: e.date || e.updated_time || '',
            description: e.activity || e.sr_status || '',
          })),
        };
      }

      if (config.provider === 'delhivery') {
        data = await logisticsApiFetch(`${preset.endpoints.trackShipment}/?waybill=${trackingNumber}`, 'GET');
        const pkg = data?.ShipmentData?.[0]?.Shipment;
        return {
          status: pkg?.Status?.Status || 'unknown',
          location: pkg?.Status?.StatusLocation || null,
          estimatedDelivery: pkg?.ExpectedDeliveryDate || null,
          trackingUrl: `https://www.delhivery.com/track/package/${trackingNumber}`,
          events: (pkg?.Scans || []).map((s: any) => ({
            status: s.ScanDetail?.Scan || '',
            location: s.ScanDetail?.ScannedLocation || '',
            timestamp: s.ScanDetail?.ScanDateTime || '',
            description: s.ScanDetail?.Instructions || '',
          })),
        };
      }

      // Generic
      data = await logisticsApiFetch(`${preset.endpoints.trackShipment}/${trackingNumber}`, 'GET');
      return {
        status: data?.status || 'unknown',
        location: data?.location || null,
        estimatedDelivery: data?.estimated_delivery || null,
        trackingUrl: data?.tracking_url || null,
        events: data?.events || [],
      };
    } catch (err: any) {
      console.error(`[Logistics] ${config.provider} getTrackingStatus failed:`, err.message);
    }
  }

  // Fallback: read from DB
  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [{ trackingNumber }, { awb: trackingNumber }],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (shipment) {
    return {
      status: shipment.status,
      location: shipment.currentLocation || null,
      estimatedDelivery: shipment.estimatedDelivery?.toISOString() || null,
      trackingUrl: shipment.trackingUrl || null,
      events: JSON.parse(shipment.events || '[]'),
    };
  }

  return { status: 'unknown', location: null, estimatedDelivery: null, trackingUrl: null, events: [] };
}

/**
 * Pull latest Shiprocket status into local Shipment + Order.deliveryStatus.
 */
export async function syncOrderLogisticsStatus(orderId: string): Promise<{
  success: boolean;
  shipmentStatus: string;
  deliveryStatus: string | null;
  message: string;
}> {
  const shipment = await prisma.shipment.findFirst({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });
  if (!shipment) {
    return {
      success: false,
      shipmentStatus: 'unknown',
      deliveryStatus: null,
      message: 'No shipment on this order',
    };
  }

  const trackRef = shipment.awb || shipment.trackingNumber;
  if (!trackRef) {
    return {
      success: false,
      shipmentStatus: shipment.status,
      deliveryStatus: null,
      message: 'Shipment has no AWB/tracking number yet',
    };
  }

  const status = await getTrackingStatus(trackRef);
  if (!status || status.status === 'unknown') {
    return {
      success: false,
      shipmentStatus: shipment.status,
      deliveryStatus: null,
      message: 'Shiprocket returned unknown status',
    };
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: status.status,
      currentLocation: status.location,
      estimatedDelivery: status.estimatedDelivery
        ? new Date(status.estimatedDelivery)
        : undefined,
      events: JSON.stringify(status.events || []),
      trackingUrl: status.trackingUrl || shipment.trackingUrl,
    },
  });

  const nextDelivery = applyDeliveryStatusFromShipment(status.status);
  if (nextDelivery) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        deliveryStatus: nextDelivery,
        ...(nextDelivery === 'cancelled'
          ? {} // keep order.status; logistics cancel ≠ full order cancel
          : {}),
      },
    });
  }

  return {
    success: true,
    shipmentStatus: status.status,
    deliveryStatus: nextDelivery,
    message: `Synced: shipment=${status.status}` +
      (nextDelivery ? `, delivery=${nextDelivery}` : ''),
  };
}

/**
 * Create a reverse pickup shipment for returns.
 */
export async function createReturnShipment(
  returnId: string,
  pickupAddress: {
    name: string;
    address1: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone?: string;
  }
): Promise<ShipmentResult> {
  const config = await getLogisticsConfig();
  const preset = PROVIDER_PRESETS[config.provider];

  if (config.provider !== 'mock' && preset) {
    try {
      if (config.provider === 'shiprocket') {
        const data = await logisticsApiFetch(preset.endpoints.createReturn, 'POST', {
          order_id: returnId,
          order_date: new Date().toISOString().split('T')[0],
          pickup_customer_name: pickupAddress.name,
          pickup_address: pickupAddress.address1,
          pickup_city: pickupAddress.city,
          pickup_pincode: pickupAddress.zip,
          pickup_state: pickupAddress.province,
          pickup_country: pickupAddress.country || 'India',
          pickup_phone: pickupAddress.phone || '',
        });

        return {
          trackingNumber: data?.order_id?.toString() || `RET${Date.now()}`,
          trackingUrl: `https://shiprocket.co/tracking/${data?.order_id}`,
          courier: data?.courier_name || 'Shiprocket Returns',
        };
      }

      if (config.provider === 'delhivery') {
        const formData = new URLSearchParams();
        formData.append('format', 'json');
        
        const returnOrder = await prisma.return.findFirst({
          where: {
            OR: [
              { id: returnId },
              { returnRequestId: returnId }
            ]
          },
          include: { order: true }
        });

        const payload = {
          shipments: [
            {
              name: pickupAddress.name,
              add: pickupAddress.address1,
              pin: pickupAddress.zip,
              city: pickupAddress.city,
              state: pickupAddress.province,
              country: pickupAddress.country || 'India',
              phone: pickupAddress.phone || '',
              order: returnOrder?.order?.shopifyOrderId?.replace('#', '') || returnId,
              payment_mode: 'Prepaid',
              product_type: 'R', // Reverse pickup
              return_pin: process.env.WAREHOUSE_PIN || '201301',
              return_city: process.env.WAREHOUSE_CITY || 'Noida',
              return_phone: process.env.WAREHOUSE_PHONE || '9220385011',
              return_name: 'Zica Bella Returns',
              return_add: process.env.WAREHOUSE_ADDRESS || 'C-43 sector-88 Noida 201301',
              products_desc: 'Return Items',
              order_date: new Date().toISOString(),
              total_amount: String(returnOrder?.refundAmount || '0'),
              seller_add: process.env.WAREHOUSE_ADDRESS || 'C-43 sector-88 Noida 201301',
              seller_name: 'Zica Bella',
              quantity: '1',
              weight: '500',
              shipment_length: 30,
              shipment_width: 20,
              shipment_height: 5,
              shipping_mode: 'Surface',
              address_type: 'home'
            }
          ],
          pickup_location: {
            name: process.env.DELHIVERY_PICKUP_LOCATION || 'Zica Bella Manufacturing Unit'
          }
        };

        formData.append('data', JSON.stringify(payload));

        const res = await fetch(`${config.baseUrl || PROVIDER_PRESETS.delhivery.baseUrl}${preset.endpoints.createReturn}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${config.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString()
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Delhivery Return Error: ${errText}`);
        }

        const data = await res.json();
        if (data.packages && data.packages.length > 0) {
          const pkg = data.packages[0];
          if (pkg.waybill) {
            return {
              trackingNumber: String(pkg.waybill),
              trackingUrl: `https://www.delhivery.com/track/package/${pkg.waybill}`,
              courier: 'Delhivery Returns',
            };
          }
        }
        throw new Error(data.errors ? data.errors.join(', ') : 'Unknown Delhivery response');
      }
    } catch (err: any) {
      console.error(`[Logistics] Return shipment creation failed:`, err.message);
      throw err;
    }
  }

  console.error('[Logistics] createReturnShipment aborted: no logistics provider configured');
  throw new Error('Return shipment failed: no Shiprocket/Delhivery provider configured');
}

/**
 * Parse Shiprocket ids stored on Shipment.rawDelhiveryResponse.
 */
export function parseShiprocketMeta(raw: string | null | undefined): ShiprocketShipmentMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.provider !== 'shiprocket') return null;
    return {
      provider: 'shiprocket',
      shipment_id: parsed.shipment_id ?? null,
      order_id: parsed.order_id ?? null,
      pickup_scheduled_at: parsed.pickup_scheduled_at ?? null,
      invoice_url: parsed.invoice_url ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Shared COD detection for courier serviceability + booking.
 * Must stay in sync across getShiprocketCouriers / bookShiprocketOrderWithCourier / shipOrder.
 */
export function isShiprocketCodOrder(order: {
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  tags?: string | null;
  note?: string | null;
}): boolean {
  const rawMethod = String(order.paymentMethod || '').toLowerCase().trim();
  const status = String(order.paymentStatus || '').toLowerCase().trim();
  const tagsLower = String(order.tags || '').toLowerCase();
  const noteLower = String(order.note || '').toLowerCase();
  return (
    rawMethod === 'cod' ||
    status === 'partially_paid' ||
    status === 'cod_upfront_paid' ||
    tagsLower.includes('cod') ||
    noteLower.includes('cod order') ||
    noteLower.includes('upfront fee paid')
  );
}

/**
 * Build Shiprocket order_items with unique SKUs.
 * Shiprocket rejects payloads where the same SKU appears on multiple lines
 * ("SKU cannot be repeated"). Missing or duplicate SKUs are uniquified using
 * variantId / line-item id / index — never a shared order-level fallback.
 */
export function buildShiprocketOrderItems(
  items: Array<{
    id?: string | null;
    title: string;
    sku?: string | null;
    quantity: number;
    price: number | string;
    variantId?: string | null;
    variantTitle?: string | null;
  }>,
  defaultHsn: number
): Array<{ name: string; sku: string; units: number; selling_price: number; hsn: number }> {
  const used = new Set<string>();

  const takeUnique = (candidate: string): string => {
    const base = (candidate || 'item').replace(/\s+/g, '-').slice(0, 40) || 'item';
    const key = base.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return base;
    }
    let n = 2;
    while (true) {
      const suffix = `-${n}`;
      const next = `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
      const nextKey = next.toLowerCase();
      if (!used.has(nextKey)) {
        used.add(nextKey);
        return next;
      }
      n += 1;
    }
  };

  return items.map((item, index) => {
    const rawSku = String(item.sku || '').trim();
    const variantId = String(item.variantId || '').trim();
    const lineId = String(item.id || '').trim();
    const preferred =
      rawSku ||
      (variantId ? `v-${variantId}` : '') ||
      (lineId ? `li-${lineId}` : '') ||
      `item-${index + 1}`;

    return {
      name: item.title,
      sku: takeUnique(preferred),
      units: item.quantity,
      selling_price: Number(item.price),
      hsn: defaultHsn,
    };
  });
}

async function getLatestShipmentForOrder(orderId: string) {
  return prisma.shipment.findFirst({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });
}

async function resolveShiprocketShipmentId(shipment: {
  awb: string | null;
  trackingNumber: string | null;
  rawDelhiveryResponse: string | null;
}): Promise<string> {
  const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse);
  if (meta?.shipment_id) return String(meta.shipment_id);

  const awb = shipment.awb || shipment.trackingNumber;
  if (!awb) {
    throw new Error('No Shiprocket shipment_id or AWB on this order');
  }

  const track = await logisticsApiFetch(
    `${PROVIDER_PRESETS.shiprocket.endpoints.trackAwb}?awb_code=${encodeURIComponent(awb)}`,
    'GET'
  );
  const shipmentId =
    track?.tracking_data?.shipment_id ||
    track?.shipment_id ||
    track?.tracking_data?.track_status?.[0]?.shipment_id;
  if (!shipmentId) {
    throw new Error(`Could not resolve Shiprocket shipment_id for AWB ${awb}`);
  }
  return String(shipmentId);
}

async function resolveShiprocketOrderId(shipment: {
  awb: string | null;
  trackingNumber: string | null;
  rawDelhiveryResponse: string | null;
}): Promise<string> {
  const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse);
  if (meta?.order_id) return String(meta.order_id);

  const awb = shipment.awb || shipment.trackingNumber;
  if (!awb) {
    throw new Error('No Shiprocket order_id or AWB on this order');
  }

  const track = await logisticsApiFetch(
    `${PROVIDER_PRESETS.shiprocket.endpoints.trackAwb}?awb_code=${encodeURIComponent(awb)}`,
    'GET'
  );
  const orderId =
    track?.tracking_data?.order_id ||
    track?.order_id ||
    track?.tracking_data?.shipment_track?.[0]?.order_id;
  if (!orderId) {
    throw new Error(`Could not resolve Shiprocket order_id for AWB ${awb}`);
  }
  return String(orderId);
}

// ─── Types for courier selection ────────────────────────────────────────────

export interface CourierOption {
  courier_company_id: number;
  courier_name: string;
  rate: number;
  estimated_delivery_days: number | null;
  cod: boolean;
  min_weight: number;
  charge_weight: number;
  freight_charge: number;
  cod_charges: number;
}

let cachedPickupPincode: { pincode: string; expiresAt: number } | null = null;
let cachedPickupLocation: { name: string; pincode: string; expiresAt: number } | null = null;

type ShiprocketPickupAddress = {
  pickup_location?: string;
  pin_code?: string | number;
  is_primary_location?: number | boolean;
  status?: number | string;
};

/**
 * Resolve Shiprocket pickup location for new orders/AWBs.
 * Always prefer the Primary address. Never fall back to a hard-coded "warehouse"
 * name — that inactive location was causing courier calls to the old address.
 */
export async function resolveShiprocketPickupLocation(preferredName?: string): Promise<{
  name: string;
  pincode: string;
}> {
  const envName = (preferredName || process.env.SHIPROCKET_PICKUP_LOCATION || '').trim();
  const envPin = (process.env.SHIPROCKET_PICKUP_PINCODE || '').trim();

  if (cachedPickupLocation && cachedPickupLocation.expiresAt > Date.now()) {
    // If env forces a specific name and cache matches, reuse; otherwise refresh when env differs
    if (!envName || cachedPickupLocation.name.toLowerCase() === envName.toLowerCase()) {
      return { name: cachedPickupLocation.name, pincode: cachedPickupLocation.pincode };
    }
  }

  try {
    const data = await logisticsApiFetch('/settings/company/pickup', 'GET', undefined, true);
    const addresses: ShiprocketPickupAddress[] = data?.data?.shipping_address || [];
    const active = addresses.filter((a) => {
      const status = a.status;
      // Shiprocket uses 1/active for usable locations; keep unknowns
      if (status === 0 || status === '0' || status === 'Inactive' || status === 'inactive') return false;
      return true;
    });
    const pool = active.length > 0 ? active : addresses;

    const byName = (name: string) =>
      pool.find((a) => String(a.pickup_location || '').toLowerCase().trim() === name.toLowerCase());

    // 1) Explicit env name (if set and still active)
    let matched = envName ? byName(envName) : undefined;

    // 2) Primary location
    if (!matched) {
      matched = pool.find((a) => a.is_primary_location === 1 || a.is_primary_location === true);
    }

    // 3) First active address — never invent "warehouse"
    if (!matched && pool.length > 0) {
      matched = pool[0];
    }

    const name = String(matched?.pickup_location || envName || '').trim();
    const pin = String(matched?.pin_code || envPin || process.env.WAREHOUSE_PIN || '').trim();

    if (!name) {
      throw new Error(
        'No active Shiprocket pickup location found. Mark a Primary address in Shiprocket, or set SHIPROCKET_PICKUP_LOCATION.'
      );
    }

    if (pin && pin.length >= 6) {
      cachedPickupLocation = { name, pincode: pin, expiresAt: Date.now() + 3600 * 1000 };
      cachedPickupPincode = { pincode: pin, expiresAt: Date.now() + 3600 * 1000 };
    }

    return { name, pincode: pin || (process.env.WAREHOUSE_PIN || '121002').trim() };
  } catch (err: any) {
    console.warn('[Logistics] Could not resolve Shiprocket pickup locations:', err?.message || err);
    if (envName) {
      return { name: envName, pincode: envPin || (process.env.WAREHOUSE_PIN || '121002').trim() };
    }
    throw new Error(
      'Shiprocket pickup location unavailable. Ensure Primary address is active in Shiprocket dashboard.'
    );
  }
}

export async function getShiprocketPickupPincode(pickupLocationName?: string): Promise<string> {
  const envPin = (process.env.SHIPROCKET_PICKUP_PINCODE || '').trim();
  if (envPin && envPin.length >= 6) {
    return envPin;
  }

  if (cachedPickupPincode && cachedPickupPincode.expiresAt > Date.now()) {
    return cachedPickupPincode.pincode;
  }

  const resolved = await resolveShiprocketPickupLocation(pickupLocationName);
  return resolved.pincode;
}

export interface CourierServiceabilityResult {
  available_courier_companies: CourierOption[];
  shiprocket_recommended_courier_id: number | null;
  message?: string | null;
}

/**
 * Fetch available Shiprocket courier options for an order with given parcel dimensions.
 * Used by the dashboard to let the team choose which courier to use before booking.
 */
export async function getShiprocketCouriers(
  orderId: string,
  parcel: { weight: number; length: number; breadth: number; height: number }
): Promise<CourierServiceabilityResult> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }

  // Get order details for pickup + delivery pincode
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { shopifyOrderId: orderId }] },
    include: { items: true },
  });
  if (!order) throw new Error(`Order ${orderId} not found`);

  const shippingAddress = order.shippingAddress ? JSON.parse(order.shippingAddress) : null;
  const deliveryPincode = String(shippingAddress?.zip || shippingAddress?.pincode || '').replace(/\D/g, '');
  if (!deliveryPincode || deliveryPincode.length < 6) {
    throw new Error('Cannot check couriers: delivery pincode is missing or invalid for this order');
  }

  const pickupPincode = await getShiprocketPickupPincode();

  const isCodOrder = isShiprocketCodOrder(order);
  const codUpfront = Number((order as any).codUpfrontPaid || 0);
  const codAmount = isCodOrder ? Math.max(0, Number(order.totalPrice || 0) - codUpfront) : 0;

  // Build query params for serviceability check
  const params = new URLSearchParams({
    pickup_postcode: pickupPincode,
    delivery_postcode: deliveryPincode,
    weight: String(parcel.weight),
    length: String(parcel.length),
    breadth: String(parcel.breadth),
    height: String(parcel.height),
    cod: isCodOrder ? '1' : '0',
  });
  if (isCodOrder && codAmount > 0) {
    params.set('cod_amount', String(codAmount));
  }

  const data = await logisticsApiFetch(
    `/courier/serviceability/?${params.toString()}`,
    'GET',
    undefined,
    true
  );

  const rawCompanies = data?.data?.available_courier_companies || [];
  const companies: CourierOption[] = rawCompanies.map((c: any) => ({
    courier_company_id: c.courier_company_id,
    courier_name: c.courier_name,
    rate: Number(c.rate || 0),
    estimated_delivery_days: c.estimated_delivery_days != null ? Number(c.estimated_delivery_days) : null,
    cod: Boolean(c.cod),
    min_weight: Number(c.min_weight || 0),
    charge_weight: Number(c.charge_weight || parcel.weight),
    freight_charge: Number(c.freight_charge || 0),
    cod_charges: Number(c.cod_charges || 0),
  }));

  const responseMessage = data?.message || (data?.errors ? JSON.stringify(data.errors) : null);
  if (companies.length === 0) {
    console.warn(`[Logistics] No couriers returned from Shiprocket for pickup=${pickupPincode} -> delivery=${deliveryPincode}. Msg: ${responseMessage}`);
  }

  return {
    available_courier_companies: companies,
    shiprocket_recommended_courier_id: data?.data?.shiprocket_recommended_courier_id ?? null,
    message: responseMessage,
  };
}

/**
 * Assign AWB to a chosen courier and update an existing local shipment row.
 */
async function assignCourierAwbAndPersist(
  localOrderId: string,
  shipmentRowId: string,
  srShipmentId: string,
  srOrderId: string | number | null | undefined,
  courierId: number,
  courierName: string
): Promise<ShipmentResult> {
  const assignData = await logisticsApiFetch(PROVIDER_PRESETS.shiprocket.endpoints.assignAwb, 'POST', {
    shipment_id: srShipmentId,
    courier_id: courierId,
  });
  const assignPayload = assignData?.response?.data || assignData?.data || assignData;
  const assignedAwb = String(assignPayload?.awb_code || '').trim();
  const assignOk = assignData?.awb_assign_status === 1 || Boolean(assignedAwb);
  if (!assignOk || !assignedAwb) {
    const pkg =
      assignPayload?.packages?.[0] ||
      assignData?.response?.data?.packages?.[0] ||
      null;
    const carrierReason =
      pkg?.err_code ||
      pkg?.remarks ||
      pkg?.reason ||
      pkg?.status ||
      assignPayload?.awb_assign_error ||
      assignData?.message ||
      'rejected';
    console.error('[Shiprocket] AWB assign rejected', {
      courierId,
      courierName,
      shipmentId: srShipmentId,
      carrierReason,
      package: {
        status: pkg?.status,
        err_code: pkg?.err_code,
        remarks: pkg?.remarks,
        payment: pkg?.payment,
        cod_amount: pkg?.cod_amount,
        serviceable: pkg?.serviceable,
        refnum: pkg?.refnum,
      },
    });
    throw new Error(
      `${courierName} could not assign an AWB for this shipment. ` +
        `Try a different courier (another provider often works when one rejects). ` +
        `Shipment is saved — you can retry without recreating the order.`
    );
  }

  const finalCourierName = assignPayload?.courier_name || courierName;
  const meta: ShiprocketShipmentMeta = {
    provider: 'shiprocket',
    shipment_id: srShipmentId,
    order_id: srOrderId ?? null,
  };

  await prisma.shipment.update({
    where: { id: shipmentRowId },
    data: {
      awb: assignedAwb,
      trackingNumber: assignedAwb,
      trackingUrl: `https://shiprocket.co/tracking/${assignedAwb}`,
      courier: finalCourierName,
      status: 'confirmed',
      rawDelhiveryResponse: JSON.stringify(meta),
      events: JSON.stringify([
        {
          status: 'confirmed',
          location: 'Warehouse',
          timestamp: new Date().toISOString(),
          description: `Shipment booked with AWB ${assignedAwb}`,
        },
      ]),
    },
  });
  await prisma.order.update({
    where: { id: localOrderId },
    data: { deliveryStatus: 'confirmed' },
  });

  console.log(
    `[Shiprocket] AWB ${assignedAwb} assigned via courier ${finalCourierName} for order ${localOrderId}`
  );

  return {
    trackingNumber: assignedAwb,
    trackingUrl: `https://shiprocket.co/tracking/${assignedAwb}`,
    courier: finalCourierName,
    shipmentId: String(srShipmentId),
    shiprocketOrderId: srOrderId != null ? String(srOrderId) : undefined,
    awb: assignedAwb,
    status: 'confirmed',
    deliveryStatus: 'confirmed',
  };
}

/**
 * Create a Shiprocket order (without auto-assigning AWB) and then assign AWB
 * for a specific courier_id chosen by the operations team.
 * Persists the Shiprocket shipment_id before AWB assign so failures can be resumed.
 */
export async function bookShiprocketOrderWithCourier(
  orderId: string,
  parcel: { weight: number; length: number; breadth: number; height: number },
  courierId: number,
  courierName: string
): Promise<ShipmentResult> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }

  const preset = PROVIDER_PRESETS.shiprocket;
  const { resolveLocalOrderId } = await import('@/lib/services/orderLifecycleService');
  const localOrderId = (await resolveLocalOrderId(orderId)) || orderId;

  // Check for existing non-cancelled non-fake shipment
  const existing = await prisma.shipment.findFirst({
    where: { orderId: localOrderId, status: { not: 'cancelled' } },
    orderBy: { createdAt: 'desc' },
  });
  const existingTn = existing?.trackingNumber || '';
  const isFakeExisting =
    !existingTn || existingTn.startsWith('MOCK') || String(existing?.courier || '').toLowerCase().includes('mock');
  if (existing && !isFakeExisting && existing.awb) {
    console.log(`[Logistics] Shipment already booked for ${localOrderId} (AWB: ${existing.awb}) — returning existing`);
    return {
      trackingNumber: existing.awb,
      trackingUrl: existing.trackingUrl || `https://shiprocket.co/tracking/${existing.awb}`,
      courier: existing.courier || courierName,
      awb: existing.awb,
      shipmentId: parseShiprocketMeta(existing.rawDelhiveryResponse)?.shipment_id
        ? String(parseShiprocketMeta(existing.rawDelhiveryResponse)!.shipment_id)
        : undefined,
      status: existing.status,
    };
  }

  // Resume: Shiprocket order exists locally but AWB assign previously failed
  if (existing && !isFakeExisting && !existing.awb) {
    const meta = parseShiprocketMeta(existing.rawDelhiveryResponse);
    if (meta?.shipment_id) {
      console.log(
        `[Shiprocket] Resuming AWB assign for ${localOrderId}: shipment=${meta.shipment_id} courier_id=${courierId}`
      );
      return assignCourierAwbAndPersist(
        localOrderId,
        existing.id,
        String(meta.shipment_id),
        meta.order_id,
        courierId,
        courierName
      );
    }
  }

  if (existing && isFakeExisting) {
    await prisma.shipment.deleteMany({
      where: { orderId: localOrderId, trackingNumber: { startsWith: 'MOCK' } },
    });
  }

  const dbOrder = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { id: localOrderId }, { shopifyOrderId: orderId }] },
    include: { items: true, customer: { select: { email: true } } },
  });
  if (!dbOrder) throw new Error(`Order ${orderId} not found`);

  const rawShippingAddress = dbOrder.shippingAddress ? JSON.parse(dbOrder.shippingAddress) : {};
  const address = {
    name: rawShippingAddress.name || dbOrder.customer?.email || 'Customer',
    address1: rawShippingAddress.street || rawShippingAddress.address1 || rawShippingAddress.line1 || '',
    city: rawShippingAddress.city || '',
    province: rawShippingAddress.state || rawShippingAddress.province || '',
    zip: rawShippingAddress.zip || rawShippingAddress.pincode || '',
    country: rawShippingAddress.country || 'India',
    phone: rawShippingAddress.phone || '',
    email: rawShippingAddress.email || dbOrder.customer?.email || '',
  };

  const billingState = String(address.province).trim();
  const billingCity = String(address.city).trim();
  const billingPincode = Number(String(address.zip).replace(/\D/g, '')) || 0;
  const billingAddress1 = String(address.address1).trim();
  if (!billingAddress1 || !billingCity || !billingState || !billingPincode) {
    throw new Error(
      `Cannot book Shiprocket: incomplete shipping address (state="${billingState || '(empty)'}",` +
      ` city="${billingCity || '(empty)'}", pincode=${billingPincode || 0})`
    );
  }

  const isCodOrder = isShiprocketCodOrder(dbOrder);

  const {
    resolveStoredCodUpfrontPaid,
    buildShiprocketPaymentFields,
    getConfiguredCodUpfrontAmount,
    DEFAULT_COD_UPFRONT_AMOUNT,
  } = await import('@/lib/cod-upfront');
  let codUpfront = 0;
  if (isCodOrder) {
    const wsOrder = dbOrder.razorpayOrderId
      ? await prisma.webStoreOrder.findFirst({ where: { razorpayOrderId: dbOrder.razorpayOrderId } })
      : null;
    const fallbackFee = await getConfiguredCodUpfrontAmount();
    codUpfront = resolveStoredCodUpfrontPaid({
      storedPaid: Number((dbOrder as any)?.codUpfrontPaid) || Number(wsOrder?.codUpfrontPaid) || 0,
      paymentStatus: dbOrder.paymentStatus,
      paymentMethod: dbOrder.paymentMethod,
      tags: dbOrder.tags,
      note: dbOrder.note,
      configuredFallback: fallbackFee || DEFAULT_COD_UPFRONT_AMOUNT,
    });
  }

  const itemsSubtotal = dbOrder.items.reduce((s: number, i: { price: any; quantity: any }) => s + Number(i.price) * Number(i.quantity), 0);
  const calculatedTotalPrice = Number(dbOrder.totalPrice || itemsSubtotal);
  const paymentFields = buildShiprocketPaymentFields({
    orderTotal: calculatedTotalPrice,
    itemsSubtotal,
    upfrontPaid: codUpfront,
    isCod: isCodOrder,
  });

  const shiprocketOrderId = dbOrder.internalOrderNumber || dbOrder.id;
  const nameParts = String(address.name).trim().split(/\s+/).filter(Boolean);
  const phoneDigits = String(address.phone).replace(/\D/g, '');
  const billingPhone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
  const defaultHsn = Number(process.env.SHIPROCKET_DEFAULT_HSN || 61091000);

  const orderItems = buildShiprocketOrderItems(
    dbOrder.items.map((i: {
      id: string;
      title: string;
      sku?: string | null;
      quantity: number;
      price: any;
      variantId?: string | null;
      variantTitle?: string | null;
    }) => ({
      id: i.id,
      title: i.title,
      sku: i.sku,
      quantity: i.quantity,
      price: i.price,
      variantId: i.variantId,
      variantTitle: i.variantTitle,
    })),
    defaultHsn
  );

  const pickup = await resolveShiprocketPickupLocation();

  const payload = {
    order_id: shiprocketOrderId,
    order_date: new Date().toISOString().split('T')[0],
    pickup_location: pickup.name,
    billing_customer_name: nameParts[0] || 'Customer',
    billing_last_name: nameParts.slice(1).join(' ') || '.',
    billing_address: billingAddress1,
    billing_city: billingCity,
    billing_pincode: billingPincode,
    billing_state: billingState,
    billing_country: address.country || 'India',
    billing_email: address.email || (dbOrder as any)?.customer?.email || undefined,
    billing_phone: billingPhone ? Number(billingPhone) : undefined,
    shipping_is_billing: true,
    order_items: orderItems,
    payment_method: paymentFields.payment_method,
    ...(paymentFields.total_discount != null ? { total_discount: paymentFields.total_discount } : {}),
    sub_total: paymentFields.sub_total,
    length: parcel.length,
    breadth: parcel.breadth,
    height: parcel.height,
    weight: parcel.weight,
  };

  const createData = await logisticsApiFetch(preset.endpoints.createShipment, 'POST', payload);
  const srOrderId = createData?.order_id ?? createData?.payload?.order_id;
  const srShipmentId = createData?.shipment_id ?? createData?.payload?.shipment_id;
  if (!srOrderId && !srShipmentId) {
    throw new Error(`Shiprocket create returned no order_id/shipment_id: ${JSON.stringify(createData).slice(0, 300)}`);
  }
  if (!srShipmentId) {
    throw new Error(
      `Shiprocket create returned order_id=${srOrderId} but no shipment_id — cannot assign AWB`
    );
  }

  // Persist before AWB assign so a failed/timed-out assign can be resumed
  const localId =
    (await persistShipmentAndDeliveryStatus(localOrderId, {
      trackingNumber: String(srShipmentId),
      courier: courierName,
      shipmentId: String(srShipmentId),
      shiprocketOrderId: srOrderId != null ? String(srOrderId) : undefined,
      awb: null,
      status: 'new',
      deliveryStatus: 'processing',
    })) || localOrderId;

  const pendingShipment = await prisma.shipment.findFirst({
    where: { orderId: localId, status: { not: 'cancelled' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!pendingShipment) {
    throw new Error(`Failed to persist preliminary Shiprocket shipment for order ${localId}`);
  }

  console.log(
    `[Shiprocket] Order created for ${shiprocketOrderId}: sr_order=${srOrderId} shipment=${srShipmentId}`
  );

  return assignCourierAwbAndPersist(
    localId,
    pendingShipment.id,
    String(srShipmentId),
    srOrderId,
    courierId,
    courierName
  );
}

/**
 * Assign AWB for an existing Shiprocket shipment (dashboard retry).
 */
export async function assignShiprocketAwb(orderId: string): Promise<ShipmentResult> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }

  const shipment = await getLatestShipmentForOrder(orderId);
  if (!shipment) {
    throw new Error('No shipment found for this order — book a shipment first');
  }
  if (shipment.awb) {
    return {
      trackingNumber: shipment.awb,
      trackingUrl: shipment.trackingUrl || `https://shiprocket.co/tracking/${shipment.awb}`,
      courier: shipment.courier || 'Shiprocket',
      awb: shipment.awb,
      shipmentId: parseShiprocketMeta(shipment.rawDelhiveryResponse)?.shipment_id
        ? String(parseShiprocketMeta(shipment.rawDelhiveryResponse)!.shipment_id)
        : undefined,
      status: shipment.status,
    };
  }

  const shipmentId = await resolveShiprocketShipmentId(shipment);
  const assignData = await logisticsApiFetch(PROVIDER_PRESETS.shiprocket.endpoints.assignAwb, 'POST', {
    shipment_id: shipmentId,
  });
  const assignPayload = assignData?.response?.data || assignData?.data || assignData;
  const assignedAwb = String(assignPayload?.awb_code || '').trim();
  if (!assignedAwb) {
    throw new Error(`Shiprocket AWB assign failed: ${JSON.stringify(assignData).slice(0, 300)}`);
  }

  const courierName = assignPayload?.courier_name || shipment.courier || 'Shiprocket';
  const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse) || {
    provider: 'shiprocket' as const,
    shipment_id: shipmentId,
    order_id: null,
  };
  meta.shipment_id = shipmentId;

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      awb: assignedAwb,
      trackingNumber: assignedAwb,
      trackingUrl: `https://shiprocket.co/tracking/${assignedAwb}`,
      courier: courierName,
      status: 'confirmed',
      rawDelhiveryResponse: JSON.stringify(meta),
    },
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { deliveryStatus: 'confirmed' },
  });

  return {
    trackingNumber: assignedAwb,
    trackingUrl: `https://shiprocket.co/tracking/${assignedAwb}`,
    courier: courierName,
    awb: assignedAwb,
    shipmentId,
    status: 'confirmed',
    deliveryStatus: 'confirmed',
  };
}

/**
 * Schedule courier pickup for a Shiprocket shipment (dashboard).
 */
export async function generateShiprocketPickup(orderId: string): Promise<{
  success: boolean;
  message: string;
  pickup_scheduled_date?: string | null;
}> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }

  const shipment = await getLatestShipmentForOrder(orderId);
  if (!shipment) {
    throw new Error('No shipment found for this order — book + assign AWB first');
  }
  if (!shipment.awb) {
    throw new Error('AWB not assigned yet — assign AWB before scheduling pickup');
  }

  const shipmentId = await resolveShiprocketShipmentId(shipment);
  const data = await logisticsApiFetch(PROVIDER_PRESETS.shiprocket.endpoints.generatePickup, 'POST', {
    shipment_id: [Number(shipmentId) || shipmentId],
  });

  const pickupDate =
    data?.response?.pickup_scheduled_date ||
    data?.pickup_scheduled_date ||
    data?.data?.pickup_scheduled_date ||
    null;
  const message =
    data?.response?.data ||
    data?.message ||
    (data?.pickup_status === 1 ? 'Pickup scheduled' : JSON.stringify(data).slice(0, 200));

  const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse) || {
    provider: 'shiprocket' as const,
    shipment_id: shipmentId,
    order_id: null,
  };
  meta.shipment_id = shipmentId;
  meta.pickup_scheduled_at = pickupDate || new Date().toISOString();

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: 'pickup_scheduled',
      rawDelhiveryResponse: JSON.stringify(meta),
    },
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { deliveryStatus: 'pickup_scheduled' },
  });

  return {
    success: true,
    message: typeof message === 'string' ? message : 'Pickup scheduled',
    pickup_scheduled_date: pickupDate,
  };
}

/**
 * Generate shipping label PDF URL from Shiprocket.
 */
export async function generateShiprocketLabel(orderId: string): Promise<{ labelUrl: string }> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }

  const shipment = await getLatestShipmentForOrder(orderId);
  if (!shipment) {
    throw new Error('No shipment found for this order');
  }
  if (!shipment.awb) {
    throw new Error('AWB not assigned yet — cannot print label');
  }
  if (shipment.labelUrl) {
    return { labelUrl: shipment.labelUrl };
  }

  const shipmentId = await resolveShiprocketShipmentId(shipment);
  const data = await logisticsApiFetch(PROVIDER_PRESETS.shiprocket.endpoints.generateLabel, 'POST', {
    shipment_id: [Number(shipmentId) || shipmentId],
  });
  const labelUrl = data?.label_url || data?.label_url?.[0] || data?.response?.label_url;
  if (!labelUrl) {
    throw new Error(`Shiprocket label generation failed: ${JSON.stringify(data).slice(0, 300)}`);
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { labelUrl: String(labelUrl) },
  });

  return { labelUrl: String(labelUrl) };
}

/**
 * Generate invoice PDF URL from Shiprocket (POST /orders/print/invoice).
 */
export async function generateShiprocketInvoice(orderId: string): Promise<{ invoiceUrl: string }> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }

  const shipment = await getLatestShipmentForOrder(orderId);
  if (!shipment) {
    throw new Error('No shipment found for this order');
  }
  if (!shipment.awb) {
    throw new Error('AWB not assigned yet — cannot print invoice');
  }

  const existingMeta = parseShiprocketMeta(shipment.rawDelhiveryResponse);
  if (existingMeta?.invoice_url) {
    return { invoiceUrl: String(existingMeta.invoice_url) };
  }

  const srOrderId = await resolveShiprocketOrderId(shipment);
  const numericId = Number(srOrderId);
  const data = await logisticsApiFetch(PROVIDER_PRESETS.shiprocket.endpoints.generateInvoice, 'POST', {
    ids: [Number.isFinite(numericId) ? numericId : srOrderId],
  });

  const invoiceUrl =
    data?.invoice_url ||
    data?.invoice_url?.[0] ||
    data?.response?.invoice_url ||
    (Array.isArray(data) ? data[0]?.invoice_url : null);

  if (!invoiceUrl) {
    throw new Error(`Shiprocket invoice generation failed: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const meta: ShiprocketShipmentMeta = existingMeta || {
    provider: 'shiprocket',
    shipment_id: null,
    order_id: srOrderId,
  };
  meta.order_id = meta.order_id ?? srOrderId;
  meta.invoice_url = String(invoiceUrl);

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { rawDelhiveryResponse: JSON.stringify(meta) },
  });

  return { invoiceUrl: String(invoiceUrl) };
}

/**
 * Cancel a shipment (only if in Confirmed/Packed state).
 */
export async function cancelShipment(trackingNumber: string): Promise<{ success: boolean; message: string }> {
  const config = await getLogisticsConfig();
  const preset = PROVIDER_PRESETS[config.provider];

  // Check shipment in DB first (AWB or tracking number)
  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [{ trackingNumber }, { awb: trackingNumber }],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!shipment) {
    return { success: false, message: 'Shipment not found' };
  }

  const cancellableStatuses = [
    'confirmed',
    'packed',
    'label_created',
    'pickup_scheduled',
    'new',
    'processing',
    'cancelled', // allow re-attempt when local was marked cancelled but SR order still open
  ];
  if (!cancellableStatuses.includes(shipment.status)) {
    return { success: false, message: `Cannot cancel shipment in "${shipment.status}" state. Only cancellable in: ${cancellableStatuses.join(', ')}` };
  }

  if (config.provider !== 'mock' && preset) {
    try {
      if (config.provider === 'delhivery') {
        const res = await fetch(`${config.baseUrl || PROVIDER_PRESETS.delhivery.baseUrl}${preset.endpoints.cancelShipment}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            waybill: trackingNumber,
            cancellation: true
          })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Delhivery Cancel Error: ${text}`);
        }
      } else if (config.provider === 'shiprocket') {
        const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse);
        const awb = (shipment.awb || trackingNumber || '').trim();
        const orderCancelId = meta?.order_id;
        let orderCancelled = false;
        let awbCancelled = false;
        const errors: string[] = [];

        // 1) Cancel AWB if present
        if (awb && !/^MOCK/i.test(awb)) {
          try {
            await logisticsApiFetch('/orders/cancel/shipment/awbs', 'POST', {
              awbs: [awb],
            });
            awbCancelled = true;
            console.log(`[Logistics] Shiprocket AWB cancel ok for ${awb}`);
          } catch (awbCancelErr: any) {
            errors.push(`AWB cancel: ${awbCancelErr.message}`);
            console.warn(`[Logistics] Shiprocket AWB cancel failed for ${awb}:`, awbCancelErr.message);
          }
        }

        // 2) Always cancel Shiprocket ORDER (otherwise it stays NEW with no AWB)
        if (orderCancelId) {
          try {
            await logisticsApiFetch(preset.endpoints.cancelShipment, 'POST', {
              ids: [Number(orderCancelId) || orderCancelId],
            });
            orderCancelled = true;
            console.log(`[Logistics] Shiprocket order cancel ok for id=${orderCancelId}`);
          } catch (orderCancelErr: any) {
            errors.push(`Order cancel: ${orderCancelErr.message}`);
            console.warn(
              `[Logistics] Shiprocket order cancel failed for ${orderCancelId}:`,
              orderCancelErr.message
            );
          }
        } else {
          errors.push('No Shiprocket order_id on shipment — SR order may remain NEW');
        }

        if (!orderCancelled && !awbCancelled) {
          throw new Error(errors.join('; ') || 'Shiprocket cancel failed');
        }
        if (!orderCancelled) {
          throw new Error(
            `Shipment/AWB may be cleared, but Shiprocket order was not cancelled: ${errors.join('; ')}`
          );
        }
      } else {
        await logisticsApiFetch(preset.endpoints.cancelShipment, 'POST', {
          ids: [trackingNumber],
        });
      }
    } catch (err: any) {
      console.error(`[Logistics] Cancel shipment failed:`, err.message);
      return { success: false, message: err.message || 'Cancel failed on carrier' };
    }
  }

  // Clear AWB/tracking on the row so admin UI cannot keep showing a voided label.
  // This cancels the *courier shipment* only — customer order stays ACTIVE so ops can rebook.
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: 'cancelled',
      awb: null,
      trackingUrl: null,
      labelUrl: null,
    },
  });

  if (shipment.orderId) {
    // Reset delivery to pending — shipment cancel is not an order cancel.
    // Customer Order History must stay Active until admin cancels the order itself.
    await prisma.order.update({
      where: { id: shipment.orderId },
      data: { 
        deliveryStatus: 'pending',
        delhivery_awb: null,
      },
    }).catch(() => {});

    const targetOrder = await prisma.order.findUnique({
      where: { id: shipment.orderId },
      select: { internalOrderNumber: true, razorpayOrderId: true, shopifyOrderId: true },
    }).catch(() => null);

    const wsWhere: Array<Record<string, string>> = [];
    if (targetOrder?.internalOrderNumber) wsWhere.push({ orderNumber: targetOrder.internalOrderNumber });
    if (targetOrder?.razorpayOrderId) wsWhere.push({ razorpayOrderId: targetOrder.razorpayOrderId });
    if (targetOrder?.shopifyOrderId) wsWhere.push({ shopifyOrderId: targetOrder.shopifyOrderId });
    if (wsWhere.length) {
      await prisma.webStoreOrder.updateMany({
        where: { OR: wsWhere },
        data: { deliveryStatus: 'pending', trackingNumber: null, trackingUrl: null },
      }).catch(() => {});
    }
  }

  return { success: true, message: 'Shipment cancelled successfully' };
}

/**
 * Test connection to the logistics provider.
 */
export async function testConnection(): Promise<{ success: boolean; provider: string; message: string }> {
  const config = await getLogisticsConfig();

  if (config.provider === 'mock') {
    return { success: true, provider: 'mock', message: 'Running in mock mode — no logistics API configured.' };
  }

  const preset = PROVIDER_PRESETS[config.provider];
  if (!preset) {
    return { success: false, provider: config.provider, message: 'Unknown provider preset.' };
  }

  try {
    await logisticsApiFetch(preset.endpoints.ping, 'GET');
    return { success: true, provider: config.provider, message: `Connected to ${config.provider} successfully.` };
  } catch (err: any) {
    return { success: false, provider: config.provider, message: `Connection failed: ${err.message}` };
  }
}

/**
 * Resolves the Delhivery webhook secret prioritizing process.env over DB.
 */
export async function resolveWebhookSecret(): Promise<{ secret: string; source: 'env' | 'db' | 'none' }> {
  const envSecret = process.env.DELHIVERY_WEBHOOK_SECRET?.trim();
  if (envSecret) return { secret: envSecret, source: 'env' };

  const shop = await prisma.shop.findFirst({ select: { webhookSecret: true } });
  if (shop?.webhookSecret?.trim()) return { secret: shop.webhookSecret.trim(), source: 'db' };

  return { secret: '', source: 'none' };
}

/**
 * Validate a webhook signature from the logistics partner.
 * - provider === 'delhivery': supports static shared-secret token comparison (default) or HMAC-SHA256 based on DELHIVERY_WEBHOOK_MODE env ('token' | 'hmac').
 * - provider === 'shiprocket' / 'generic': HMAC-SHA256 hex comparison.
 */
export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  provider: 'delhivery' | 'shiprocket' | 'generic' = 'generic'
): boolean {
  if (!secret || !signature) return false;

  try {
    const cleanSignature = signature
      .replace(/^sha256=/i, '')
      .replace(/^Bearer\s+/i, '')
      .replace(/^Token\s+/i, '')
      .trim();
    const cleanSecret = secret.trim();

    if (provider === 'delhivery') {
      const mode = (process.env.DELHIVERY_WEBHOOK_MODE || 'token').trim().toLowerCase();
      if (mode === 'token') {
        const sigBuf = Buffer.from(cleanSignature);
        const secretBuf = Buffer.from(cleanSecret);

        // Safe diagnostic fragments — never log full secrets
        const secretTail = cleanSecret.slice(-4);
        const tokenHead = cleanSignature.slice(0, 12);

        if (sigBuf.length !== secretBuf.length) {
          console.warn(`[Logistics] Webhook validation failed: mode=token, provider=delhivery, reason=length_mismatch (received=${sigBuf.length}, expected=${secretBuf.length}), token_head=${tokenHead}..., secret_tail=****${secretTail}`);
          return false;
        }

        const matches = crypto.timingSafeEqual(sigBuf, secretBuf);
        if (!matches) {
          console.warn(`[Logistics] Webhook validation failed: mode=token, provider=delhivery, reason=stored secret does not match received token, token_head=${tokenHead}..., secret_tail=****${secretTail}`);
        }
        return matches;
      }
    }

    // HMAC-SHA256 comparison for shiprocket/generic or delhivery in hmac mode
    const expectedSignature = crypto
      .createHmac('sha256', cleanSecret)
      .update(payload)
      .digest('hex');

    if (cleanSignature.length !== expectedSignature.length) {
      if (provider === 'delhivery') {
        const secretTail = cleanSecret.slice(-4);
        const tokenHead = cleanSignature.slice(0, 12);
        console.warn(`[Logistics] Webhook validation failed: mode=hmac, provider=delhivery, reason=signature_length_mismatch (received=${cleanSignature.length}, expected=${expectedSignature.length}), token_head=${tokenHead}..., secret_tail=****${secretTail}`);
      }
      return false;
    }

    const matches = crypto.timingSafeEqual(
      Buffer.from(cleanSignature),
      Buffer.from(expectedSignature)
    );
    if (!matches && provider === 'delhivery') {
      const secretTail = cleanSecret.slice(-4);
      const tokenHead = cleanSignature.slice(0, 12);
      console.warn(`[Logistics] Webhook validation failed: mode=hmac, provider=delhivery, reason=hmac_digest_mismatch, token_head=${tokenHead}..., secret_tail=****${secretTail}`);
    }
    return matches;
  } catch (err) {
    console.error('[Logistics] Webhook signature validation error:', err);
    return false;
  }
}
