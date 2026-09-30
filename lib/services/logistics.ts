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
  trackingUrl: string;
  courier: string;
  shipmentId?: string;
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
    console.log(`[Logistics Mock] ${method} ${endpoint}`, body ? JSON.stringify(body).slice(0, 100) : '');
    return null; // Mock mode — caller handles fallback
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
  }
): Promise<ShipmentResult> {
  const config = await getLogisticsConfig();
  const preset = PROVIDER_PRESETS[config.provider];

  // Try real API
  if (config.provider !== 'mock' && preset) {
    try {
      let data: any;

      if (config.provider === 'shiprocket') {
        data = await logisticsApiFetch(preset.endpoints.createShipment, 'POST', {
          order_id: orderId,
          order_date: new Date().toISOString().split('T')[0],
          pickup_location: 'Primary',
          billing_customer_name: address.name,
          billing_address: address.address1,
          billing_city: address.city,
          billing_pincode: address.zip,
          billing_state: address.province,
          billing_country: address.country || 'India',
          billing_phone: address.phone || '',
          shipping_is_billing: true,
          order_items: items.map(i => ({
            name: i.title,
            sku: i.sku || '',
            units: i.quantity,
            selling_price: i.price,
          })),
          payment_method: 'prepaid',
          sub_total: items.reduce((s, i) => s + i.price * i.quantity, 0),
          length: 20,
          breadth: 15,
          height: 10,
          weight: 0.5,
        });

        const trackingNumber = data?.order_id?.toString() || data?.shipment_id?.toString() || `SR${Date.now()}`;
        const result: ShipmentResult = {
          trackingNumber,
          trackingUrl: `https://shiprocket.co/tracking/${trackingNumber}`,
          courier: data?.courier_name || 'Shiprocket',
          shipmentId: data?.shipment_id?.toString(),
        };

        // Save shipment to DB
        await prisma.shipment.create({
          data: {
            orderId,
            trackingNumber: result.trackingNumber,
            trackingUrl: result.trackingUrl,
            courier: result.courier,
            status: 'confirmed',
          },
        });

        // Update order delivery status
        await prisma.order.updateMany({
          where: { shopifyOrderId: orderId },
          data: { deliveryStatus: 'confirmed' },
        });

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
          codUpfront = wsOrder?.codUpfrontPaid ? Number(wsOrder.codUpfrontPaid) : 99;
        }

        const calculatedTotalPrice = Number(dbOrder?.totalPrice || items.reduce((s: number, i: any) => s + (Number(i.price) * Number(i.quantity)), 0));
        const codBalanceDue = isCodOrder ? Math.max(0, calculatedTotalPrice - codUpfront) : 0;
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

            // Save shipment to DB
            await prisma.shipment.create({
              data: {
                orderId: dbOrder?.id || orderId,
                trackingNumber: result.trackingNumber,
                awb: result.trackingNumber,
                trackingUrl: result.trackingUrl,
                courier: result.courier,
                status: 'confirmed',
              },
            });

            // Update order delivery status & delhivery_awb
            await prisma.order.updateMany({
              where: {
                OR: [
                  { id: orderId },
                  { shopifyOrderId: orderId }
                ]
              },
              data: {
                deliveryStatus: 'confirmed',
                delhivery_awb: result.trackingNumber,
                status: 'Shipped'
              },
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

      await prisma.shipment.create({
        data: {
          orderId,
          trackingNumber: result.trackingNumber,
          trackingUrl: result.trackingUrl,
          courier: result.courier,
          status: 'confirmed',
        },
      });

      return result;
    } catch (err: any) {
      console.error(`[Logistics] ${config.provider} shipOrder failed:`, err.message);
      // Fall through to mock
    }
  }

  // Mock fallback
  const mockTrackingNumber = `MOCK${Date.now().toString(36).toUpperCase()}`;
  const result: ShipmentResult = {
    trackingNumber: mockTrackingNumber,
    trackingUrl: `https://track.zicabella.com/${mockTrackingNumber}`,
    courier: 'Mock Courier',
  };

  await prisma.shipment.create({
    data: {
      orderId,
      trackingNumber: result.trackingNumber,
      trackingUrl: result.trackingUrl,
      courier: result.courier,
      status: 'confirmed',
      events: JSON.stringify([
        { status: 'confirmed', location: 'Warehouse', timestamp: new Date().toISOString(), description: 'Order confirmed and ready for pickup' },
      ]),
    },
  });

  return result;
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
    }
  }

  // Mock fallback
  const mockTrackingNumber = `RET${Date.now().toString(36).toUpperCase()}`;
  return {
    trackingNumber: mockTrackingNumber,
    trackingUrl: `https://track.zicabella.com/return/${mockTrackingNumber}`,
    courier: 'Mock Return Courier',
  };
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
