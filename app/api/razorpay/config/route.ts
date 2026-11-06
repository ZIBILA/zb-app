import { NextResponse } from 'next/server';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import { dashboardUrl } from '@/lib/storefront-url';

export const dynamic = 'force-dynamic';

/**
 * GET /api/razorpay/config
 * Returns the public Razorpay Key ID when full credentials (ID + secret) are configured.
 */
export async function GET() {
  try {
    const creds = await resolveRazorpayCredentials();
    return NextResponse.json({
      keyId: creds.key_id,
      isConfigured: true,
      source: creds.source,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'Razorpay setup incomplete. Add Key ID and Secret in Dashboard → Settings → Payment Gateways (both are required), or set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.',
        isConfigured: false,
        mockAllowed: true,
        setupUrl: dashboardUrl('/dashboard/payments/razorpay'),
      },
      { status: 200 }
    );
  }
}
