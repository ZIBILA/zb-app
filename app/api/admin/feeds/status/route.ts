/**
 * GET  /api/admin/feeds/status  — feed URLs + last build status
 * POST /api/admin/feeds/status  — rebuild catalogue data check + refresh status
 */

import { NextResponse } from 'next/server';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import {
  getCatalogueFeedDashboardData,
  loadFeedProducts,
  recordFeedBuildStatus,
} from '@/lib/product-feed';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePermission('MARKETING', 'view');
    const data = await getCatalogueFeedDashboardData();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST() {
  try {
    await requirePermission('MARKETING', 'edit');
    const start = Date.now();

    try {
      const loaded = await loadFeedProducts();
      const durationMs = Date.now() - start;
      await Promise.all([
        recordFeedBuildStatus({
          format: 'xml',
          status: 'success',
          itemCount: loaded.variantCount,
          productCount: loaded.products.length,
          durationMs,
          force: true,
        }),
        recordFeedBuildStatus({
          format: 'csv',
          status: 'success',
          itemCount: loaded.variantCount,
          productCount: loaded.products.length,
          durationMs,
          force: true,
        }),
      ]);
    } catch (err) {
      const durationMs = Date.now() - start;
      await Promise.all([
        recordFeedBuildStatus({ format: 'xml', status: 'error', durationMs, error: err, force: true }),
        recordFeedBuildStatus({ format: 'csv', status: 'error', durationMs, error: err, force: true }),
      ]);
    }

    const data = await getCatalogueFeedDashboardData();
    return NextResponse.json({ success: true, refreshed: true, ...data });
  } catch (error) {
    return handleAuthError(error);
  }
}
