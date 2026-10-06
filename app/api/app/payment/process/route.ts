import Razorpay from 'razorpay';
import { NextResponse } from 'next/server';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import { requireAppAuth, handleAppAuthError } from '@/lib/appAuth';

import { getCorsHeaders, handleCorsOptions } from '@/lib/cors';

export async function OPTIONS(req: Request) {
  return handleCorsOptions(req);
}

/**
 * Headless Payment Processor (Server-to-Server)
 * This allows initiating UPI and Netbanking payments without the Razorpay SDK UI.
 */
export async function POST(req: Request) {
  const corsHeaders = getCorsHeaders(req);
  try {
    const { auth: userAuth } = await requireAppAuth(req);

    let { key_id, key_secret, source } = await resolveRazorpayCredentials();
    key_id = key_id.trim();
    key_secret = key_secret.trim();

    const instance = new Razorpay({
      key_id,
      key_secret,
    });

    const body = await req.json();

    // Required fields
    const { order_id, amount, method, email, contact, name } = body;

    if (!order_id || !amount || !method) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: corsHeaders });
    }

    const auth = Buffer.from(`${key_id}:${key_secret}`).toString('base64');

    const payload: any = {
      amount: Math.round(Number(amount)),
      currency: 'INR',
      order_id,
      method,
      email: email || 'customer@zicabella.com',
      contact: contact || '9876543210',
      customer_name: name || 'Zica Customer',
    };

    if (method === 'upi') {
      if (body.vpa) payload.vpa = body.vpa;
      if (body.upi_app) payload.upi_app = body.upi_app;
    } else if (method === 'netbanking') {
      payload.bank = body.bank;
    } else if (method === 'wallet') {
      payload.wallet = body.wallet;
    }

    console.log(`[Razorpay Process] Initiating ${method} payment for order ${order_id} using ${source} keys`);

    // Use manual fetch as SDK doesn't support .payments.create for headless initiation
    const response = await fetch('https://api.razorpay.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'User-Agent': 'Razorpay-Node-SDK-ZicaBella',
      },
      body: JSON.stringify(payload),
    });

    const processText = await response.text();
    let data: any;
    try {
      data = JSON.parse(processText);
    } catch {
      throw new Error('Server returned invalid response. Please try again.');
    }

    if (!response.ok) {
      console.error('Razorpay process error:', data?.error?.description || data?.error?.code || 'unknown');
      const msg = source 
        ? `${data.error?.description || 'Authentication error'} (Source: ${source})`
        : data.error?.description || 'Payment initiation failed';
      return NextResponse.json({ 
        error: msg,
        code: data.error?.code,
        source 
      }, { status: response.status, headers: corsHeaders });
    }

    return NextResponse.json(data, { headers: corsHeaders });
  } catch (err: any) {
    if (err?.statusCode === 401) return handleAppAuthError(err);
    console.error('Razorpay process server error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error', source: 'server' },
      { status: 500, headers: corsHeaders }
    );
  }
}
