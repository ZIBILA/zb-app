import { NextResponse } from 'next/server';
import { getMetaApiLogs, getMetaApiLogStats, clearMetaApiLogs } from '@/lib/metaApiLogger';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meta/logs — Returns recent Meta Graph API request logs for dashboard troubleshooting.
 */
export async function GET() {
  // Admin only: operational Meta diagnostics are never public.
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  const logs = getMetaApiLogs();
  const stats = getMetaApiLogStats();

  return NextResponse.json({
    stats,
    logs,
    timestamp: new Date().toISOString(),
  });
}

/**
 * DELETE /api/meta/logs — Clear the in-memory log buffer.
 */
export async function DELETE() {
  // Admin only: operational Meta diagnostics are never public.
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  clearMetaApiLogs();
  return NextResponse.json({ success: true, message: 'Meta API logs cleared' });
}
