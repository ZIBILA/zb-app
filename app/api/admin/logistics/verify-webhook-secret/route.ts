import { NextResponse } from 'next/server';
import { resolveWebhookSecret } from '@/lib/services/logistics';

export async function GET() {
  const { secret, source } = await resolveWebhookSecret();
  return NextResponse.json({
    configured: Boolean(secret),
    source,
    secretTail: secret ? `****${secret.slice(-4)}` : null,
  });
}
