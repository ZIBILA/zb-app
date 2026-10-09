import { NextResponse } from 'next/server';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { refreshStorefront } from '@/lib/storefrontRefresh';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/storefront/refresh
 * Pulls the latest Shopify catalogue into the live website right now and (re)registers the Shopify
 * product/collection webhooks so future edits arrive automatically. Safe to click any time.
 */
export async function POST() {
  try {
    await requirePermission('STOREFRONT', 'edit');
    const result = refreshStorefront();

    // Best effort: make sure Shopify tells us about product/collection edits from now on (idempotent).
    let webhooks: 'ok' | 'failed' = 'ok';
    try {
      const { registerWebhooks } = await import('@/lib/shopify-webhooks');
      await registerWebhooks();
    } catch (err) {
      console.warn('[Storefront Refresh] webhook registration failed:', err);
      webhooks = 'failed';
    }
    return NextResponse.json({ success: true, ...result, webhooks });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    return NextResponse.json({ error: error?.message || 'Refresh failed' }, { status: 500 });
  }
}
