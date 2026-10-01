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
  /** Real AWB/waybill only — not Shiprocket order_id */
  awb?: string | null;
  status?: string;
  deliveryStatus?: string;
}

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
      console.error('[Shiprocket Auth] Login failed:', text);
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
    console.error(`[Logistics API] ${method} ${url} → ${res.status}: ${text}`);
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

  await prisma.shipment.create({
    data: {
      orderId: localId,
      trackingNumber: result.trackingNumber,
      awb: awbValue || undefined,
      trackingUrl: result.trackingUrl || null,
      courier: result.courier,
      status: shipmentStatus,
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
  // Skip re-create if a real shipment already exists
  const existing = await prisma.shipment.findFirst({
    where: { orderId },
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

        const rawMethod = (dbOrder?.paymentMethod || '').toLowerCase();
        const tagsLower = (dbOrder?.tags || '').toLowerCase();
        const noteLower = (dbOrder?.note || '').toLowerCase();
        const isCodOrder = rawMethod === 'cod' || tagsLower.includes('cod') || noteLower.includes('cod order') || noteLower.includes('upfront fee paid');

        const {
          resolveStoredCodUpfrontPaid,
          buildShiprocketPaymentFields,
          DEFAULT_COD_UPFRONT_AMOUNT,
        } = await import('@/lib/cod-upfront');
        let codUpfront = 0;
        if (isCodOrder) {
          const wsOrder = dbOrder?.razorpayOrderId
            ? await prisma.webStoreOrder.findFirst({ where: { razorpayOrderId: dbOrder.razorpayOrderId } })
            : null;
          codUpfront = resolveStoredCodUpfrontPaid({
            storedPaid: Number((dbOrder as any)?.codUpfrontPaid) || Number(wsOrder?.codUpfrontPaid) || 0,
            paymentStatus: dbOrder?.paymentStatus,
            paymentMethod: dbOrder?.paymentMethod,
            tags: dbOrder?.tags,
            note: dbOrder?.note,
            configuredFallback: DEFAULT_COD_UPFRONT_AMOUNT,
          });
        }

        const shipItems =
          dbOrder?.items && dbOrder.items.length > 0
            ? dbOrder.items.map((i: any) => ({
                title: i.title,
                sku: i.sku || undefined,
                quantity: i.quantity,
                price: Number(i.price),
              }))
            : items;

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

        const payload = {
          order_id: shiprocketOrderId,
          order_date: new Date().toISOString().split('T')[0],
          pickup_location:
            process.env.SHIPROCKET_PICKUP_LOCATION || 'warehouse',
          billing_customer_name: billingFirstName,
          billing_last_name: billingLastName,
          billing_address: address.address1,
          billing_city: address.city,
          billing_pincode: billingPincode,
          billing_state: address.province,
          billing_country: address.country || 'India',
          billing_email:
            address.email || (dbOrder as any)?.customer?.email || undefined,
          billing_phone: billingPhone ? Number(billingPhone) : undefined,
          shipping_is_billing: true,
          order_items: shipItems.map((i: { title: string; sku?: string; quantity: number; price: number }) => ({
            name: i.title,
            sku: i.sku || `sku-${shiprocketOrderId}`.slice(0, 40),
            units: i.quantity,
            selling_price: i.price,
            hsn: defaultHsn,
          })),
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

        console.log(
          `[Shiprocket] Booking ${shiprocketOrderId}: method=${paymentFields.payment_method} ` +
            `total=₹${calculatedTotalPrice} upfront=₹${paymentFields.upfrontPaid} ` +
            `sub_total=₹${paymentFields.sub_total} total_discount=₹${paymentFields.total_discount ?? 0} ` +
            `→ Shiprocket collects ₹${paymentFields.shiprocketCollectable}`
        );

        data = await logisticsApiFetch(preset.endpoints.createShipment, 'POST', payload);

        const srOrderId = data?.order_id ?? data?.payload?.order_id;
        const srShipmentId = data?.shipment_id ?? data?.payload?.shipment_id;
        const statusCode = data?.status_code ?? data?.payload?.status_code;
        let awbCode = String(data?.awb_code ?? data?.payload?.awb_code ?? '').trim();
        let courierName = data?.courier_name || data?.payload?.courier_name || '';

        console.log(
          `[Shiprocket] Create response for ${shiprocketOrderId}:`,
          JSON.stringify({
            order_id: srOrderId,
            shipment_id: srShipmentId,
            status_code: statusCode,
            status: data?.status,
            awb_code: awbCode || null,
            message: data?.message,
          })
        );

        if (!srOrderId && !srShipmentId) {
          throw new Error(
            `Shiprocket create returned no order_id/shipment_id: ${JSON.stringify(data).slice(0, 300)}`
          );
        }

        // Assign AWB (create alone leaves NEW with null awb_code). No auto-pickup.
        if (!awbCode && srShipmentId && preset.endpoints.assignAwb) {
          console.log(
            `[Shiprocket] Assigning AWB for shipment_id=${srShipmentId} (order ${shiprocketOrderId})`
          );
          const assignData = await logisticsApiFetch(preset.endpoints.assignAwb, 'POST', {
            shipment_id: srShipmentId,
          });
          const assignPayload = assignData?.response?.data || assignData?.data || assignData;
          const assignedAwb = String(assignPayload?.awb_code || '').trim();
          const assignOk =
            assignData?.awb_assign_status === 1 || Boolean(assignedAwb);

          console.log(
            `[Shiprocket] AWB assign for ${shiprocketOrderId}:`,
            JSON.stringify({
              awb_assign_status: assignData?.awb_assign_status,
              awb_code: assignedAwb || null,
              courier_name: assignPayload?.courier_name || null,
              message: assignData?.message,
              error: assignPayload?.awb_assign_error || assignData?.response?.data?.awb_assign_error,
            })
          );

          if (!assignOk || !assignedAwb) {
            throw new Error(
              `Shiprocket AWB assign failed for shipment ${srShipmentId}: ` +
                `${JSON.stringify(assignData).slice(0, 400)}`
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

        const rawMethod = (dbOrder?.paymentMethod || '').toLowerCase();
        const tagsLower = (dbOrder?.tags || '').toLowerCase();
        const noteLower = (dbOrder?.note || '').toLowerCase();
        const isCodOrder = rawMethod === 'cod' || tagsLower.includes('cod') || noteLower.includes('cod order') || noteLower.includes('upfront fee paid');

        let codUpfront = 0;
        if (isCodOrder) {
          const wsOrder = dbOrder?.razorpayOrderId
            ? await prisma.webStoreOrder.findFirst({ where: { razorpayOrderId: dbOrder.razorpayOrderId } })
            : null;
          const { resolveStoredCodUpfrontPaid, DEFAULT_COD_UPFRONT_AMOUNT } = await import('@/lib/cod-upfront');
          codUpfront = resolveStoredCodUpfrontPaid({
            storedPaid: Number((dbOrder as any)?.codUpfrontPaid) || Number(wsOrder?.codUpfrontPaid) || 0,
            paymentStatus: dbOrder?.paymentStatus,
            paymentMethod: dbOrder?.paymentMethod,
            tags: dbOrder?.tags,
            note: dbOrder?.note,
            configuredFallback: DEFAULT_COD_UPFRONT_AMOUNT,
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
 * Get tracking status for a shipment by tracking number.
 */
export async function getTrackingStatus(trackingNumber: string): Promise<TrackingStatus> {
  const config = await getLogisticsConfig();
  const preset = PROVIDER_PRESETS[config.provider];

  // Try real API
  if (config.provider !== 'mock' && preset) {
    try {
      let data: any;

      if (config.provider === 'shiprocket') {
        data = await logisticsApiFetch(`${preset.endpoints.trackShipment}/${trackingNumber}`, 'GET');
        const tracking = data?.tracking_data;
        return {
          status: tracking?.shipment_status_id?.toString() || 'unknown',
          location: tracking?.current_status?.location || null,
          estimatedDelivery: tracking?.etd || null,
          trackingUrl: `https://shiprocket.co/tracking/${trackingNumber}`,
          events: (tracking?.shipment_track || []).map((e: any) => ({
            status: e.activity,
            location: e.location,
            timestamp: e.date,
            description: e.activity,
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
    where: { trackingNumber },
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
 * Cancel a shipment (only if in Confirmed/Packed state).
 */
export async function cancelShipment(trackingNumber: string): Promise<{ success: boolean; message: string }> {
  const config = await getLogisticsConfig();
  const preset = PROVIDER_PRESETS[config.provider];

  // Check shipment in DB first
  const shipment = await prisma.shipment.findFirst({
    where: { trackingNumber },
  });

  if (!shipment) {
    return { success: false, message: 'Shipment not found' };
  }

  const cancellableStatuses = ['confirmed', 'packed', 'label_created', 'pickup_scheduled'];
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
      } else {
        await logisticsApiFetch(preset.endpoints.cancelShipment, 'POST', {
          ids: [trackingNumber],
        });
      }
    } catch (err: any) {
      console.error(`[Logistics] Cancel shipment failed:`, err.message);
      // Still mark as cancelled in DB
    }
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { status: 'cancelled' },
  });

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
