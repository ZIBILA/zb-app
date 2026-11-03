/**
 * Customer photo submissions for the Community board ("Publish your look").
 *
 * A submission is a FeaturedUser row that starts as PENDING; the admin approves or rejects it in
 * Dashboard -> Community, and only APPROVED rows are returned by the public /api/featured-users.
 *
 * The customer is always the logged-in account (app token or website session): name and email come from the
 * account, never from the request, and the photo must be one that was uploaded through
 * /api/community/upload (our own storage), so the board cannot be used to show other people's links.
 */
import prisma from '@/lib/db';
import { requireAppAuth } from '@/lib/appAuth';
import { getSession } from '@/lib/auth/rbac';

export const MAX_PENDING_PER_CUSTOMER = 3;
export const MAX_DESCRIPTION = 500;

export interface Submitter {
  id: string;
  name: string;
  email: string;
}

const toSubmitter = (c: { id: string; name?: string | null; email?: string | null; phone?: string | null }): Submitter => ({
  id: c.id,
  name: String(c.name || '').trim() || 'Zica Bella Member',
  email: String(c.email || '').trim() || String(c.phone || '').trim() || c.id,
});

/** The logged-in customer behind this request (mobile app token first, then the website session), or null. */
export async function resolveSubmitter(req: Request): Promise<Submitter | null> {
  if (req.headers.get('authorization')) {
    try {
      const { customer } = (await requireAppAuth(req)) as any;
      if (customer?.id) return toSubmitter(customer);
    } catch {
      /* not a valid app token: try the website session */
    }
  }
  try {
    const session: any = await getSession();
    const id = session?.user?.id;
    if (id) {
      const customer = await prisma.customer.findUnique({
        where: { id: String(id) },
        select: { id: true, name: true, email: true, phone: true },
      });
      if (customer) return toSubmitter(customer);
    }
  } catch {
    /* no session */
  }
  return null;
}

/** Only photos uploaded to our own public storage folder may be submitted. */
export function isCommunityImageUrl(url: unknown): url is string {
  const raw = String(url || '').trim();
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!raw || !base) return false;
  try {
    const u = new URL(raw);
    const b = new URL(base);
    return u.protocol === 'https:' && u.host === b.host && u.pathname.startsWith('/storage/v1/object/public/store-assets/uploads/');
  } catch {
    return false;
  }
}

const INSTAGRAM_URL = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._\-/?=&%]{1,150}$/i;

export type SubmissionResult =
  | { ok: true; id: string; status: string; duplicate?: boolean }
  | { ok: false; status: number; error: string };

export async function createCommunitySubmission(
  who: Submitter,
  input: { imageUrl?: unknown; styleDescription?: unknown; instagramUrl?: unknown },
): Promise<SubmissionResult> {
  if (!isCommunityImageUrl(input.imageUrl)) {
    return { ok: false, status: 400, error: 'Please upload a photo first, then submit it.' };
  }
  const imageUrl = String(input.imageUrl).trim();

  const description = String(input.styleDescription ?? '').trim();
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, status: 400, error: `Please keep the description under ${MAX_DESCRIPTION} characters.` };
  }
  const instagram = String(input.instagramUrl ?? '').trim();
  if (instagram && !INSTAGRAM_URL.test(instagram)) {
    return { ok: false, status: 400, error: 'The Instagram link must start with https://instagram.com/' };
  }

  // The same photo submitted twice (a retry, a double tap) is one submission.
  const existing = await prisma.featuredUser.findFirst({ where: { imageUrl }, select: { id: true, status: true } });
  if (existing) return { ok: true, id: existing.id, status: existing.status, duplicate: true };

  const waiting = await prisma.featuredUser.count({ where: { email: who.email, status: 'PENDING' } });
  if (waiting >= MAX_PENDING_PER_CUSTOMER) {
    return { ok: false, status: 429, error: `You already have ${MAX_PENDING_PER_CUSTOMER} looks waiting for review. Please wait for them to be reviewed first.` };
  }

  const row = await prisma.featuredUser.create({
    data: {
      name: who.name,
      email: who.email,
      imageUrl,
      styleDescription: description || null,
      instagramUrl: instagram || null,
      status: 'PENDING', // never public until an admin approves it
      isTopFeatured: false,
    },
  });
  return { ok: true, id: row.id, status: row.status };
}
