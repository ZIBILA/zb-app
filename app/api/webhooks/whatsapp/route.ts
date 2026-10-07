import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import db from '@/lib/db';
import { getConfig, formatPhone } from '@/lib/whatsapp/client';
import { updateMessageStatus } from '@/lib/whatsapp/logger';
import { WhatsAppService } from '@/lib/services/whatsapp.service';
import { eventTracker } from '@/lib/services/eventTracker';
import { uploadToStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Helper to download Meta media file and store in Supabase / local storage
 */
async function downloadMetaMedia(mediaId: string, mimeType?: string, fileName?: string): Promise<string> {
  try {
    const config = await getConfig();
    const accessToken = config.accessToken || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) throw new Error('No access token available');

    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v23.0';
    const metaRes = await fetch(`https://graph.facebook.com/${apiVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!metaRes.ok) throw new Error(`Meta media metadata fetch status ${metaRes.status}`);
    const metaData = await metaRes.json();
    if (!metaData.url) throw new Error('No download URL returned from Meta');

    const binaryRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!binaryRes.ok) throw new Error(`Meta media download status ${binaryRes.status}`);
    const buffer = Buffer.from(await binaryRes.arrayBuffer());

    let ext = '.jpg';
    if (fileName && path.extname(fileName)) {
      ext = path.extname(fileName);
    } else if (mimeType) {
      if (mimeType.includes('png')) ext = '.png';
      else if (mimeType.includes('gif')) ext = '.gif';
      else if (mimeType.includes('webp')) ext = '.webp';
      else if (mimeType.includes('mp4')) ext = '.mp4';
      else if (mimeType.includes('pdf')) ext = '.pdf';
      else if (mimeType.includes('ogg')) ext = '.ogg';
      else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) ext = '.mp3';
    }

    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const detectedMime = mimeType || (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.mp4' ? 'video/mp4' : ext === '.pdf' ? 'application/pdf' : 'image/jpeg');

    // 1. Save to private uploads directory on disk as optional/best-effort cache
    try {
      const privateUploadDir = path.join(process.cwd(), 'private_uploads', 'whatsapp');
      await fs.mkdir(privateUploadDir, { recursive: true });
      await fs.writeFile(path.join(privateUploadDir, filename), buffer);
    } catch (diskErr) {
      console.warn('[WhatsApp Webhook] Private disk write warning (ephemeral disk):', diskErr);
    }

    // 2. Upload to Supabase Storage bucket 'store-assets/uploads/' (PRIMARY PATH)
    try {
      const storageResult = await uploadToStorage(buffer, detectedMime, filename);
      if (storageResult.url && !storageResult.fallback) {
        console.log(`[WhatsApp Webhook] Successfully uploaded media ${mediaId} to Supabase Storage: ${storageResult.url}`);
        return storageResult.url;
      }
      console.warn(`[WhatsApp Webhook] Supabase Storage upload returned base64 fallback for media ${mediaId}. Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.`);
    } catch (storageErr: any) {
      console.error(`[WhatsApp Webhook] Supabase Storage upload failed for media ${mediaId}:`, storageErr?.message || storageErr);
    }

    // 3. Last-resort fallback: return Data URL for instant rendering in database & browser
    const base64Str = buffer.toString('base64');
    return `data:${detectedMime};base64,${base64Str}`;
  } catch (err: any) {
    console.error('[WhatsApp Webhook] Media download error, using proxy fallback:', err.message);
    return `/api/whatsapp/chat/media?mediaId=${mediaId}`;
  }
}

/**
 * Helper to verify Meta signature
 */
async function verifyMetaSignature(req: NextRequest, appSecret: string): Promise<boolean> {
  const signature = req.headers.get('x-hub-signature-256');
  if (!signature) {
    console.warn('[WhatsApp Webhook] Missing x-hub-signature-256 header');
    return false;
  }

  const elements = signature.split('=');
  const signatureHash = elements[1];

  const clone = req.clone();
  const rawBody = await clone.text();

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHash, 'utf-8'),
      Buffer.from(expectedHash, 'utf-8')
    );
  } catch (err) {
    return false;
  }
}

/**
 * GET — Meta webhook verification handshake
 */
export async function GET(req: NextRequest) {
  const config = await getConfig();
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = config.verifyToken || 'zicabella_whatsapp_2026';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WhatsApp Webhook] Verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  console.error('[WhatsApp Webhook] Verification failed — token mismatch');
  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * POST — Process incoming webhook events
 */
export async function POST(req: NextRequest) {
  try {
    const config = await getConfig();
    const appSecret = config.appSecret || process.env.WHATSAPP_APP_SECRET;

    // Verify Meta signature if App Secret is configured
    if (appSecret) {
      const isSignatureValid = await verifyMetaSignature(req, appSecret);
      if (!isSignatureValid) {
        console.warn('[WhatsApp Webhook] Signature verification failed. Unauthorized request.');
        return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
      }
    }

    const body = await req.json();
    if (process.env.WHATSAPP_DEBUG === '1') {
      console.log('[WhatsApp Webhook] event:', body?.entry?.[0]?.changes?.[0]?.field || 'unknown');
    }

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ error: 'Unsupported webhook object type' }, { status: 400 });
    }

    // 1. Record raw webhook event in database
    await db.whatsAppWebhookEvent.create({
      data: {
        eventType: body.entry?.[0]?.changes?.[0]?.field || 'messages',
        payload: body,
        processed: false
      }
    });

    // 2. Process entries
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;

        // Process incoming messages
        if (value.messages && Array.isArray(value.messages)) {
          await handleIncomingMessages(value.messages, value.contacts, db);
        }

        // Process delivery/read status updates
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const statusObj of value.statuses) {
            const { id, status, errors } = statusObj;
            let errorDetails = null;
            if (errors && errors.length > 0) {
              errorDetails = errors[0];
            }

            // Update status (sent, delivered, read, failed) and campaign logs
            await updateMessageStatus(id, status, errorDetails);
          }
        }
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error: any) {
    console.error('[WhatsApp Webhook] POST error:', error);
    // Always return 200 to Meta to avoid retry storms
    return NextResponse.json({ received: true }, { status: 200 });
  }
}

/**
 * Handle user messages (opt-out keywords, COD button replies, media & contact name sync)
 */
async function handleIncomingMessages(messages: any[], contacts: any[] | undefined, db: any) {
  const contactsMap: Record<string, string> = {};
  if (contacts && Array.isArray(contacts)) {
    for (const c of contacts) {
      if (c.wa_id && c.profile?.name) {
        contactsMap[c.wa_id] = c.profile.name;
      }
    }
  }

  for (const message of messages) {
    const rawPhone = message.from;
    const phoneNumber = formatPhone(rawPhone) || rawPhone; // Normalize to match all other DB write paths
    const waMessageId = message.id;

    // Extract text body and media parameters
    let bodyText = '';
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;

    if (message.type === 'text') {
      bodyText = message.text?.body || '';
    } else if (message.type === 'button') {
      bodyText = message.button?.text || '';
    } else if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      bodyText = message.interactive.button_reply?.title || '';
    } else if (['image', 'video', 'document', 'audio', 'voice', 'sticker'].includes(message.type)) {
      const rawType = message.type;
      mediaType = rawType === 'voice' ? 'audio' : rawType;
      const mediaObj = message[rawType];
      
      if (mediaObj?.id) {
        mediaUrl = await downloadMetaMedia(mediaObj.id, mediaObj.mime_type, mediaObj.filename);
      }

      const caption = mediaObj?.caption || '';
      const filename = mediaObj?.filename || '';

      if (caption) {
        bodyText = caption;
      } else if (filename) {
        bodyText = `[File: ${filename}]`;
      } else {
        bodyText = `[Media: ${mediaType}]`;
      }
    }

    console.log(`[WhatsApp Webhook] Message from ${phoneNumber} (${message.type}): ${bodyText}`);

    // Sync WhatsApp profile contact name if available
    const profileName = contactsMap[rawPhone] || contactsMap[phoneNumber];
    if (profileName) {
      try {
        const last10 = phoneNumber.replace(/\D/g, '').slice(-10);
        let customer = await db.customer.findFirst({
          where: { phone: { contains: last10 } }
        });

        if (customer) {
          if (!customer.name || customer.name.startsWith('Customer') || customer.name.startsWith('Valued') || customer.name.startsWith('Unregistered')) {
            await db.customer.update({
              where: { id: customer.id },
              data: { name: profileName.trim() }
            });
          }
        } else {
          const shop = await db.shop.findFirst({ select: { id: true } });
          if (!shop) {
            console.warn('[WhatsApp Webhook] No shop configured — skipping customer create');
          } else {
            customer = await db.customer.create({
              data: {
                shopId: shop.id,
                phone: phoneNumber,
                name: profileName.trim(),
                shopifyId: `whatsapp_${Date.now()}`,
              }
            });
          }
        }
      } catch (err: any) {
        console.warn('[WhatsApp Webhook] Profile name sync error:', err?.message || err);
      }
    }

    // Check opt-out keywords (STOP, UNSUBSCRIBE)
    const lowerText = bodyText.toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      try {
        // Record opt-out consent status
        await db.whatsAppOptIn.upsert({
          where: { phone: phoneNumber },
          update: { status: 'opted_out', consentDate: new Date() },
          create: { phone: phoneNumber, status: 'opted_out', source: 'webhook_optout' }
        });

        // Also update local Customer profile
        const customer = await db.customer.findFirst({
          where: { phone: { contains: phoneNumber.slice(-10) } }
        });
        if (customer) {
          await db.customer.update({
            where: { id: customer.id },
            data: { whatsappOptedOut: true }
          });
        }
        console.log(`[WhatsApp Webhook] Consent marked OPTED_OUT for: ${phoneNumber}`);
      } catch (err: any) {
        console.error('[WhatsApp Webhook] Consent opt-out save error:', err.message);
      }
    } else if (lowerText === 'start' || lowerText === 'optin') {
      // Opt back in
      try {
        await db.whatsAppOptIn.upsert({
          where: { phone: phoneNumber },
          update: { status: 'opted_in', consentDate: new Date() },
          create: { phone: phoneNumber, status: 'opted_in', source: 'webhook_optin' }
        });
        const customer = await db.customer.findFirst({
          where: { phone: { contains: phoneNumber.slice(-10) } }
        });
        if (customer) {
          await db.customer.update({
            where: { id: customer.id },
            data: { whatsappOptedOut: false }
          });
        }
        console.log(`[WhatsApp Webhook] Consent marked OPTED_IN for: ${phoneNumber}`);
      } catch (err: any) {
        console.error('[WhatsApp Webhook] Consent opt-in save error:', err.message);
      }
    }

    // Handle COD confirmations via button clicks
    if (message.type === 'button' || message.type === 'interactive') {
      const payload = message.type === 'button' ? message.button?.payload : message.interactive?.button_reply?.id;
      if (payload?.startsWith('COD_CONFIRM_')) {
        const orderId = payload.split('_')[2];
        await handleCODConfirmation(orderId, 'confirmed', 'whatsapp_button', db);
      } else if (payload?.startsWith('COD_CANCEL_')) {
        const orderId = payload.split('_')[2];
        await handleCODConfirmation(orderId, 'cancelled_by_customer', 'whatsapp_button', db);
      }
    }

    // Save message to log database
    let userId = null;
    try {
      const customer = await db.customer.findFirst({
        where: { phone: { contains: phoneNumber.slice(-10) } }
      });
      if (customer) userId = customer.id;

      await db.whatsAppMessage.create({
        data: {
          direction: 'inbound',
          waMessageId,
          phoneNumber,
          userId,
          body: bodyText,
          mediaUrl,
          mediaType,
          status: 'read',
        }
      });
    } catch (err: any) {
      console.error('[WhatsApp Webhook] Failed to log inbound message:', err.message);
    }

    // Track WhatsApp Chat Started event (deduplicated by a 24-hour window)
    try {
      const lastChatStarted = await db.whatsAppEvent.findFirst({
        where: {
          eventName: 'WhatsApp Chat Started',
          customerPhone: phoneNumber,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }
      });
      if (!lastChatStarted) {
        await eventTracker.trackWhatsAppConversation(userId, phoneNumber, { bodyText });
      }
    } catch (err: any) {
      console.error('[WhatsApp Webhook] Failed to track conversation start:', err.message);
    }

    // Track WhatsApp Campaign Clicked event when interacting with buttons/quick replies
    if (message.type === 'button' || message.type === 'interactive') {
      const payload = message.type === 'button' ? message.button?.payload : message.interactive?.button_reply?.id;
      const title = message.type === 'button' ? message.button?.text : message.interactive?.button_reply?.title;
      
      try {
        // Find latest campaign message sent to this recipient to attribute click
        const lastMessage = await db.whatsAppMessage.findFirst({
          where: { phoneNumber: { contains: phoneNumber.slice(-10) }, campaignId: { not: null } },
          orderBy: { createdAt: 'desc' }
        });

        const campaignId = lastMessage?.campaignId;
        
        await eventTracker.track({
          eventName: 'WhatsApp Campaign Clicked',
          customerId: userId,
          customerPhone: phoneNumber,
          eventSource: 'whatsapp',
          metadata: {
            buttonPayload: payload,
            buttonTitle: title,
            campaignId: campaignId || null,
            messageId: lastMessage?.waMessageId || null
          }
        });

        // Increment campaign metrics in DB
        if (campaignId) {
          await db.whatsAppCampaign.update({
            where: { id: campaignId },
            data: { 
              click_count: { increment: 1 }
            }
          });
        }
      } catch (err: any) {
        console.error('[WhatsApp Webhook] Click tracking failed:', err.message);
      }
    }

    // Trigger WhatsApp AI Auto-reply for free text messages (awaited to avoid two-message delay)
    if (message.type === 'text' && bodyText.trim() && lowerText !== 'stop' && lowerText !== 'unsubscribe' && lowerText !== 'start' && lowerText !== 'optin') {
      try {
        const { processWhatsAppAIReply } = await import('@/lib/ai/whatsappAgent');
        await processWhatsAppAIReply(phoneNumber, bodyText);
      } catch (err) {
        console.error('[WhatsApp Webhook] AI Auto-reply error:', err);
      }
    }

    // Mark as read in Meta
    WhatsAppService.markAsRead(waMessageId).catch((err: any) => {
      console.error('[WhatsApp Webhook] Mark-as-read error:', err.message);
    });
  }
}

/**
 * Handle order COD confirmations
 */
async function handleCODConfirmation(orderId: string, status: string, method: string, db: any) {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order || order.codConfirmationStatus !== 'pending') return;

    // Update order verification state
    await db.order.update({
      where: { id: orderId },
      data: {
        codConfirmationStatus: status,
        codConfirmedAt: new Date(),
        codConfirmationMethod: method,
        status: status === 'confirmed' ? 'confirmed' : 'cancelled'
      }
    });

    console.log(`[WhatsApp Webhook] COD order ${orderId} marked: ${status}`);

    // Notify admins
    try {
      const { NotificationService } = await import('@/lib/services/notification.service');
      const admins = await db.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true }
      });

      for (const admin of admins) {
        await NotificationService.sendToUser(
          admin.id,
          `COD Order ${status === 'confirmed' ? 'Confirmed' : 'Cancelled'}`,
          `Order #${order.shopifyOrderId || order.id} has been ${status} by the customer via WhatsApp.`
        ).catch((e: any) => console.error(`Error notifying admin ${admin.id}:`, e));
      }
    } catch (notifErr) {
      console.error('[WhatsApp Webhook] Admin notification dispatch failed:', notifErr);
    }

    // Send confirmation back to customer
    const phone = WhatsAppService.formatPhone(order.customer.phone || '');
    if (phone) {
      await WhatsAppService.sendTextMessage(
        phone,
        status === 'confirmed'
          ? `✅ Thank you! Your Cash on Delivery order #${order.shopifyOrderId || order.id} is confirmed. We will pack it shortly.`
          : `❌ Your order #${order.shopifyOrderId || order.id} has been cancelled.`
      );
    }
  } catch (error) {
    console.error('[WhatsApp Webhook] COD confirmation error:', error);
  }
}
