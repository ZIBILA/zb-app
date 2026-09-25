import { NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/db';
import { dispatchMetaPurchase, confirmStoreCreditPurchase } from '@/lib/meta-purchases';
import { reconcileGatewayPurchase } from '@/lib/meta-purchase-reconciliation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(auth);
  if (!secret || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const awaiting = await prisma.metaPurchase.findMany({ where: {
    status: 'awaiting_payment', availableAt: { lte: now }, createdAt: { gt: new Date(Date.now() - 47 * 3600000) },
  }, take: 8, orderBy: { availableAt: 'asc' }, select: { orderId: true, razorpayOrderId: true } });
  for (let i = 0; i < awaiting.length; i += 4) {
    await Promise.all(awaiting.slice(i, i + 4).map(async (row: { orderId: string; razorpayOrderId: string | null }) => {
      try {
        if (row.razorpayOrderId) await reconcileGatewayPurchase(row.orderId);
        else await confirmStoreCreditPurchase(row.orderId);
      } catch { console.warn('[Meta Purchase] Proof unavailable; worker will retry'); }
      // Rotate unsettled attempts so one failure cannot starve other orders.
      await prisma.metaPurchase.updateMany({ where: { orderId: row.orderId, status: 'awaiting_payment' }, data: { availableAt: new Date(Date.now() + 60000) } });
    }));
  }
  const rows = await prisma.metaPurchase.findMany({
    where: { availableAt: { lte: now }, OR: [{ status: 'pending' }, { status: 'sending', leaseExpiresAt: { lt: now } }] },
    orderBy: { availableAt: 'asc' }, take: 12, select: { orderId: true },
  });
  const counts: Record<string, number> = {};
  // Four bounded requests at a time; leases allow safe overlapping worker runs.
  for (let i = 0; i < rows.length; i += 4) {
    const results = await Promise.all(rows.slice(i, i + 4).map((row: { orderId: string }) => dispatchMetaPurchase(row.orderId)));
    for (const result of results) counts[result] = (counts[result] || 0) + 1;
  }
  return NextResponse.json({ checked: awaiting.length, processed: rows.length, counts });
}
