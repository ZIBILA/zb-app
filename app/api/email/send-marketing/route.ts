import { NextRequest, NextResponse } from 'next/server';
import { sendMail } from '@/lib/mailer';
import { marketingTemplate } from '@/lib/email-templates';
import { logEmail } from '@/lib/log-email';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin('MARKETING', 'edit');

    const data = await req.json();
    const { recipients, headline, subheadline, bodyText, ctaLabel, ctaUrl, imageUrl, footerNote } = data;

    if (!recipients || !Array.isArray(recipients)) {
      return NextResponse.json({ error: 'Recipients must be an array' }, { status: 400 });
    }

    const html = marketingTemplate({
      headline,
      subheadline,
      bodyText,
      ctaLabel,
      ctaUrl,
      imageUrl,
      footerNote,
    });

    // For marketing, we might want to send individually to personalize, 
    // but for now we'll send to the list (bcc for privacy)
    const result = await sendMail({
      to: 'noreply@zicabella.com', // sender as primary recipient
      bcc: recipients.join(','),
      subject: headline,
      html,
    });

    // Log the event once for the campaign
    await logEmail({
      recipientEmail: `${recipients.length} recipients`,
      subject: headline,
      templateName: 'marketingTemplate',
      triggerEvent: 'marketing/campaign',
      status: result.messageId ? 'sent' : 'failed',
      messageId: result.messageId,
      sentBy: 'marketing-admin',
    });

    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
