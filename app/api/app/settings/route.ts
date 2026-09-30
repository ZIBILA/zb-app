import { NextResponse } from 'next/server';
import prisma, { getShopSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const shop = await getShopSettings();
    
    if (!shop) {
      return NextResponse.json({ error: 'No shop configuration found' }, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Explicitly omit sensitive tokens and keys
    const {
      id,
      domain,
      accessToken,
      delhiveryApiKey,
      razorpayKeyId,
      razorpayKeySecret,
      shiprocketEmail,
      shiprocketToken,
      webhookSecret,
      ...publicSettings
    } = shop as any;

    return NextResponse.json(publicSettings, {
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[App API] Public Settings error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
