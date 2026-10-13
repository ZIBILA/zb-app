import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { getClientIP, isPrivateIP } from '@/lib/ip-geo';
import {
  describeSnapToken, isSnapValidateMode, probeSnapCapi, redactSnapSecrets, snapCapiConfigError,
} from '@/lib/snap-capi';
import { cleanEnvValue, resolveSnapPixelId, snapPixelIdProblem } from '@/lib/snap/config';
import { isSnapSupportedCurrency } from '@/lib/snap/currency';
import { snapAppConfig } from '@/lib/snap/app-capi';
import { SNAP_PURCHASE_PAYMENT_STATUSES } from '@/lib/snap/purchase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/snap/connection-test — "is Snapchat tracking working on this server?"
 *
 * Read-only diagnostics, same idea as /api/meta/connection-test:
 *   1. which pixel id is in use, and where it comes from
 *   2. whether the Conversions API access token is set (never shown), has the
 *      right shape, and is not the token that was exposed in the Git history
 *   3. a LIVE check of pixel id + token against Snap's VALIDATE endpoint
 *      (Snap inspects the request and records nothing)
 *   4. what happened to the server Purchases of the last 7 days (delivery ledger)
 *   5. the currencies recent orders were charged in, and whether Snap accepts them
 *   6. whether native-app (MOBILE_APP) events are configured
 *
 * Access: a logged-in dashboard admin only (open the URL in the browser while
 * signed in to the dashboard). No secret, token or customer detail is returned.
 * The same live check is also part of a manual run of the "Snap Conversions
 * Retry" workflow (/api/cron/snap-conversions?probe=1).
 */

interface Check {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  detail?: unknown;
}

const DAY = 24 * 60 * 60 * 1000;
const LEDGER_STATUSES = ['sent', 'failed', 'sending', 'pending', 'skipped'] as const;

