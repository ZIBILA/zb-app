/**
 * Razorpay Service — Custom UI SDK (react-native-customui)
 * 
 * This service provides a simpler alternative to the useRazorpay hook
 * for scenarios where the full hook state management isn't needed.
 * Uses Custom UI SDK — no Razorpay checkout sheet is shown.
 */
import { razorpayOpen } from '../utils/razorpayBridge';
import type { PaymentResult as BridgePaymentResult } from '../utils/razorpayBridge';
import { getPaymentApiBaseUrl } from '../constants/config';
import { useAuthStore } from '../store/authStore';

async function readJsonResponse(res: Response): Promise<{ ok: boolean; status: number; data: Record<string, any>; raw: string }> {
  const raw = await res.text();
  let data: Record<string, any> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw.slice(0, 280) || `HTTP ${res.status}` };
  }
  return { ok: res.ok, status: res.status, data, raw };
}

export interface PaymentResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature?: string;
}

function normalizePaymentResult(data: any, fallbackOrderId: string): PaymentResult {
  const paymentId =
    data?.razorpay_payment_id ||
    data?.payment_id ||
    data?.paymentId ||
    data?.data?.razorpay_payment_id ||
    data?.data?.payment_id;
  const orderId =
    data?.razorpay_order_id ||
    data?.order_id ||
    data?.orderId ||
    data?.data?.razorpay_order_id ||
    data?.data?.order_id ||
    fallbackOrderId;
  const signature =
    data?.razorpay_signature ||
    data?.signature ||
    data?.data?.razorpay_signature ||
    data?.data?.signature;

  if (!paymentId) {
    throw new Error('Payment completed, but Razorpay did not return a payment id.');
  }

  return {
    razorpay_payment_id: String(paymentId),
    razorpay_order_id: String(orderId),
    razorpay_signature: signature ? String(signature) : undefined,
  };
}


/**
 * Full Razorpay Custom UI payment flow:
 * 1. Creates server-side order
 * 2. Opens Razorpay Custom UI SDK (method-specific, NO checkout sheet)
 * 3. Verifies payment signature server-side
 * Returns PaymentResult on success, throws on failure or user cancel
 */
export async function openRazorpayCheckout(
  orderData: any,
  _authToken: string,
  paymentMethod?: {
    method: 'upi' | 'card' | 'netbanking' | 'wallet';
    upi_app_package_name?: string;
    bank?: string;
    wallet?: string;
    card?: {
      number: string;
      expiry_month: string;
      expiry_year: string;
      cvv: string;
      name: string;
    };
  }
): Promise<any> {
  const amountInRupees = Number(orderData.amount || orderData.total || orderData.total_price || 0);
  if (!amountInRupees || amountInRupees <= 0) {
    throw new Error('Invalid payment amount');
  }

  const apiBase = getPaymentApiBaseUrl();
  const token = useAuthStore.getState().token || _authToken || '';

  // Step 1: Create order on backend
  const orderRes = await fetch(`${apiBase}/api/app/payment/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({
      amount: amountInRupees,
      currency: orderData.currency || 'INR',
      receipt: `zb_${Date.now()}`,
    }),
  });

  const orderParsed = await readJsonResponse(orderRes);
  const orderJson = orderParsed.data;
  if (!orderParsed.ok || !orderJson.order_id) {
    const detail =
      (orderJson.error as string) ||
      (orderJson.message as string) ||
      (orderParsed.raw ? `Server HTTP ${orderParsed.status}` : 'Failed to create payment order');
    throw new Error(detail);
  }

  // Must match the key used on the server to create the order (avoids "Authentication failed")
  const razorpayKeyId = orderJson.key_id as string | undefined;
  if (!razorpayKeyId || !String(razorpayKeyId).startsWith('rzp_')) {
    throw new Error(
      'Invalid Razorpay response: missing key_id. Save Razorpay keys in Admin → Settings → Payment Gateways and redeploy.'
    );
  }

  // Step 2: Build Custom UI SDK options
  const contact = (orderData.phone ? String(orderData.phone).replace(/\D/g, '').slice(-10) : '');
  
  const baseOptions: Record<string, any> = {
    description: 'Zica Bella Order',
    currency: orderJson.currency || 'INR',
    key: razorpayKeyId,
    key_id: razorpayKeyId,
    amount: orderJson.amount,
    name: 'Zica Bella',
    order_id: orderJson.order_id,
    email: orderData.email || 'support@zicabella.com',
    contact: contact || '9876543210',
    prefill: {
      name: orderData.name || 'Zica Customer',
      email: orderData.email || 'support@zicabella.com',
      contact: contact || '9876543210',
    },
  };

  // Build method-specific options
  let options: Record<string, any> = { ...baseOptions };

  if (paymentMethod) {
    options.method = paymentMethod.method;

    if (paymentMethod.method === 'upi' && paymentMethod.upi_app_package_name) {
      options['_[flow]'] = 'intent';
      options.upi_app_package_name = paymentMethod.upi_app_package_name;
    } else if (paymentMethod.method === 'netbanking' && paymentMethod.bank) {
      options.bank = paymentMethod.bank.toUpperCase();
    } else if (paymentMethod.method === 'wallet' && paymentMethod.wallet) {
      options.wallet = paymentMethod.wallet;
    } else if (paymentMethod.method === 'card' && paymentMethod.card) {
      options['card[number]'] = paymentMethod.card.number;
      options['card[expiry_month]'] = paymentMethod.card.expiry_month;
      options['card[expiry_year]'] = paymentMethod.card.expiry_year;
      options['card[cvv]'] = paymentMethod.card.cvv;
      options['card[name]'] = paymentMethod.card.name;
    }
  }

  try {
    console.log('[razorpayService] Opening Custom UI SDK with key:', razorpayKeyId?.slice(0, 12) + '...');
    const paymentData = normalizePaymentResult(await razorpayOpen(options), String(orderJson.order_id));

    // Step 3: Verify signature server-side
    const verifyRes = await fetch(`${apiBase}/api/app/payment/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(paymentData.razorpay_signature
        ? {
            razorpay_order_id: paymentData.razorpay_order_id,
            razorpay_payment_id: paymentData.razorpay_payment_id,
            razorpay_signature: paymentData.razorpay_signature,
          }
        : {
            razorpay_order_id: paymentData.razorpay_order_id,
            razorpay_payment_id: paymentData.razorpay_payment_id,
          }),
    });

    const verifyParsed = await readJsonResponse(verifyRes);
    const verifyResult = verifyParsed.data;
    if (!verifyParsed.ok || !verifyResult.success) {
      throw new Error((verifyResult.error as string) || `Payment verification failed (${verifyParsed.status})`);
    }

    return paymentData;
  } catch (error: any) {
    // code 0 or 2 = user cancelled
    if (error?.code === 0 || error?.code === 2) {
      throw new Error('Payment cancelled by user');
    }
    throw error;
  }
}
