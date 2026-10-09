/**
 * Logistics Service — Server-side only
 * 
 * Unified interface for logistics partner APIs (Shiprocket primary; Blue Dart/FedEx/Custom presets unused).
 * API keys are NEVER exposed to the client or mobile app.
 * 
 * Data flow: Logistics API → Backend → DB → GET /api/orders/{id} → App
 */

import prisma from '@/lib/db';
import * as crypto from 'crypto';
import { normalizeCarrierStatus, REVERSE_SHIPMENT_TYPES } from '@/lib/logistics/status';

// ─── Types ──────────────────────────────────────────────────────────

export interface TrackingEvent {
  status: string;
  location: string;
  timestamp: string;
  description: string;
}

export interface TrackingStatus {
  status: string;
  /** Provider's own status text/id (for display and audit). */
  rawStatus?: string;
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
  /** Preserved after final cancel so sync can still poll Shiprocket. */
  voided_awb?: string | null;
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

/** Provider currently configured for this shop ('shiprocket' | 'mock'). */
export async function getActiveLogisticsProvider(): Promise<string> {
  const config = await getLogisticsConfig();
  return config.provider;
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
  headers['Authorization'] = `Bearer ${config.apiKey}`;

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
      NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } },
      status: {
        notIn: ['cancelled', 'canceled', 'cancellation_requested', 'rto', 'rto_delivered', 'lost'],
      },
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
          include: { items: true, customer: { select: { name: true, email: true, phone: true } } },
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

        const defaultHsn = Number(process.env.SHIPROCKET_DEFAULT_HSN || 61091000);
        const consignee = buildShiprocketConsignee({
          name: address.name || (dbOrder as any)?.customer?.name,
          address1: address.address1,
          city: address.city,
          state: address.province,
          zip: address.zip,
          country: address.country,
          phone: address.phone || (dbOrder as any)?.customer?.phone,
          email: address.email || (dbOrder as any)?.customer?.email,
        });

        const orderItems = buildShiprocketOrderItems(shipItems, defaultHsn);
        const pickup = await resolveShiprocketPickupLocation();

        const payload = {
          order_id: shiprocketOrderId,
          order_date: new Date().toISOString().split('T')[0],
          pickup_location: pickup.name,
          ...consignee,
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
    'Logistics booking failed: no Shiprocket provider configured'
  );
}

/**
 * Normalize Shiprocket tracking payload into our status vocabulary.
 */
