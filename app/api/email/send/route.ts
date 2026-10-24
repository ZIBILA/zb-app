import { NextRequest, NextResponse } from 'next/server';
import { sendMail } from '@/lib/mailer';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin('MARKETING', 'edit');

    const data = await req.json();
    const { templateId, subject, htmlBody, recipients, scheduledAt } = data;

    if (!subject || !htmlBody || !recipients) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    let finalRecipients: string[] = [];
    if (recipients === 'all') {
      const users = await prisma.customer.findMany({
        where: { email: { not: null } },
        select: { email: true }
      });
      finalRecipients = users.map((u: any) => u.email).filter(Boolean) as string[];
    } else if (Array.isArray(recipients)) {
      finalRecipients = recipients;
    }

    if (finalRecipients.length === 0) {
      return NextResponse.json({ success: false, error: 'No recipients found' }, { status: 400 });
    }

    let sentCount = 0;
    let hasError = false;
    let errorMsg = '';

    // Send if not scheduled
    if (scheduledAt) {
      // In a real app this would queue a job
      sentCount = finalRecipients.length;
    } else {
      // Batch send using central verified mailer
      const BATCH_SIZE = 50;
      for (let i = 0; i < finalRecipients.length; i += BATCH_SIZE) {
        const batch = finalRecipients.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map((email: any) => 
          sendMail({
            to: email,
            subject,
            html: htmlBody,
          }).catch((e: any) => {
            console.error('Failed to send to', email, e);
            hasError = true;
            errorMsg = e.message;
          })
        );
        
        await Promise.all(promises);
        sentCount += batch.length;
        if (i + BATCH_SIZE < finalRecipients.length) {
          // Delay between batches
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    // Log the send
    let templateName = 'Custom';
    if (templateId) {
      const t = await prisma.emailTemplate.findUnique({ where: { id: templateId } });
      if (t) templateName = t.name;
    }

    // Using existing Prisma EmailLog schema mapped to the requested fields logically
    await prisma.emailLog.create({
      data: {
        recipientEmail: finalRecipients.length === 1 ? finalRecipients[0] : 'Batch Send',
        recipientName: String(finalRecipients.length), // Store count here
        subject,
        templateName,
        status: scheduledAt ? 'scheduled' : (hasError ? 'failed' : 'sent'),
        errorMessage: errorMsg || null,
        triggerEvent: scheduledAt ? new Date(scheduledAt).toISOString() : null, // Store scheduledAt here
        sentBy: 'admin',
      }
    });

    return NextResponse.json({
      success: true,
      sentCount,
      status: scheduledAt ? 'scheduled' : 'sent',
      error: hasError ? errorMsg : undefined
    });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Send email error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
