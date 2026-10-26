import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  try {
    const list = await db.whatsAppSetting.findMany();
    const settings = Object.fromEntries(list.map((s: any) => [s.key, s.value]));
    
    return NextResponse.json({
      enable_meta_events: settings['enable_meta_events'] === 'true',
      whatsapp_dataset_id: settings['whatsapp_dataset_id'] || '',
      whatsapp_page_id: settings['whatsapp_page_id'] || '',
      whatsapp_pixel_id: settings['whatsapp_pixel_id'] || ''
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  try {
    const body = await req.json();
    const { enable_meta_events, whatsapp_dataset_id, whatsapp_page_id } = body;

    const promises = [];
    if (enable_meta_events !== undefined) {
      promises.push(db.whatsAppSetting.upsert({
        where: { key: 'enable_meta_events' },
        update: { value: String(enable_meta_events) },
        create: { key: 'enable_meta_events', value: String(enable_meta_events) }
      }));
    }
    if (whatsapp_dataset_id !== undefined) {
      promises.push(db.whatsAppSetting.upsert({
        where: { key: 'whatsapp_dataset_id' },
        update: { value: String(whatsapp_dataset_id) },
        create: { key: 'whatsapp_dataset_id', value: String(whatsapp_dataset_id) }
      }));
    }
    if (whatsapp_page_id !== undefined) {
      promises.push(db.whatsAppSetting.upsert({
        where: { key: 'whatsapp_page_id' },
        update: { value: String(whatsapp_page_id) },
        create: { key: 'whatsapp_page_id', value: String(whatsapp_page_id) }
      }));
    }

    await Promise.all(promises);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
