import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { WhatsAppService } from '@/lib/services/whatsapp.service';
import { sendTemplate, formatPhone } from '@/lib/whatsapp/client';
import { logMessage } from '@/lib/whatsapp/logger';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET — Get thread history for a phone number
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin('MARKETING', 'view');
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const since = searchParams.get('since');

    if (!phone) {
      return NextResponse.json({ error: 'Missing phone number parameter' }, { status: 400 });
    }

    const formatted = formatPhone(phone) || phone;
    const last10 = phone.replace(/\D/g, '').slice(-10);

    const conditions: any[] = [{ phoneNumber: phone }];
    if (formatted) conditions.push({ phoneNumber: formatted });
    if (last10.length === 10) conditions.push({ phoneNumber: { endsWith: last10 } });

    const whereCondition: any = { OR: conditions };
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        whereCondition.createdAt = { gt: sinceDate };
      }
    }

    // Fetch message history: on initial load (no since), fetch top 300 desc then reverse to get recent messages asc
    let messages = await prisma.whatsAppMessage.findMany({
      where: whereCondition,
      orderBy: { createdAt: since ? 'asc' : 'desc' },
      take: 300,
    });

    if (!since) {
      messages = messages.reverse();
    }

    // Only run updateMany if there is at least one unread inbound message
    const hasUnreadInbound = messages.some(
      (m: any) => m.direction === 'inbound' && m.status !== 'read'
    );

    if (hasUnreadInbound) {
      await prisma.whatsAppMessage.updateMany({
        where: {
          OR: conditions,
          direction: 'inbound',
          status: { not: 'read' }
        },
        data: { status: 'read' }
      });
    }

    return NextResponse.json({ messages });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('[WhatsApp Messages API] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST — Send a message (text, media, or template) to customer
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin('MARKETING', 'edit');
    const body = await req.json();
    const { phone, text, mediaUrl, mediaType, templateName, components } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Missing phone parameter' }, { status: 400 });
    }

    const formattedPhone = formatPhone(phone) || phone;
    let waMessageId = null;
    let messageBody = text || '';

    if (templateName) {
      // 1. Send template message via robust client (auto-resolves language & retries en/en_US)
      const result = await sendTemplate({
        to: formattedPhone,
        templateName,
        languageCode: 'en_US',
        components: components || []
      });
      waMessageId = result?.messages?.[0]?.id || null;
      messageBody = `[Template: ${templateName}] ${text || ''}`;
    } else if (mediaUrl && mediaType) {
      // 2. Send media message
      const result = await WhatsAppService.sendMediaMessage(formattedPhone, mediaType, mediaUrl, text || undefined);
      waMessageId = result?.messages?.[0]?.id || null;
      messageBody = text ? `[Media: ${mediaType}] ${text}` : `[Media: ${mediaType}] ${mediaUrl}`;
    } else if (text) {
      // 3. Send standard text message
      const result = await WhatsAppService.sendTextMessage(formattedPhone, text);
      waMessageId = result?.messages?.[0]?.id || null;
    } else {
      return NextResponse.json({ error: 'Missing message parameters (text, media, or template)' }, { status: 400 });
    }

    // Retrieve userId if customer exists
    const last10 = phone.replace(/\D/g, '').slice(-10);
    const candidates = await prisma.customer.findMany({
      where: {
        OR: [
          { phone: { contains: last10 } },
          { phone: { contains: last10.slice(0, 5) } }
        ]
      }
    });
    const customer = candidates.find((c: any) => c.phone && c.phone.replace(/\D/g, '').endsWith(last10));

    // Log outbound message to DB via fail-safe logger
    let bodyTextLog = messageBody;
    if (templateName && components && components.length > 0) {
      bodyTextLog += ` | Parameters: ${JSON.stringify(components)}`;
    }

    await logMessage({
      to_number: formattedPhone,
      template_name: templateName || null,
      message_body: bodyTextLog,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      status: 'sent',
      message_id: waMessageId,
      error_details: null
    });

    const newMessage = {
      id: waMessageId || `local_${Date.now()}`,
      direction: 'outbound' as const,
      waMessageId,
      phoneNumber: formattedPhone,
      userId: customer?.id || null,
      templateName: templateName || null,
      body: messageBody,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      status: 'sent',
      createdAt: new Date().toISOString()
    };

    return NextResponse.json({ success: true, message: newMessage });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('[WhatsApp Messages API] POST error:', error);
    const message = error.response?.data?.error?.message || error.message;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
