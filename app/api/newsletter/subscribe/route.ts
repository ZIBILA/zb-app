import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const bodySchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).email(),
});

/**
 * Storefront footer newsletter sign-up.
 * Responds ok:true only after the subscription is persisted; the footer fires
 * tracking (Snap SUBSCRIBE etc.) only on that confirmed success.
 * `created` is false when the email was already subscribed, so a repeat sign-up
 * does not count as a new subscription.
 */
export async function POST(req: Request) {
  const limited = await checkRateLimit(req, 'newsletter-subscribe', { maxRequests: 5, windowMs: 60_000 });
  if (!limited.allowed) return limited.response!;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  const { email } = parsed.data;

  try {
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
    if (existing && existing.status === 'subscribed') {
      return NextResponse.json({ ok: true, created: false });
    }
    if (existing) {
      await prisma.newsletterSubscriber.update({ where: { email }, data: { status: 'subscribed' } });
    } else {
      try {
        await prisma.newsletterSubscriber.create({ data: { email } });
      } catch (e: any) {
        if (e?.code === 'P2002') return NextResponse.json({ ok: true, created: false });
        throw e;
      }
    }
    return NextResponse.json({ ok: true, created: true });
  } catch (err: any) {
    console.error('[Newsletter] subscribe failed:', err?.message);
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 });
  }
}
