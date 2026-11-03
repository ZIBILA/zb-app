import { NextResponse } from 'next/server';
import { uploadToStorage } from '@/lib/storage';
import { sniffImageType, validateFileSize } from '@/lib/upload-validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSubmitter } from '@/lib/community-submissions';

export const dynamic = 'force-dynamic';

/** Photo upload for the Community "Publish your look" form: logged-in customers (app token or website session). */
export async function POST(req: Request) {
  try {
    const who = await resolveSubmitter(req);
    if (!who) return NextResponse.json({ error: 'Please log in to share your look.' }, { status: 401 });

    const limit = await checkRateLimit(req, 'community-upload', { maxRequests: 10, windowMs: 60 * 60_000, scope: who.id });
    if (!limit.allowed && limit.response) return limit.response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No photo selected.' }, { status: 400 });

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowedTypes.includes(String(file.type).toLowerCase()) && !String(file.name).match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
      return NextResponse.json({ error: 'Please choose a JPG, PNG, WebP or HEIC photo.' }, { status: 400 });
    }
    const sizeError = validateFileSize(file.size);
    if (sizeError) return NextResponse.json({ error: sizeError }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!sniffImageType(buffer)) return NextResponse.json({ error: 'That file is not a valid photo.' }, { status: 400 });

    const result = await uploadToStorage(buffer, file.type || 'image/jpeg', file.name || 'look.jpg');
    // A base64 fallback would be stored in the database and shown to admins as a giant string.
    if (result.fallback) {
      console.error('[Community Upload] Storage unavailable (base64 fallback refused)');
      return NextResponse.json({ error: 'Photo upload is temporarily unavailable. Please try again later.' }, { status: 503 });
    }
    return NextResponse.json({ success: true, url: result.url });
  } catch (error: any) {
    console.error('[Community Upload] failed:', error?.message);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
