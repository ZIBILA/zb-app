import { NextResponse } from 'next/server';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { listPlacements, loadPlacement, savePlacement } from '@/lib/storefrontPlacements';
import { refreshStorefront } from '@/lib/storefrontRefresh';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/storefront/placements            → every place products can be managed + catalogue health
 * GET  /api/admin/storefront/placements?key=all    → one placement's products (visible / hidden / not live)
 * PUT  /api/admin/storefront/placements            → { key, order: string[], hidden?: string[] }
 */
export async function GET(req: Request) {
  try {
    await requirePermission('STOREFRONT', 'view');
    const key = new URL(req.url).searchParams.get('key');
    if (!key) {
      return NextResponse.json(await listPlacements());
    }
    const detail = await loadPlacement(key);
    if (!detail) return NextResponse.json({ error: `Unknown placement "${key}"` }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('[Storefront Placements GET]', error?.message || error);
    return NextResponse.json({ error: 'Could not load products from Shopify. Try again in a moment.' }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  try {
    await requirePermission('STOREFRONT', 'edit');
    const body = await req.json().catch(() => ({}));
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key || !Array.isArray(body.order)) {
      return NextResponse.json({ error: 'key and order are required' }, { status: 400 });
    }
    const hidden = Array.isArray(body.hidden) ? body.hidden : [];
    const result = await savePlacement(key, body.order, hidden);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    refreshStorefront();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('[Storefront Placements PUT]', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to save' }, { status: 500 });
  }
}
