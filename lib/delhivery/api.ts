import { DelhiveryOrder } from './types';

const BASE_URL = 'https://track.delhivery.com';

function getAuthHeader(): Record<string, string> {
  const token = process.env.DELHIVERY_API_KEY || process.env.DELHIVERY_API_TOKEN;
  if (!token) {
    console.warn('[Delhivery API] Warning: DELHIVERY_API_KEY is not set in environment.');
  }
  return {
    'Authorization': `Token ${token || ''}`,
  };
}

/**
 * FUNCTION 1 — createShipment
 * Registers a new order shipment with Delhivery.
 */
export async function createShipment(order: DelhiveryOrder): Promise<{ awb: string; status: string; error?: string }> {
  try {
    const payload = {
      shipments: [
        {
          name: order.shippingAddress.name,
          add: order.shippingAddress.add,
          pin: order.shippingAddress.pin,
          city: order.shippingAddress.city,
          state: order.shippingAddress.state,
          country: 'India',
          phone: order.shippingAddress.phone,
          order: order.shopifyOrderId,
          payment_mode: (order.paymentMode === 'COD' || String(order.paymentMode).toUpperCase() === 'COD') ? 'COD' : 'Prepaid',
          return_pin: process.env.WAREHOUSE_PIN || '201301',
          return_city: process.env.WAREHOUSE_CITY || 'Noida',
          return_phone: process.env.WAREHOUSE_PHONE || '9220385011',
          return_name: 'Zica Bella Returns',
          return_add: process.env.WAREHOUSE_ADDRESS || 'C-43 sector-88 Noida 201301',
          products_desc: order.items.map(i => i.title).join(', '),
          cod_amount: (order.paymentMode === 'COD' || String(order.paymentMode).toUpperCase() === 'COD') 
            ? String(Math.max(0, Math.round(Number(order.total) - (Number((order as any).codUpfrontPaid) || 99)))) 
            : '',
          order_date: new Date().toISOString(),
          total_amount: String(Math.round(Number(order.total))),
          seller_add: process.env.WAREHOUSE_ADDRESS || 'C-43 sector-88 Noida 201301',
          seller_name: 'Zica Bella',
          seller_inv: order.sellerInvoice || '',
          quantity: String(order.quantity),
          weight: String(order.weight),
          seller_gst_tin: process.env.GST_NUMBER || '',
          shipment_length: order.shipment_length || 30,
          shipment_width: order.shipment_width || 20,
          shipment_height: order.shipment_height || 5,
          shipping_mode: order.shipping_mode || 'Surface',
          address_type: 'home'
        }
      ],
      pickup_location: {
        name: process.env.DELHIVERY_PICKUP_LOCATION || 'Zica Bella Manufacturing Unit'
      }
    };

    const formData = new URLSearchParams();
    formData.append('format', 'json');
    formData.append('data', JSON.stringify(payload));

    console.log('[Delhivery API] Outgoing payload:', JSON.stringify(payload, null, 2));

    const res = await fetch(`${BASE_URL}/api/cmu/create.json`, {
      method: 'POST',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Delhivery API] Response error status:', res.status, 'body:', errText);
      return { awb: '', status: 'error', error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json();
    console.log('[Delhivery API] Response body:', JSON.stringify(data, null, 2));

    // Handle standard failure responses
    if (data.success === false || data.error === true) {
      const rmk = data.rmk || '';
      let userFriendlyError = rmk;
      if (rmk.includes('ClientWarehouse matching query does not exist')) {
        userFriendlyError = `Pickup location '${payload.pickup_location.name}' is not registered with Delhivery. Please check your Delhivery merchant panel.`;
      }
      console.error('[Delhivery API] Creation failed:', userFriendlyError);
      return {
        awb: '',
        status: 'error',
        error: userFriendlyError || 'Delhivery shipment registration rejected'
      };
    }

    if (data.packages && data.packages.length > 0) {
      const pkg = data.packages[0];
      if (pkg.status === 'Success' || pkg.status === 'Successful' || pkg.waybill) {
        return {
          awb: String(pkg.waybill),
          status: pkg.status
        };
      } else {
        return {
          awb: '',
          status: 'error',
          error: pkg.remarks ? pkg.remarks.join(', ') : 'Fulfillment registration failed'
        };
      }
    }

    return {
      awb: '',
      status: 'error',
      error: data.errors ? data.errors.join(', ') : 'Unknown API response format'
    };
  } catch (err: any) {
    console.error('[Delhivery API] createShipment error:', err.message, err.stack);
    if (err.response?.data) {
      console.error('[Delhivery API] Response error data:', err.response.data);
    }
    return { awb: '', status: 'error', error: err.message || 'Network error occurred' };
  }
}

/**
 * FUNCTION 2 — generateLabel
 * Downloads the packing slip / shipping label PDF.
 */
export async function generateLabel(awb: string): Promise<Blob | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/p/packing_slip?wbns=${awb}&pdf=true`, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
      }
    });

    if (!res.ok) {
      console.error(`[Delhivery API] generateLabel failed: HTTP ${res.status}`);
      return null;
    }

    return await res.blob();
  } catch (err) {
    console.error('[Delhivery API] generateLabel error:', err);
    return null;
  }
}

/**
 * FUNCTION 3 — schedulePickup
 * Schedules a courier pickup request for ready packages.
 */
export async function schedulePickup(pickupDatetime: string, packageCount: number): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/fm/request/new/`, {
      method: 'POST',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pickup_time: pickupDatetime,
        pickup_location: process.env.DELHIVERY_PICKUP_LOCATION || 'Zica Bella Manufacturing Unit',
        expected_package_count: packageCount
      })
    });

    if (res.ok) {
      return { success: true };
    }

    const errData = await res.json().catch(() => ({}));
    return { success: false, error: errData.message || `HTTP ${res.status}` };
  } catch (err: any) {
    console.error('[Delhivery API] schedulePickup error:', err);
    return { success: false, error: err.message || 'Network error occurred' };
  }
}

/**
 * FUNCTION 4 — trackShipment
 * Fetches real-time status tracking logs from Delhivery.
 */
export async function trackShipment(awb: string): Promise<any> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/packages/json/?waybill=${awb}&verbose=2`, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
      }
    });

    if (res.ok) {
      return await res.json();
    }

    console.error(`[Delhivery API] trackShipment failed: HTTP ${res.status}`);
    return null;
  } catch (err) {
    console.error('[Delhivery API] trackShipment error:', err);
    return null;
  }
}

/**
 * FUNCTION 5 — cancelShipment
 * Cancels a shipmentwaybill registration.
 */
export async function cancelShipment(awb: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/p/edit`, {
      method: 'POST',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        waybill: awb,
        cancellation: true
      })
    });

    if (res.ok) {
      return { success: true };
    }

    const errData = await res.json().catch(() => ({}));
    return { success: false, error: errData.message || `HTTP ${res.status}` };
  } catch (err: any) {
    console.error('[Delhivery API] cancelShipment error:', err);
    return { success: false, error: err.message || 'Network error occurred' };
  }
}
