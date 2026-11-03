import { NextResponse } from 'next/server';
import { createCommunitySubmission, resolveSubmitter } from '@/lib/community-submissions';

/** Kept for the portal's "Become Featured" form: same rules as /api/community/submit (logged-in customer, own storage). */
export async function POST(req: Request) {
  try {
    const who = await resolveSubmitter(req);
    if (!who) return NextResponse.json({ error: 'Please log in to share your look.' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const result = await createCommunitySubmission(who, {
      imageUrl: body?.imageUrl,
      styleDescription: body?.styleDescription,
      instagramUrl: body?.instagramUrl,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, submission: { id: result.id, status: result.status } });
  } catch (error: any) {
    console.error('[Featured User Submission Error]:', error?.message);
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }
}