export function mapShiprocketTrackingStatus(raw: unknown): string {
  const canonical = normalizeCarrierStatus(raw);
  if (canonical !== 'unknown') return canonical;

  const s = String(raw || '').toLowerCase().trim();
  if (!s || s === 'unknown' || s === 'null') return 'unknown';
  if (s.includes('pend') || s.includes('new') || s.includes('process')) return 'processing';
  return s.replace(/\s+/g, '_');
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
        // Scan history lives in shipment_track_activities (shipment_track is the
        // per-shipment summary). Fall back to the summary for older payloads.
        const scanSource: any[] =
          Array.isArray(tracking?.shipment_track_activities) && tracking.shipment_track_activities.length > 0
            ? tracking.shipment_track_activities
            : tracking?.shipment_track || [];
        return {
          status: mapped,
          rawStatus: trackStatus !== undefined && trackStatus !== null ? String(trackStatus) : undefined,
          location:
            tracking?.shipment_track_activities?.[0]?.location ||
            tracking?.shipment_track?.[0]?.location ||
            tracking?.current_status?.location ||
            null,
          estimatedDelivery: tracking?.etd || null,
          trackingUrl: `https://shiprocket.co/tracking/${trackingNumber}`,
          events: scanSource.map((e: any) => ({
            status: e.activity || e['sr-status-label'] || e.current_status || e.status || '',
            location: e.location || '',
            timestamp: e.date || e.updated_time || '',
            description: e.activity || e.sr_status || '',
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
      rawStatus: shipment.status,
      location: shipment.currentLocation || null,
      estimatedDelivery: shipment.estimatedDelivery?.toISOString() || null,
      trackingUrl: shipment.trackingUrl || null,
      events: JSON.parse(shipment.events || '[]'),
    };
  }

  return { status: 'unknown', location: null, estimatedDelivery: null, trackingUrl: null, events: [] };
}

export type ShiprocketOrderCancelState =
  | 'cancelled'
  | 'cancellation_requested'
  | 'active'
  | 'unknown';

/**
 * Real Shiprocket ORDER status (not courier tracking). Courier tracking never
 * reflects an order-level cancel, so this is the source of truth for
 * "Cancellation Requested" vs final "Canceled".
 */
export async function getShiprocketOrderCancelState(
  srOrderId: string | number | null | undefined
): Promise<{ state: ShiprocketOrderCancelState; raw: string | null }> {
  if (srOrderId === null || srOrderId === undefined || String(srOrderId).trim() === '') {
    return { state: 'unknown', raw: null };
  }
  try {
    const res = await logisticsApiFetch(
      `/orders/show/${encodeURIComponent(String(srOrderId).trim())}`,
      'GET'
    );
    const d = res?.data || res;
    const raw = String(d?.status ?? '').trim();
    const code = Number(d?.status_code);
    const norm = normalizeCarrierStatus(raw);
    // Shiprocket order status_code: 5 = Canceled, 18 = Cancellation Requested.
    if (norm === 'cancelled' || code === 5) return { state: 'cancelled', raw: raw || 'Canceled' };
    if (norm === 'cancellation_requested' || code === 18) {
      return { state: 'cancellation_requested', raw: raw || 'Cancellation Requested' };
    }
    if (!raw && !Number.isFinite(code)) return { state: 'unknown', raw: null };
    return { state: 'active', raw: raw || null };
  } catch (err: any) {
    console.warn(`[Logistics] SR order status lookup failed for ${srOrderId}:`, err?.message || err);
    return { state: 'unknown', raw: null };
  }
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
  // Outbound parcel only — "Sync Status" on an order must never pick up a return / exchange pickup.
  const shipment = await prisma.shipment.findFirst({
    where: { orderId, NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } } },
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

  // Prefer live AWB; fall back to voided_awb preserved at cancel time (do NOT
  // write voided_awb back onto the row — cancel clears AWB so ops can rebook).
  const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse);
  const trackRef =
    String(shipment.awb || meta?.voided_awb || '').trim() ||
    (shipment.trackingNumber && !/^CANCELLED-/i.test(shipment.trackingNumber)
      ? shipment.trackingNumber
      : '');
  if (!trackRef) {
    return {
      success: false,
      shipmentStatus: shipment.status,
      deliveryStatus: null,
      message: 'Shipment has no AWB/tracking number yet',
    };
  }

  const { refreshShipmentFromCarrier } = await import('@/lib/services/shipmentStatusService');
  const refreshed = await refreshShipmentFromCarrier(shipment.id);
  if (!refreshed.tracking || refreshed.tracking.status === 'unknown') {
    return {
      success: false,
      shipmentStatus: shipment.status,
      deliveryStatus: null,
      message: 'Carrier returned unknown status',
    };
  }

  const { toOrderDeliveryStatus } = await import('@/lib/logistics/status');
  const applied = refreshed.result;
  const nextDelivery =
    applied && applied.applied && !applied.isReverse ? toOrderDeliveryStatus(applied.status) : null;

  return {
    success: true,
    shipmentStatus: applied?.status && applied.status !== 'unknown' ? applied.status : refreshed.tracking.status,
    deliveryStatus: nextDelivery,
    message: `Synced: shipment=${refreshed.tracking.status}` +
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


    } catch (err: any) {
      console.error(`[Logistics] Return shipment creation failed:`, err.message);
      throw err;
    }
  }

  console.error('[Logistics] createReturnShipment aborted: no logistics provider configured');
  throw new Error('Return shipment failed: no Shiprocket provider configured');
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
 * Normalize consignee fields for Shiprocket create/assign.
 * Delhivery (via Shiprocket) rejects with ER0005 "suspicious order/consignee" when
 * phone is missing/short, last name is a placeholder like ".", or address has junk chars.
 */
function sanitizeShiprocketText(value: string, maxLen = 190): string {
  return String(value || '')
    .replace(/[&#%;\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function buildShiprocketConsignee(args: {
  name?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}): {
  billing_customer_name: string;
  billing_last_name: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_pincode: number;
  billing_country: string;
  billing_email?: string;
  billing_phone: string;
} {
  const nameParts = sanitizeShiprocketText(args.name || 'Customer')
    .split(/\s+/)
    .filter(Boolean);
  const firstName = nameParts[0] || 'Customer';
  // Never send "." / "-" — Delhivery flags those as suspicious last names.
  const lastName = nameParts.slice(1).join(' ').trim() || firstName;

  const phoneDigits = String(args.phone || '').replace(/\D/g, '');
  const billingPhone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : '';
  if (!/^[6-9]\d{9}$/.test(billingPhone)) {
    throw new Error(
      `Cannot book Shiprocket: consignee needs a valid 10-digit Indian mobile (got "${args.phone || '(empty)'}"). ` +
        `Update the order shipping phone, then cancel any pending Shiprocket shipment and rebook.`
    );
  }

  const billingAddress = sanitizeShiprocketText(args.address1 || '', 190);
  const billingCity = sanitizeShiprocketText(args.city || '', 50);
  const billingState = sanitizeShiprocketText(args.state || '', 50);
  const billingPincode = Number(String(args.zip || '').replace(/\D/g, '')) || 0;
  const invalidState =
    !billingState ||
    /^unknown$/i.test(billingState) ||
    billingState === '000000';

  if (
    !billingAddress ||
    billingAddress.length < 5 ||
    !billingCity ||
    invalidState ||
    !/^[1-9]\d{5}$/.test(String(billingPincode))
  ) {
    throw new Error(
      `Cannot book Shiprocket: incomplete or invalid shipping address ` +
        `(address="${billingAddress || '(empty)'}", city="${billingCity || '(empty)'}", ` +
        `state="${billingState || '(empty)'}", pincode=${billingPincode || 0}).`
    );
  }

  const email = sanitizeShiprocketText(args.email || '', 100);
  return {
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: billingAddress,
    billing_city: billingCity,
    billing_state: billingState,
    billing_pincode: billingPincode,
    billing_country: sanitizeShiprocketText(args.country || 'India', 50) || 'India',
    ...(email.includes('@') ? { billing_email: email } : {}),
    // Shiprocket accepts string; keep as string so leading digits are never coerced away.
    billing_phone: billingPhone,
  };
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

/**
 * Latest FORWARD shipment for an order. Return/exchange pickups (reverse) are never
 * returned — otherwise label/invoice/pickup would act on the customer's return AWB.
 * Prefers a live (non-cancelled) shipment; falls back to the newest outbound one.
 */
async function getLatestShipmentForOrder(orderId: string) {
  const outbound = { orderId, NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } } };
  const live = await prisma.shipment.findFirst({
    where: { ...outbound, status: { notIn: ['cancelled', 'canceled'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (live) return live;
  return prisma.shipment.findFirst({
    where: outbound,
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
    const errCode = String(pkg?.err_code || '').trim();
    const remarksRaw = pkg?.remarks;
    const remarks = Array.isArray(remarksRaw)
      ? remarksRaw.filter(Boolean).map(String).join('; ')
      : remarksRaw
        ? String(remarksRaw)
        : '';
    const carrierReason =
      errCode ||
      remarks ||
      pkg?.reason ||
      pkg?.status ||
      assignPayload?.awb_assign_error ||
      assignData?.message ||
      'rejected';
    const { shouldLogThrottled } = await import('@/lib/log-throttle');
    if (shouldLogThrottled('shiprocket:awb:rejected', 60_000)) {
      console.warn('[Shiprocket] AWB assign rejected', {
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
    }

    const isSuspiciousConsignee =
      /ER0005/i.test(errCode) || /suspicious\s+order\/consignee/i.test(remarks);

    if (isSuspiciousConsignee) {
      // Prefix lets bookShiprocketOrderWithCourier auto-cancel + recreate once.
      throw new Error(
        `SHIPROCKET_CONSIGNEE_REJECT: ${courierName} rejected this consignee (ER0005` +
          `${remarks ? ` — ${remarks}` : ''}).`
      );
    }

    throw new Error(
      `${courierName} could not assign an AWB` +
        `${errCode ? ` (${errCode})` : ''}` +
        `${remarks ? `: ${remarks}` : ''}. ` +
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

  // Best-effort pickup request at the Shiprocket warehouse (`pickup_location` from create).
  // Many couriers already queue pickup on AWB assign — "Already in Pickup Queue" is success.
  let pickupScheduled = false;
  try {
    const pickup = await requestShiprocketPickup(srShipmentId);
    pickupScheduled = pickup.queued;
    if (pickupScheduled) {
      meta.pickup_scheduled_at = pickup.pickup_scheduled_date || new Date().toISOString();
      await prisma.shipment.update({
        where: { id: shipmentRowId },
        data: {
          status: 'pickup_scheduled',
          rawDelhiveryResponse: JSON.stringify(meta),
        },
      });
      await prisma.order
        .update({
          where: { id: localOrderId },
          data: { deliveryStatus: 'pickup_scheduled' },
        })
        .catch(() => {});
    }
  } catch (pickupErr: any) {
    console.warn(
      `[Shiprocket] Pickup request after AWB failed for ${srShipmentId}:`,
      pickupErr?.message || pickupErr
    );
  }

  return {
    trackingNumber: assignedAwb,
    trackingUrl: `https://shiprocket.co/tracking/${assignedAwb}`,
    courier: finalCourierName,
    shipmentId: String(srShipmentId),
    shiprocketOrderId: srOrderId != null ? String(srOrderId) : undefined,
    awb: assignedAwb,
    status: pickupScheduled ? 'pickup_scheduled' : 'confirmed',
    deliveryStatus: pickupScheduled ? 'pickup_scheduled' : 'confirmed',
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

  // Forward shipments only — a return/exchange pickup must never be mistaken for the
  // order's own booking, and an RTO'd / lost parcel is no longer "booked".
  const outboundOnly = { orderId: localOrderId, NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } } };
  const latestOutbound = await prisma.shipment.findFirst({
    where: outboundOnly,
    orderBy: { createdAt: 'desc' },
  });
  const latestOutboundCode = latestOutbound ? normalizeCarrierStatus(latestOutbound.status) : 'unknown';
  if (latestOutboundCode === 'rto') {
    throw new Error(
      'This order is RTO in progress — the parcel has not reached the warehouse yet. ' +
        'Reassign a courier after the RTO is received (or mark it received first).'
    );
  }
  const isRtoReship = latestOutboundCode === 'rto_delivered' || latestOutboundCode === 'lost';

  // Check for existing live, non-fake shipment
  // cancellation_requested = void in progress — allow a fresh booking alongside it.
  const existing = await prisma.shipment.findFirst({
    where: {
      ...outboundOnly,
      status: {
        notIn: ['cancelled', 'canceled', 'cancellation_requested', 'rto', 'rto_delivered', 'lost'],
      },
    },
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
  // (e.g. try another courier). Cannot assign AWB on a Shiprocket order that is
  // already cancelled — mark local draft dead and create a fresh SR order below.
  let rebookAfterSrCancelled = false;
  if (existing && !isFakeExisting && !existing.awb) {
    const meta = parseShiprocketMeta(existing.rawDelhiveryResponse);
    if (meta?.shipment_id) {
      console.log(
        `[Shiprocket] Resuming AWB assign for ${localOrderId}: shipment=${meta.shipment_id} courier_id=${courierId}`
      );
      try {
        return await assignCourierAwbAndPersist(
          localOrderId,
          existing.id,
          String(meta.shipment_id),
          meta.order_id,
          courierId,
          courierName
        );
      } catch (resumeErr: any) {
        const resumeMsg = String(resumeErr?.message || '');
        const isConsigneeReject = /SHIPROCKET_CONSIGNEE_REJECT/i.test(resumeMsg);
        const isSrCancelled = /order is in cancelled state/i.test(resumeMsg);

        if (isConsigneeReject) {
          console.warn(
            `[Shiprocket] Consignee reject on resume for ${localOrderId} — cancelling draft SR shipment ${meta.shipment_id}`
          );
          const cancelKey = existing.trackingNumber || existing.awb || String(meta.shipment_id);
          const cancelled = await cancelShipment(cancelKey);
          if (!cancelled.success) {
            // SR may already be cancelled — still clear local so we can create fresh.
            await prisma.shipment
              .update({
                where: { id: existing.id },
                data: { status: 'cancelled', awb: null, trackingUrl: null, labelUrl: null },
              })
              .catch(() => {});
            console.warn(
              `[Shiprocket] Draft cancel note for ${cancelKey}: ${cancelled.message} — clearing local row`
            );
          }
          rebookAfterSrCancelled = true;
        } else if (isSrCancelled) {
          console.warn(
            `[Shiprocket] Resume blocked — SR shipment ${meta.shipment_id} is already cancelled. Creating a fresh order.`
          );
          await prisma.shipment
            .update({
              where: { id: existing.id },
              data: { status: 'cancelled', awb: null, trackingUrl: null, labelUrl: null },
            })
            .catch(() => {});
          rebookAfterSrCancelled = true;
        } else {
          throw resumeErr;
        }
      }
    }
  }

  if (existing && isFakeExisting) {
    await prisma.shipment.deleteMany({
      where: { orderId: localOrderId, trackingNumber: { startsWith: 'MOCK' } },
    });
  }

  const dbOrder = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { id: localOrderId }, { shopifyOrderId: orderId }] },
    include: { items: true, customer: { select: { name: true, email: true, phone: true } } },
  });
  if (!dbOrder) throw new Error(`Order ${orderId} not found`);

  const rawShippingAddress = dbOrder.shippingAddress ? JSON.parse(dbOrder.shippingAddress) : {};
  const address = {
    name: rawShippingAddress.name || (dbOrder as any).customer?.name || 'Customer',
    address1: rawShippingAddress.street || rawShippingAddress.address1 || rawShippingAddress.line1 || '',
    city: rawShippingAddress.city || '',
    province: rawShippingAddress.state || rawShippingAddress.province || '',
    zip: rawShippingAddress.zip || rawShippingAddress.pincode || '',
    country: rawShippingAddress.country || 'India',
    phone: rawShippingAddress.phone || (dbOrder as any).customer?.phone || '',
    email: rawShippingAddress.email || (dbOrder as any).customer?.email || '',
  };
  const consignee = buildShiprocketConsignee({
    name: address.name,
    address1: address.address1,
    city: address.city,
    state: address.province,
    zip: address.zip,
    country: address.country,
    phone: address.phone,
    email: address.email,
  });

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

  // Re-shipping after an RTO, or rebooking after a cancelled SR draft: the previous
  // channel order_id is still reserved on Shiprocket, so use a fresh suffix.
  const baseChannelOrderId = dbOrder.internalOrderNumber || dbOrder.id;
  const priorOutboundBookings =
    isRtoReship || rebookAfterSrCancelled
      ? await prisma.shipment.count({ where: outboundOnly })
      : 0;
  const shiprocketOrderId = isRtoReship
    ? `${baseChannelOrderId}-RS${Math.max(priorOutboundBookings, 1)}`
    : rebookAfterSrCancelled
      ? `${baseChannelOrderId}-R${Math.max(priorOutboundBookings, 1)}`
      : baseChannelOrderId;
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
    ...consignee,
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

  console.log('[Shiprocket] Create shipment payload', {
    localOrderId,
    courierId,
    courierName,
    rawAddress: {
      name: address.name,
      address1: address.address1,
      city: address.city,
      province: address.province,
      zip: address.zip,
      country: address.country,
      phone: address.phone,
      email: address.email,
    },
    consignee,
    payment: {
      payment_method: paymentFields.payment_method,
      sub_total: paymentFields.sub_total,
      total_discount: paymentFields.total_discount ?? null,
      isCod: isCodOrder,
      codUpfront,
    },
    parcel,
    pickup_location: pickup.name,
    order_id: payload.order_id,
    order_items: orderItems.map((i) => ({
      name: i.name,
      sku: i.sku,
      units: i.units,
      selling_price: i.selling_price,
      hsn: i.hsn,
    })),
  });

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

  // Persist before AWB assign so a transient courier reject can resume with another courier.
  // If assign ultimately fails in a way we don't resume, we cancel this draft below.
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
    where: {
      orderId: localId,
      NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } },
      status: { notIn: ['cancelled', 'canceled'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!pendingShipment) {
    throw new Error(`Failed to persist preliminary Shiprocket shipment for order ${localId}`);
  }

  console.log(
    `[Shiprocket] Order created for ${shiprocketOrderId}: sr_order=${srOrderId} shipment=${srShipmentId}`
  );

  let booked: ShipmentResult;
  try {
    booked = await assignCourierAwbAndPersist(
      localId,
      pendingShipment.id,
      String(srShipmentId),
      srOrderId,
      courierId,
      courierName
    );
  } catch (assignErr: any) {
    const assignMsg = String(assignErr?.message || '');
    const isConsigneeReject = /SHIPROCKET_CONSIGNEE_REJECT/i.test(assignMsg);
    // All-or-nothing for consignee rejects: cancel the draft so Shiprocket does not
    // keep NEW / -R copies. Other courier rejects leave the draft for "try another courier".
    if (isConsigneeReject) {
      const cancelKey = pendingShipment.trackingNumber || String(srShipmentId);
      const cancelled = await cancelShipment(cancelKey);
      console.warn(
        `[Shiprocket] AWB consignee reject — cancelled draft shipment ${srShipmentId}`,
        cancelled
      );
      throw new Error(
        `${courierName} rejected this consignee (ER0005). The draft Shiprocket order was cancelled — ` +
          `no open shipment left. Fix phone/name/address or dims, or try a different courier, then book again.`
      );
    }
    throw assignErr;
  }

  if (isRtoReship) {
    // Keep the RTO history visible but mark the order as re-shipped.
    const { addTag } = await import('@/lib/logistics/status');
    const current = await prisma.order.findUnique({ where: { id: localId }, select: { tags: true } });
    await prisma.order
      .update({ where: { id: localId }, data: { tags: addTag(current?.tags, 'Reshipped') } })
      .catch(() => {});
  }

  return booked;
}

// ─── Reverse pickups (returns / exchange pickups) ───────────────────────────

export interface ReverseParty {
  name: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email?: string;
}

export interface ReverseItem {
  name: string;
  sku: string;
  units: number;
  selling_price: number;
}

/** Our warehouse — the destination of every reverse pickup. */
function getWarehouseParty(): ReverseParty {
  return {
    name: process.env.WAREHOUSE_NAME || 'Zica Bella Returns',
    address1: process.env.WAREHOUSE_ADDRESS || 'C-43 sector-88 Noida 201301',
    city: process.env.WAREHOUSE_CITY || 'Noida',
    state: process.env.WAREHOUSE_STATE || 'Uttar Pradesh',
    zip: process.env.WAREHOUSE_PIN || '201301',
    phone: process.env.WAREHOUSE_PHONE || '9220385011',
    email: process.env.WAREHOUSE_EMAIL || undefined,
  };
}

/**
 * Courier options able to pick up from a customer's pincode and deliver to our warehouse.
 */
export async function getShiprocketReturnCouriers(
  customerPincode: string,
  parcel: { weight: number; length: number; breadth: number; height: number }
): Promise<CourierServiceabilityResult> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }
  const pickupPin = String(customerPincode || '').replace(/\D/g, '');
  if (pickupPin.length < 6) {
    throw new Error('Cannot check couriers: the customer pincode is missing or invalid');
  }
  const warehousePin = await getShiprocketPickupPincode();

  const params = new URLSearchParams({
    pickup_postcode: pickupPin,
    delivery_postcode: warehousePin,
    weight: String(parcel.weight),
    length: String(parcel.length),
    breadth: String(parcel.breadth),
    height: String(parcel.height),
    cod: '0',
    is_return: '1',
  });
  const data = await logisticsApiFetch(`/courier/serviceability/?${params.toString()}`, 'GET', undefined, true);
  const companies: CourierOption[] = (data?.data?.available_courier_companies || []).map((c: any) => ({
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
  return {
    available_courier_companies: companies,
    shiprocket_recommended_courier_id: data?.data?.shiprocket_recommended_courier_id ?? null,
    message: data?.message || (data?.errors ? JSON.stringify(data.errors) : null),
  };
}

export interface ReversePickupBooking {
  awb: string;
  courier: string;
  srShipmentId: string;
  srOrderId: string | null;
  shipmentRowId: string;
  pickupScheduled: boolean;
}

/**
 * Create a Shiprocket *return* order for a return / exchange request, assign the AWB for the
 * chosen courier and request the pickup. Safe to call again after a partial failure: the
 * Shiprocket shipment id is persisted first and reused (no duplicate return orders).
 */
export async function bookShiprocketReversePickup(args: {
  localOrderId: string;
  requestKind: 'return' | 'exchange';
  requestId: string;
  /** Channel order id on Shiprocket, e.g. R_ZB718103 / E_ZB718103 */
  channelOrderId: string;
  customer: ReverseParty;
  items: ReverseItem[];
  parcel: { weight: number; length: number; breadth: number; height: number };
  courierId: number;
  courierName: string;
}): Promise<ReversePickupBooking> {
  const config = await getLogisticsConfig();
  if (config.provider !== 'shiprocket') {
    throw new Error('Shiprocket is not the active logistics provider');
  }
  const preset = PROVIDER_PRESETS.shiprocket;
  const marker = `"request_id":"${args.requestId}"`;

  // Every earlier booking attempt for this request (newest first).
  const priorRows = await prisma.shipment.findMany({
    where: {
      orderId: args.localOrderId,
      type: { in: [...REVERSE_SHIPMENT_TYPES] },
      rawDelhiveryResponse: { contains: marker },
    },
    orderBy: { createdAt: 'desc' },
  });
  // A booking that already failed (missed pickup, cancelled, lost, RTO…) must NOT be handed back:
  // "re-select logistics partner" has to produce a fresh AWB.
  const DEAD_REVERSE_STATUSES = new Set([
    'cancelled', 'cancellation_requested', 'pickup_failed', 'undelivered', 'lost', 'rto', 'rto_delivered',
  ]);
  const existing = priorRows.find((r: any) => !DEAD_REVERSE_STATUSES.has(normalizeCarrierStatus(r.status))) || null;

  if (existing?.awb) {
    return {
      awb: existing.awb,
      courier: existing.courier || args.courierName,
      srShipmentId: String(parseShiprocketMeta(existing.rawDelhiveryResponse)?.shipment_id || ''),
      srOrderId: null,
      shipmentRowId: existing.id,
      pickupScheduled: normalizeCarrierStatus(existing.status) === 'pickup_scheduled',
    };
  }

  let rowId = existing?.id || null;
  let srShipmentId = existing ? String(parseShiprocketMeta(existing.rawDelhiveryResponse)?.shipment_id || '') : '';
  let srOrderId: string | null = existing
    ? (parseShiprocketMeta(existing.rawDelhiveryResponse)?.order_id != null
        ? String(parseShiprocketMeta(existing.rawDelhiveryResponse)!.order_id)
        : null)
    : null;

  const baseMeta = {
    provider: 'shiprocket',
    request_id: args.requestId,
    request_kind: args.requestKind,
    is_return: true,
  };

  if (!srShipmentId) {
    const c = args.customer;
    const w = getWarehouseParty();
    const custParts = c.name.trim().split(/\s+/).filter(Boolean);
    const whParts = w.name.trim().split(/\s+/).filter(Boolean);
    const phone10 = (v: string) => {
      const d = String(v || '').replace(/\D/g, '');
      return d.length >= 10 ? d.slice(-10) : d;
    };
    if (!c.address1 || !c.city || !c.state || !c.zip) {
      throw new Error(
        `Cannot book reverse pickup: incomplete customer address (city="${c.city || ''}", state="${c.state || ''}", pincode="${c.zip || ''}")`
      );
    }
    const subTotal = args.items.reduce((s, i) => s + i.selling_price * i.units, 0);
    const payload = {
      order_id: args.channelOrderId,
      order_date: new Date().toISOString().split('T')[0],
      pickup_customer_name: custParts[0] || 'Customer',
      pickup_last_name: custParts.slice(1).join(' ') || '.',
      pickup_address: c.address1,
      pickup_city: c.city,
      pickup_state: c.state,
      pickup_country: 'India',
      pickup_pincode: Number(String(c.zip).replace(/\D/g, '')),
      pickup_email: c.email || 'noreply@zicabella.com',
      pickup_phone: phone10(c.phone),
      shipping_customer_name: whParts[0] || 'Zica',
      shipping_last_name: whParts.slice(1).join(' ') || 'Bella',
      shipping_address: w.address1,
      shipping_city: w.city,
      shipping_country: 'India',
      shipping_pincode: Number(String(w.zip).replace(/\D/g, '')),
      shipping_state: w.state,
      shipping_email: w.email || 'noreply@zicabella.com',
      shipping_phone: phone10(w.phone),
      order_items: args.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        units: i.units,
        selling_price: i.selling_price,
        discount: 0,
      })),
      payment_method: 'PREPAID',
      total_discount: 0,
      sub_total: subTotal,
      length: args.parcel.length,
      breadth: args.parcel.breadth,
      height: args.parcel.height,
      weight: args.parcel.weight,
    };

    // Re-booking after a failed pickup: void the dead AWB at Shiprocket (best effort) so the courier
    // doesn't keep trying, and use a distinct channel order id for the new return order.
    for (const dead of priorRows) {
      if (dead.awb && normalizeCarrierStatus(dead.status) === 'pickup_failed') {
        try {
          await logisticsApiFetch('/orders/cancel/shipment/awbs', 'POST', { awbs: [dead.awb] });
        } catch (voidErr: any) {
          console.warn(`[Shiprocket] Could not void failed reverse AWB ${dead.awb}:`, voidErr?.message || voidErr);
        }
        await prisma.shipment.update({ where: { id: dead.id }, data: { status: 'cancelled' } }).catch(() => {});
      }
    }
    if (priorRows.length > 0) {
      payload.order_id = `${args.channelOrderId}-RB${priorRows.length + 1}`;
    }

    const created = await logisticsApiFetch(preset.endpoints.createReturn, 'POST', payload);
    const sid = created?.shipment_id ?? created?.payload?.shipment_id;
    const oid = created?.order_id ?? created?.payload?.order_id;
    if (!sid) {
      throw new Error(
        `Shiprocket return order was not created: ${JSON.stringify(created).slice(0, 300)}`
      );
    }
    srShipmentId = String(sid);
    srOrderId = oid != null ? String(oid) : null;

    const row = await prisma.shipment.create({
      data: {
        orderId: args.localOrderId,
        trackingNumber: srShipmentId,
        awb: null,
        courier: args.courierName,
        status: 'new',
        type: 'reverse_pickup',
        rawDelhiveryResponse: JSON.stringify({ ...baseMeta, shipment_id: srShipmentId, order_id: srOrderId }),
      },
    });
    rowId = row.id;
  }

  if (!rowId) throw new Error('Reverse pickup shipment row missing');

  // Assign AWB for the chosen courier (is_return = reverse leg)
  const assignData = await logisticsApiFetch(preset.endpoints.assignAwb, 'POST', {
    shipment_id: srShipmentId,
    courier_id: args.courierId,
    is_return: 1,
  });
  const assignPayload = assignData?.response?.data || assignData?.data || assignData;
  const awb = String(assignPayload?.awb_code || '').trim();
  if (!awb) {
    throw new Error(
      `${args.courierName} could not assign an AWB for this pickup. Try a different courier — ` +
        `the Shiprocket return order is saved, so retrying will not create a duplicate.`
    );
  }
  const finalCourier = assignPayload?.courier_name || args.courierName;

  await prisma.shipment.update({
    where: { id: rowId },
    data: {
      awb,
      trackingNumber: awb,
      trackingUrl: `https://shiprocket.co/tracking/${awb}`,
      courier: finalCourier,
      status: 'confirmed',
      rawDelhiveryResponse: JSON.stringify({ ...baseMeta, shipment_id: srShipmentId, order_id: srOrderId }),
      events: JSON.stringify([
        {
          status: 'confirmed',
          location: 'Customer',
          timestamp: new Date().toISOString(),
          description: `Reverse pickup booked with AWB ${awb}`,
        },
      ]),
    },
  });

  // Request the pickup (best effort — AWB is already assigned and visible to ops)
  let pickupScheduled = false;
  try {
    const pickup = await requestShiprocketPickup(srShipmentId);
    pickupScheduled = pickup.queued;
    if (pickupScheduled) {
      await prisma.shipment.update({
        where: { id: rowId },
        data: {
          status: 'pickup_scheduled',
          rawDelhiveryResponse: JSON.stringify({
            ...baseMeta,
            shipment_id: srShipmentId,
            order_id: srOrderId,
            pickup_scheduled_at: pickup.pickup_scheduled_date || new Date().toISOString(),
          }),
        },
      });
    }
  } catch (pErr: any) {
    console.warn('[Shiprocket] Reverse pickup request note:', pErr?.message || pErr);
  }

  return { awb, courier: finalCourier, srShipmentId, srOrderId, shipmentRowId: rowId, pickupScheduled };
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

/** True when Shiprocket/courier already queued pickup for this shipment. */
function isAlreadyInPickupQueueError(err: unknown): boolean {
  return /Already in Pickup Queue/i.test(String((err as any)?.message || err || ''));
}

/**
 * Request courier pickup for a Shiprocket shipment_id.
 * Treats "Already in Pickup Queue" as success (common after AWB assign).
 */
async function requestShiprocketPickup(shipmentId: string | number): Promise<{
  queued: boolean;
  alreadyQueued: boolean;
  pickup_scheduled_date: string | null;
  message: string;
}> {
  const preset = PROVIDER_PRESETS.shiprocket;
  try {
    const data = await logisticsApiFetch(preset.endpoints.generatePickup, 'POST', {
      shipment_id: [Number(shipmentId) || shipmentId],
    });
    const pickupDate =
      data?.response?.pickup_scheduled_date ||
      data?.pickup_scheduled_date ||
      data?.data?.pickup_scheduled_date ||
      null;
    const queued = data?.pickup_status === 1 || Boolean(pickupDate) || data?.status_code === 200;
    const message =
      (typeof data?.response?.data === 'string' && data.response.data) ||
      data?.message ||
      (queued ? 'Pickup scheduled' : JSON.stringify(data).slice(0, 200));
    return {
      queued: queued || true,
      alreadyQueued: false,
      pickup_scheduled_date: pickupDate,
      message: String(message),
    };
  } catch (err: any) {
    if (isAlreadyInPickupQueueError(err)) {
      return {
        queued: true,
        alreadyQueued: true,
        pickup_scheduled_date: null,
        message: 'Already in Pickup Queue',
      };
    }
    throw err;
  }
}

/**
 * Schedule courier pickup for a Shiprocket shipment (API / legacy callers).
 * Forward booking now auto-requests pickup after AWB; this remains idempotent.
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
  const pickup = await requestShiprocketPickup(shipmentId);

  const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse) || {
    provider: 'shiprocket' as const,
    shipment_id: shipmentId,
    order_id: null,
  };
  meta.shipment_id = shipmentId;
  meta.pickup_scheduled_at =
    pickup.pickup_scheduled_date || meta.pickup_scheduled_at || new Date().toISOString();

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
    message: pickup.alreadyQueued
      ? 'Pickup already queued at your Shiprocket primary address'
      : pickup.message,
    pickup_scheduled_date: pickup.pickup_scheduled_date,
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

/** Shiprocket already voided / is voiding this shipment or order. */
function isShiprocketAlreadyCancellingOrCancelled(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return /cancellation requested|already cancel+ed|order is in cancelled state|cannot cancel order when shipment status is cancel|shipment (is )?already cancel/i.test(
    msg
  );
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
    'manifested',
    'pickup_failed',
    'pickup_pending',
    'packed',
    'label_created',
    'pickup_scheduled',
    'new',
    'processing',
    'cancellation_requested', // re-hit Shiprocket if void still pending
    'cancelled', // allow re-attempt when local was marked cancelled but SR order still open
  ];
  if (!cancellableStatuses.includes(shipment.status)) {
    return { success: false, message: `Cannot cancel shipment in "${shipment.status}" state. Only cancellable in: ${cancellableStatuses.join(', ')}` };
  }

  /** True when Shiprocket reported cancel already in progress (not final Canceled yet). */
  let shiprocketCancelInProgress = false;
  /** Shiprocket order id used for the post-cancel status check. */
  let srOrderIdForCheck: string | number | null = null;

  if (config.provider === 'shiprocket' && preset) {
    try {
      const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse);
      // Real courier AWB only — trackingNumber is often the Shiprocket order/shipment id.
      const realAwb = String(shipment.awb || '').trim();
      const orderCancelId =
        meta?.order_id ||
        (!realAwb && /^\d+$/.test(String(trackingNumber || '').trim())
          ? String(trackingNumber).trim()
          : null);
      srOrderIdForCheck = orderCancelId || null;
      let orderCancelled = false;
      let awbCancelled = false;
      const errors: string[] = [];

      // 1) Cancel AWB if a real AWB is present
      if (realAwb && !/^MOCK/i.test(realAwb) && !/^CANCELLED-/i.test(realAwb)) {
        try {
          await logisticsApiFetch('/orders/cancel/shipment/awbs', 'POST', {
            awbs: [realAwb],
          });
          awbCancelled = true;
          console.log(`[Logistics] Shiprocket AWB cancel ok for ${realAwb}`);
        } catch (awbCancelErr: any) {
          if (isShiprocketAlreadyCancellingOrCancelled(awbCancelErr)) {
            awbCancelled = true;
            shiprocketCancelInProgress = /cancellation requested/i.test(String(awbCancelErr?.message || ''));
            console.log(
              `[Logistics] Shiprocket AWB already cancelling/cancelled for ${realAwb} — treating as success`
            );
          } else {
            errors.push(`AWB cancel: ${awbCancelErr.message}`);
            console.warn(`[Logistics] Shiprocket AWB cancel failed for ${realAwb}:`, awbCancelErr.message);
          }
        }
      }

      // 2) Cancel Shiprocket ORDER (covers AWB-less drafts / NEW orders)
      if (orderCancelId) {
        try {
          await logisticsApiFetch(preset.endpoints.cancelShipment, 'POST', {
            ids: [Number(orderCancelId) || orderCancelId],
          });
          orderCancelled = true;
          // Fresh cancel with a live AWB lands in Cancellation Requested until SR finalizes.
          if (realAwb) shiprocketCancelInProgress = true;
          console.log(`[Logistics] Shiprocket order cancel ok for id=${orderCancelId}`);
        } catch (orderCancelErr: any) {
          // e.g. "Cannot cancel order when shipment status is Cancellation Requested"
          if (isShiprocketAlreadyCancellingOrCancelled(orderCancelErr)) {
            orderCancelled = true;
            if (realAwb) {
              shiprocketCancelInProgress =
                shiprocketCancelInProgress ||
                /cancellation requested/i.test(String(orderCancelErr?.message || '')) ||
                !/order is in cancelled state/i.test(String(orderCancelErr?.message || ''));
            }
            console.log(
              `[Logistics] Shiprocket order ${orderCancelId} already cancelling/cancelled — treating as success`
            );
          } else {
            errors.push(`Order cancel: ${orderCancelErr.message}`);
            console.warn(
              `[Logistics] Shiprocket order cancel failed for ${orderCancelId}:`,
              orderCancelErr.message
            );
          }
        }
      } else if (!awbCancelled) {
        errors.push('No Shiprocket order_id on shipment — SR order may remain NEW');
      }

      if (!orderCancelled && !awbCancelled) {
        throw new Error(errors.join('; ') || 'Shiprocket cancel failed');
      }
      if (!orderCancelled && awbCancelled && realAwb) {
        shiprocketCancelInProgress = true;
        console.warn(
          `[Logistics] AWB/cancel-in-progress ok for ${realAwb}; order cancel note: ${errors.join('; ') || 'n/a'}`
        );
      }

      // AWB-less draft: nothing left to void — finalize locally so ops can rebook now.
      if (!realAwb) {
        shiprocketCancelInProgress = false;
      }
    } catch (err: any) {
      console.error(`[Logistics] Cancel shipment failed:`, err.message);
      return { success: false, message: err.message || 'Cancel failed on carrier' };
    }
  } else {
    shiprocketCancelInProgress = true;
  }

  // Ask Shiprocket for the ACTUAL order status instead of assuming "requested".
  // Many cancels finalize instantly — show/store exactly what Shiprocket reports.
  let actualCancelPhrase: string | null = null;
  if (config.provider === 'shiprocket' && srOrderIdForCheck) {
    const actual = await getShiprocketOrderCancelState(srOrderIdForCheck);
    if (actual.state === 'cancelled') {
      shiprocketCancelInProgress = false;
      actualCancelPhrase = actual.raw || 'Canceled';
    } else if (actual.state === 'cancellation_requested') {
      shiprocketCancelInProgress = true;
      actualCancelPhrase = actual.raw || 'Cancellation Requested';
    }
    // 'active' / 'unknown': keep the API-derived flag; sync re-checks real status.
  }

  // Cancel is already sent to Shiprocket above (stops shipping). Locally we only
  // mark Cancellation Requested and KEEP the AWB so status sync can keep polling
  // until the carrier reports exact Cancelled — then applyShipmentStatusUpdate
  // clears the AWB. Never treat "Cancellation Requested" as the final state.
  const localStatus = shiprocketCancelInProgress ? 'cancellation_requested' : 'cancelled';
  const finalized = localStatus === 'cancelled';
  const voidedAwb = finalized ? String(shipment.awb || trackingNumber || '').trim() : '';
  let cancelMeta: string | undefined;
  if (finalized && voidedAwb && !/^CANCELLED-/i.test(voidedAwb) && !/^MOCK/i.test(voidedAwb)) {
    const meta = parseShiprocketMeta(shipment.rawDelhiveryResponse) || {
      provider: 'shiprocket' as const,
      shipment_id: null,
      order_id: null,
    };
    meta.voided_awb = voidedAwb;
    cancelMeta = JSON.stringify(meta);
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: localStatus,
      ...(cancelMeta ? { rawDelhiveryResponse: cancelMeta } : {}),
      ...(finalized
        ? {
            awb: null,
            trackingNumber: voidedAwb
              ? `CANCELLED-${voidedAwb.slice(-8)}`
              : `CANCELLED-${shipment.id.slice(-8)}`,
            trackingUrl: null,
            labelUrl: null,
          }
        : {}),
    },
  });

  if (shipment.orderId) {
    // Shipment cancel ≠ order cancel. Keep cancellation_requested while voiding
    // so sync continues; once finalized, reset to pending for rebook.
    await prisma.order.update({
      where: { id: shipment.orderId },
      data: {
        deliveryStatus: finalized ? 'pending' : localStatus,
        tracking_status:
          actualCancelPhrase || (finalized ? 'Canceled' : 'Cancellation Requested'),
        ...(finalized ? { delhivery_awb: null } : {}),
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
        data: {
          deliveryStatus: finalized ? 'pending' : localStatus,
          ...(finalized ? { trackingNumber: null, trackingUrl: null } : {}),
        },
      }).catch(() => {});
    }

    // Kick a sync so we pick up final Cancelled as soon as Shiprocket flips.
    if (!finalized) {
      void syncOrderLogisticsStatus(shipment.orderId).catch(() => {});
    }
  }

  return {
    success: true,
    message: finalized
      ? 'Shipment cancelled successfully'
      : 'Cancel sent to Shiprocket — syncing until status is Cancelled',
  };
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
 * Resolves the logistics webhook secret (Shiprocket / shared), preferring env over DB.
 */
export async function resolveWebhookSecret(): Promise<{ secret: string; source: 'env' | 'db' | 'none' }> {
  const envSecret =
    process.env.SHIPROCKET_WEBHOOK_SECRET?.trim() ||
    process.env.LOGISTICS_WEBHOOK_SECRET?.trim();
  if (envSecret) return { secret: envSecret, source: 'env' };

  const shop = await prisma.shop.findFirst({ select: { webhookSecret: true } });
  if (shop?.webhookSecret?.trim()) return { secret: shop.webhookSecret.trim(), source: 'db' };

  return { secret: '', source: 'none' };
}

/**
 * Validate a logistics webhook signature (HMAC-SHA256 hex, with optional sha256=/Bearer/Token prefixes).
 */
export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  _provider: 'shiprocket' | 'generic' = 'generic'
): boolean {
  if (!secret || !signature) return false;

  try {
    const cleanSignature = signature
      .replace(/^sha256=/i, '')
      .replace(/^Bearer\s+/i, '')
      .replace(/^Token\s+/i, '')
      .trim();
    const cleanSecret = secret.trim();

    const expectedSignature = crypto
      .createHmac('sha256', cleanSecret)
      .update(payload)
      .digest('hex');

    if (cleanSignature.length !== expectedSignature.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(cleanSignature),
      Buffer.from(expectedSignature)
    );
  } catch (err) {
    console.error('[Logistics] Webhook signature validation error:', err);
    return false;
  }
}
