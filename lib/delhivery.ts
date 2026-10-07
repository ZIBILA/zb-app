import prisma from './db';

const DELHIVERY_PROD_URL = 'https://track.delhivery.com';

export interface DelhiveryShipment {
  name: string;
  add: string;
  pin: string;
  phone: string;
  order: string;
  payment_mode: 'Prepaid' | 'COD';
  total_amount: string;
  cod_amount: string;
  products_desc: string;
  weight: string; // in grams
  shipment_height?: string;
  shipment_width?: string;
  shipment_length?: string;
  shipping_mode: 'Surface' | 'Express';
  seller_name: string;
}

export async function getDelhiveryClient() {
  // Priority: environment variable → DB Shop settings
  const envKey = process.env.DELHIVERY_API_KEY || process.env.DELHIVERY_API_TOKEN;
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: process.env.DELHIVERY_BASE_URL || DELHIVERY_PROD_URL,
    };
  }

  const shop = await prisma.shop.findFirst();
  if (!shop?.delhiveryApiKey) {
    throw new Error('Delhivery API Key not configured. Set DELHIVERY_API_KEY in environment or in Shop settings.');
  }
  return {
    apiKey: shop.delhiveryApiKey,
    baseUrl: DELHIVERY_PROD_URL,
  };
}

export async function createDelhiveryShipment(shipment: DelhiveryShipment, pickupLocationName: string) {
  const { apiKey, baseUrl } = await getDelhiveryClient();

  const payload = {
    shipments: [shipment],
    pickup_location: {
      name: pickupLocationName
    }
  };

  const formData = new URLSearchParams();
  formData.append('format', 'json');
  formData.append('data', JSON.stringify(payload));

  const response = await fetch(`${baseUrl}/api/cmu/create.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
    },
    body: formData,
  });

  const data = await response.json();
  return data;
}

export async function trackDelhiveryShipment(waybills: string | string[]) {
  const { apiKey, baseUrl } = await getDelhiveryClient();
  const wbns = Array.isArray(waybills) ? waybills.join(',') : waybills;

  const response = await fetch(`${baseUrl}/api/v1/packages/json/?waybill=${wbns}`, {
    method: 'GET',
    headers: {
      'Authorization': `Token ${apiKey}`,
    },
  });

  const data = await response.json();
  return data;
}

export async function getShippingLabel(waybills: string | string[], pdf: boolean = true) {
  const { apiKey, baseUrl } = await getDelhiveryClient();
  const wbns = Array.isArray(waybills) ? waybills.join(',') : waybills;

  const response = await fetch(`${baseUrl}/api/p/packing_slip?wbns=${wbns}&pdf=${pdf}`, {
    method: 'GET',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();
  return data;
}

export async function fetchWaybill() {
  const { apiKey, baseUrl } = await getDelhiveryClient();

  const response = await fetch(`${baseUrl}/waybill/api/fetch/json/?token=${apiKey}`, {
    method: 'GET',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();
  return data;
}

export async function getExpectedTAT(origin: string, destination: string, mot: 'S' | 'E' | 'N' = 'S') {
  const { apiKey, baseUrl } = await getDelhiveryClient();

  const response = await fetch(`${baseUrl}/api/dc/expected_tat?origin_pin=${origin}&destination_pin=${destination}&mot=${mot}`, {
    method: 'GET',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();
  return data;
}

export async function cancelDelhiveryShipment(waybill: string) {
  const { apiKey, baseUrl } = await getDelhiveryClient();

  const response = await fetch(`${baseUrl}/api/p/edit`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      waybill,
      cancellation: 'true'
    }),
  });

  const data = await response.json();
  return data;
}

/**
 * Reverse Pickup (Return/Exchange) — creates a reverse shipment in Delhivery's system.
 *
 * Uses the same CMU order creation API but with `pt: 'DTO'` (Door-To-Origin)
 * to signal a reverse/return pickup. Delhivery assigns a real AWB via their
 * waybill API and schedules a pickup from the customer address.
 *
 * Throws on failure — callers must handle errors explicitly.
 */
export interface ReversePickupParams {
  /** Customer name (person the courier picks up from) */
  name: string;
  /** Customer address */
  add: string;
  /** Customer PIN code */
  pin: string;
  /** Customer phone number */
  phone: string;
  /** Unique order reference (e.g. original order ID or return request ID) */
  order: string;
  /** Product description */
  products_desc: string;
  /** Shipment weight in grams */
  weight: string;
  /** Seller / return-to warehouse name */
  seller_name: string;
  /** Pickup location name registered with Delhivery */
  pickup_location_name: string;
  /** Optional: quantity of items */
  quantity?: number;
}

export async function createReversePickup(params: ReversePickupParams): Promise<{
  awb: string;
  status: string;
  rawResponse: any;
}> {
  const { apiKey, baseUrl } = await getDelhiveryClient();

  // 1. Fetch a real waybill number from Delhivery
  const waybillResponse = await fetch(
    `${baseUrl}/waybill/api/fetch/json/?token=${apiKey}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json',
      },
    }
  );

  if (!waybillResponse.ok) {
    const errText = await waybillResponse.text();
    throw new Error(`Delhivery waybill fetch failed (${waybillResponse.status}): ${errText}`);
  }

  const waybillData = await waybillResponse.json();
  // Delhivery may return a bare string, { waybill }, or nested shapes
  const waybillNumber =
    (typeof waybillData === 'string' && waybillData.trim()) ||
    waybillData?.waybill ||
    waybillData?.Waybill ||
    waybillData?.data?.waybill ||
    waybillData?.packages?.[0]?.waybill ||
    null;
  if (!waybillNumber || typeof waybillNumber !== 'string') {
    const hint =
      waybillData?.error ||
      waybillData?.rmk ||
      waybillData?.message ||
      (typeof waybillData === 'object' ? Object.keys(waybillData).join(',') : typeof waybillData);
    throw new Error(`Delhivery waybill API returned no waybill number (${hint})`);
  }

  // 2. Create the reverse shipment order using CMU API with pt=DTO (Door-To-Origin)
  const shipment = {
    waybill: waybillNumber,
    name: params.name,
    add: params.add,
    pin: params.pin,
    phone: params.phone,
    order: params.order,
    payment_mode: 'Prepaid' as const,
    total_amount: '0',
    cod_amount: '0',
    products_desc: params.products_desc,
    weight: params.weight,
    pt: 'DTO', // Door-To-Origin = reverse pickup
    shipping_mode: 'Surface',
    seller_name: params.seller_name,
    qc: 'true', // Enable QC at pickup
  };

  const payload = {
    shipments: [shipment],
    pickup_location: {
      name: params.pickup_location_name,
    },
  };

  const formData = new URLSearchParams();
  formData.append('format', 'json');
  formData.append('data', JSON.stringify(payload));

  const response = await fetch(`${baseUrl}/api/cmu/create.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Delhivery reverse pickup creation failed (${response.status}): ${errText}`);
  }

  const data = await response.json();

  // Validate the response — check if the shipment was actually registered
  const packageInfo = data?.packages?.[0] || data?.upload_wbn;
  const success = data?.success || data?.rmk === 'Successful' || !!packageInfo;

  if (!success) {
    const errorMsg = data?.rmk || data?.packages?.[0]?.remarks || JSON.stringify(data);
    throw new Error(`Delhivery rejected the reverse pickup: ${errorMsg}`);
  }

  return {
    awb: waybillNumber,
    status: 'pickup_pending',
    rawResponse: data,
  };
}
