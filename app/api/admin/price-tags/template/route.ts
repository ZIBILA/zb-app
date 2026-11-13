import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/db';
import { normalizeTagTemplate, DEFAULT_TAG_TEMPLATE } from '@/app/dashboard/price-tags/utils/tagTemplate';

export const dynamic = 'force-dynamic';

/**
 * The default price tag template (logo, fonts, sizes, positions), shared by everyone who prints tags.
 * GET → the saved template (or the built-in default). PUT { template } → save it as the default.
 * Stored in price_tag_settings (created on first use, like the other price tag tables).
 */
const KEY = 'default_template';
/** An uploaded logo is stored inline; keep the row small. */
const MAX_TEMPLATE_BYTES = 600_000;

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS price_tag_settings (
      key TEXT PRIMARY KEY,
      config JSONB NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  tableReady = true;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureTable();
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT config, updated_by, updated_at FROM price_tag_settings WHERE key = $1`, KEY);
    if (!rows.length) return NextResponse.json({ template: DEFAULT_TAG_TEMPLATE, isDefault: true });
    return NextResponse.json({
      template: normalizeTagTemplate(rows[0].config),
      isDefault: false,
      updatedBy: rows[0].updated_by || null,
      updatedAt: rows[0].updated_at || null,
    });
  } catch (err: any) {
    console.error('[Price Tag Template] GET failed:', err?.message);
    return NextResponse.json({ template: DEFAULT_TAG_TEMPLATE, isDefault: true, error: 'Could not load the saved template' });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const template = normalizeTagTemplate(body?.template);
    const json = JSON.stringify(template);
    if (json.length > MAX_TEMPLATE_BYTES) {
      return NextResponse.json({ error: 'The logo image is too large. Please use an image under 400 KB.' }, { status: 413 });
    }
    await ensureTable();
    await prisma.$executeRawUnsafe(
      `INSERT INTO price_tag_settings (key, config, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      KEY,
      json,
      session.user.email || session.user.name || null
    );
    return NextResponse.json({ success: true, template });
  } catch (err: any) {
    console.error('[Price Tag Template] PUT failed:', err?.message);
    return NextResponse.json({ error: 'Could not save the template' }, { status: 500 });
  }
}
