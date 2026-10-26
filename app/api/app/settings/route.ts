import { NextResponse } from 'next/server';
import { getShopSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Fields that must never leave the server (API keys, tokens, credentials). */
const SENSITIVE_SHOP_KEYS = new Set([
  'accessToken',
  'delhiveryApiKey',
  'razorpayKeyId',
  'razorpayKeySecret',
  'shiprocketEmail',
  'shiprocketToken',
  'shiprocketPassword',
  'webhookSecret',
  'firebaseClientEmail',
  'firebasePrivateKey',
  'firebaseProjectId',
  'sendgridApiKey',
  'twilioAccountSid',
  'twilioAuthToken',
  'twilioPhoneNumber',
  'whatsappPhoneId',
  'whatsappToken',
  'claudeApiKey',
  'claudeWebhookSecret',
  'openaiApiKey',
  'openaiWebhookSecret',
]);

function toPublicShopSettings(shop: Record<string, any>) {
  const publicSettings: Record<string, any> = {};
  for (const [key, value] of Object.entries(shop)) {
    if (SENSITIVE_SHOP_KEYS.has(key)) continue;
    if (value === undefined) continue;
    publicSettings[key] = value;
  }
  return publicSettings;
}

export async function GET() {
  try {
    const shop = await getShopSettings();

    if (!shop) {
      return NextResponse.json(
        { error: 'No shop configuration found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const publicSettings = toPublicShopSettings(shop as any);

    // Ensure COD upfront amount is always present for mobile/web clients
    const { normalizeCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } = await import('@/lib/cod-upfront');
    const codUpfrontAmount = normalizeCodUpfrontAmount(
      publicSettings.codUpfrontAmount ?? (shop as any).codUpfrontAmount,
      DEFAULT_COD_UPFRONT_AMOUNT
    );

    return NextResponse.json(
      { ...publicSettings, codUpfrontAmount },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error: any) {
    console.error('[App API] Public Settings error:', error.message);
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
