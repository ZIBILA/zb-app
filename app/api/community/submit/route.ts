import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { createCommunitySubmission, resolveSubmitter } from '@/lib/community-submissions';

export const dynamic = 'force-dynamic';

/** "Publish your look": creates a PENDING submission for the admin to review in Dashboard -> Community. */
export async function POST(req: Request) {
  try {
    const who = await resolveSubmitter(req);
    if (!who) return NextResponse.json({ error: 'Please log in to share your look.' }, { status: 401 });

    const limit = await checkRateLimit(req, 'community-submit', { maxRequests: 10, windowMs: 60 * 60_000, scope: who.id });
    if (!limit.allowed && limit.response) return limit.response;

    const body = await req.json().catch(() => ({}));
    const result = await createCommunitySubmission(who, {
      imageUrl: body?.imageUrl,
      styleDescription: body?.styleDescription ?? body?.quote,
      instagramUrl: body?.instagramUrl,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, submission: { id: result.id, status: result.status } });
  } catch (error: any) {
    console.error('[Community Submit] failed:', error?.message);
    return NextResponse.json({ error: 'Could not submit your look. Please try again.' }, { status: 500 });
  }
}