export async function GET(req: NextRequest) {
  // Admin only: operational diagnostics are never public.
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }

  const checks: Check[] = [];

  // 1. Pixel id
  const pixelId = resolveSnapPixelId();
  const pixelProblem = snapPixelIdProblem();
  const pixelFromEnv = !!cleanEnvValue(process.env.NEXT_PUBLIC_SNAP_PIXEL_ID) && !pixelProblem;
  if (!pixelId) {
    checks.push({ name: 'Pixel ID', status: 'fail', message: pixelProblem || 'No Snap Pixel ID is configured — Snap tracking is off on this deployment' });
  } else {
    checks.push({
      name: 'Pixel ID',
      status: pixelProblem ? 'warn' : 'pass',
      message: pixelProblem || `Snap Pixel ${pixelId} (${pixelFromEnv ? 'from NEXT_PUBLIC_SNAP_PIXEL_ID' : 'built-in store pixel; NEXT_PUBLIC_SNAP_PIXEL_ID is not set'})`,
      detail: { pixelId },
    });
  }

  // 2. Access token (never returned)
  const token = describeSnapToken();
  if (!token.set) {
    checks.push({ name: 'Access token', status: 'fail', message: 'SNAP_CAPI_ACCESS_TOKEN is not set on this server — no server event (including Purchase) reaches Snapchat' });
  } else if (token.exposed) {
    checks.push({ name: 'Access token', status: 'fail', message: 'SNAP_CAPI_ACCESS_TOKEN is the token that was published in the Git history. Delete it in Snapchat (Business Details → Conversions API Tokens) and set a newly generated one.' });
  } else if (!token.looksValid) {
    checks.push({ name: 'Access token', status: 'warn', message: 'SNAP_CAPI_ACCESS_TOKEN is set but does not look like a Snap Conversions API token (three dot-separated parts). Check it was pasted completely.' });
  } else {
    checks.push({
      name: 'Access token',
      status: 'pass',
      message: `SNAP_CAPI_ACCESS_TOKEN is set${token.issuedAt ? ` (issued by Snapchat on ${token.issuedAt.slice(0, 10)})` : ''}`,
      detail: { issuedAt: token.issuedAt },
    });
  }

  // 3. Mode
  const validateOnly = isSnapValidateMode();
  checks.push(validateOnly
    ? { name: 'Mode', status: 'warn', message: 'VALIDATION ONLY (SNAP_CAPI_VALIDATE=1): Snapchat checks every event but records none. Correct for staging, wrong for a live store.' }
    : { name: 'Mode', status: 'pass', message: 'Live: events are recorded by Snapchat' });

  // 4. Live connection
  const configError = snapCapiConfigError();
  if (configError) {
    checks.push({ name: 'Snapchat connection', status: 'fail', message: `Not tested: ${configError}` });
  } else {
    const ip = getClientIP(req);
    const probe = await probeSnapCapi({ ipAddress: ip && !isPrivateIP(ip) ? ip : undefined });
    const message = {
      ok: 'Snapchat accepted the pixel id and access token',
      auth_rejected: 'Snapchat REFUSED the access token. Generate a new Conversions API token for this pixel and update SNAP_CAPI_ACCESS_TOKEN.',
      config_missing: 'Not tested: configuration missing',
      inconclusive: 'Snapchat answered, but not with a clear yes or no — see detail',
      unreachable: 'No answer from Snapchat (network problem between this server and tr.snapchat.com)',
    }[probe.state];
    checks.push({
      name: 'Snapchat connection',
      status: probe.state === 'ok' ? 'pass' : probe.state === 'auth_rejected' ? 'fail' : 'warn',
      message,
      detail: { httpStatus: probe.httpStatus, answer: probe.detail },
    });
  }

  // 5. Server Purchases of the last 7 days (indexed counts on status + updatedAt)
  try {
    const since = new Date(Date.now() - 7 * DAY);
    const counts: Record<string, Record<string, number>> = { snap: {}, snap_app: {} };
    for (const status of LEDGER_STATUSES) {
      const rows: Array<{ platform: string; _count: { _all: number } }> = await (prisma as any).adConversionDelivery.groupBy({
        by: ['platform'],
        where: { status, updatedAt: { gt: since }, platform: { in: ['snap', 'snap_app'] }, eventName: 'PURCHASE' },
        _count: { _all: true },
      });
      for (const r of rows) counts[r.platform] = { ...(counts[r.platform] || {}), [status]: r._count._all };
    }
    const recentFailures: Array<{ platform: string; orderId: string; attempts: number; lastError: string | null; updatedAt: Date }> =
      await prisma.adConversionDelivery.findMany({
        where: { status: 'failed', updatedAt: { gt: since }, platform: { in: ['snap', 'snap_app'] }, eventName: 'PURCHASE' },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { platform: true, orderId: true, attempts: true, lastError: true, updatedAt: true },
      });
    const web = counts.snap || {};
    const failed = (web.failed || 0) + (counts.snap_app?.failed || 0);
    checks.push({
      name: 'Server Purchases, last 7 days',
      status: failed ? 'warn' : 'pass',
      message: `Website: ${web.sent || 0} delivered, ${web.failed || 0} waiting for a retry, ${web.pending || 0} checkouts not paid or not confirmed yet, ${web.skipped || 0} closed without sending`
        + ` · App: ${counts.snap_app?.sent || 0} delivered, ${counts.snap_app?.failed || 0} waiting for a retry`,
      detail: {
        website: web,
        app: counts.snap_app || {},
        latestFailures: recentFailures.map(f => ({
          platform: f.platform, orderId: f.orderId, attempts: f.attempts, at: f.updatedAt,
          error: redactSnapSecrets(f.lastError || '').slice(0, 300),
        })),
      },
    });
  } catch (err: any) {
    checks.push({ name: 'Server Purchases, last 7 days', status: 'warn', message: `Delivery ledger could not be read: ${String(err?.message || err).slice(0, 200)}` });
  }

  // 6. Currencies orders were charged in (a Purchase is always sent in the order's own currency)
  try {
    const rows: Array<{ currency: string; _count: { _all: number } }> = await (prisma as any).order.groupBy({
      by: ['currency'],
      where: { paymentStatus: { in: Array.from(SNAP_PURCHASE_PAYMENT_STATUSES) }, createdAt: { gt: new Date(Date.now() - 30 * DAY) } },
      _count: { _all: true },
    });
    const byCurrency = Object.fromEntries(rows.map(r => [String(r.currency || 'INR').toUpperCase(), r._count._all]));
    const unsupported = Object.keys(byCurrency).filter(c => !isSnapSupportedCurrency(c));
    checks.push({
      name: 'Order currencies, last 30 days',
      status: unsupported.length ? 'warn' : 'pass',
      message: unsupported.length
        ? `Orders were charged in ${unsupported.join(', ')}, which Snapchat does not list as a supported currency. They are sent as charged; Snapchat may ignore their value.`
        : Object.keys(byCurrency).length
          ? `Paid orders by currency: ${Object.entries(byCurrency).map(([c, n]) => `${c} ${n}`).join(', ')} — all accepted by Snapchat`
          : 'No paid orders in the last 30 days',
      detail: byCurrency,
    });
  } catch (err: any) {
    checks.push({ name: 'Order currencies, last 30 days', status: 'warn', message: `Orders could not be read: ${String(err?.message || err).slice(0, 200)}` });
  }

  // 7. Native app (MOBILE_APP) events
  const ios = !!snapAppConfig('ios');
  const android = !!snapAppConfig('android');
  checks.push({
    name: 'Native app events',
    status: ios && android ? 'pass' : 'warn',
    message: ios && android
      ? 'iOS and Android app Purchases are configured'
      : `App Purchases are NOT sent for: ${[!ios && 'iOS', !android && 'Android'].filter(Boolean).join(', ')} (set SNAP_APP_ID_IOS + SNAP_IOS_APP_STORE_ID / SNAP_APP_ID_ANDROID — see docs/snap-native-app-setup.md). Website tracking is not affected.`,
  });

  const overall: Check['status'] = checks.some(c => c.status === 'fail') ? 'fail' : checks.some(c => c.status === 'warn') ? 'warn' : 'pass';
  return NextResponse.json({ overall, checks, timestamp: new Date().toISOString() });
}
