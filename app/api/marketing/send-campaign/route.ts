import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { EmailService } from '@/lib/services/email.service';
import { SmsService } from '@/lib/services/sms.service';
import { WhatsAppService } from '@/lib/services/whatsapp.service';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";
// Assuming NotificationService has a way to send, or we just call the existing /api/notifications/send-manual
import { fetchAllCustomers } from '@/lib/shopify-admin';
import { isOptedIn } from '@/lib/whatsapp/templates';
import { formatPhone } from '@/lib/whatsapp/client';

export async function POST(req: Request) {
  try {
    await requireAdmin('MARKETING', 'edit');

    const { channel, targetAudience, subject, messageBody, templateId, mediaUrl } = await req.json();

    if (!channel || !targetAudience || !messageBody) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Fetch target customers
    let targetCustomers = await db.customer.findMany({
      where: {
        ...(channel === 'email' ? { emailOptedOut: false, email: { not: null } } : {}),
        ...(channel === 'whatsapp' ? { whatsappOptedOut: false, phone: { not: null } } : {}),
        ...(channel === 'sms' ? { smsOptedOut: false, phone: { not: null } } : {}),
      }
    });

    if (targetAudience === 'vip') {
      targetCustomers = targetCustomers.filter((c: any) => (c.totalOrders || 0) > 2 || (c.totalSpent || 0) > 10000);
    } else if (targetAudience === 'recent') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      targetCustomers = targetCustomers.filter((c: any) => c.lastOrderDate && new Date(c.lastOrderDate) > thirtyDaysAgo);
    }

    if (targetCustomers.length === 0) {
      return NextResponse.json({ error: 'No valid customers found for this audience and channel.' }, { status: 404 });
    }

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // 2. Dispatch Campaign
    if (channel === 'email') {
      // Filter email recipients through EmailOptIn table
      const filteredCustomers = [];
      for (const customer of targetCustomers) {
        if (!customer.email) continue;
        const phone = customer.phone;
        if (phone) {
          try {
            const emailRecord = await db.emailOptIn.findUnique({
              where: { phone: formatPhone(phone) },
            });
            // If there's an explicit opt-out record, skip
            if (emailRecord && emailRecord.status === 'opted_out') {
              skippedCount++;
              continue;
            }
          } catch (err) {
            // No record found — fall through to Customer.emailOptedOut (already filtered)
          }
        }
        filteredCustomers.push(customer);
      }

      const emails = filteredCustomers.map((c: any) => c.email).filter(Boolean) as string[];
      try {
        await EmailService.sendEmail(emails, subject || 'Zica Bella Exclusive', messageBody);
        successCount = emails.length;
      } catch (e) {
        failedCount = emails.length;
      }
    } 
    
    else if (channel === 'sms') {
      for (const customer of targetCustomers) {
        if (!customer.phone) continue;
        try {
          const formattedPhone = WhatsAppService.formatPhone(customer.phone);
          await SmsService.sendSms(formattedPhone, messageBody, templateId);
          successCount++;
        } catch (e) {
          failedCount++;
        }
      }
    }
    
    else if (channel === 'whatsapp') {
      for (const customer of targetCustomers) {
        if (!customer.phone) continue;
        try {
          const formattedPhone = WhatsAppService.formatPhone(customer.phone);
          
          // Check centralized WhatsAppOptIn table for marketing consent
          const consented = await isOptedIn(formattedPhone);
          if (!consented) {
            skippedCount++;
            continue;
          }
          
          if (mediaUrl) {
            // If media is provided, we send a media message with caption
            await WhatsAppService.sendMediaMessage(formattedPhone, 'image', mediaUrl, messageBody);
          } else if (templateId) {
            // If we have a templateId, we send a template.
            await WhatsAppService.sendTemplateMessage(formattedPhone, templateId);
          } else {
            // Otherwise a plain text message.
            await WhatsAppService.sendTextMessage(formattedPhone, messageBody);
          }
          successCount++;
        } catch (e) {
          failedCount++;
        }
      }
    }

    // 3. Log Analytics Event
    if (successCount > 0) {
      await db.campaignAnalyticsEvent.create({
        data: {
          campaignId: `camp_${Date.now()}`,
          channel,
          eventType: 'sent',
          metadata: JSON.stringify({ successCount, failedCount, skippedCount, targetAudience, templateId, hasMedia: !!mediaUrl })
        }
      });
    }

    return NextResponse.json({ 
      success: true, 
      sent: successCount, 
      failed: failedCount,
      skipped: skippedCount,
      message: `Successfully sent to ${successCount} customers.${skippedCount > 0 ? ` ${skippedCount} skipped (not opted in).` : ''}`
    });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Campaign Dispatch Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to dispatch campaign' }, { status: 500 });
  }
}
